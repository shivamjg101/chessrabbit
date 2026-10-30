"""Shared FastAPI dependencies: current user, plan gating, usage metering."""

from __future__ import annotations

from datetime import date

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import revocation
from app.core.db import get_db
from app.core.security import decode_access_token, decode_admin_token
from app.models import UsageDaily, User


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the bearer token to a live user. Account state is read from the database."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "not_authenticated", "message": "Missing bearer token"},
        )

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_token", "message": "Token invalid or expired"},
        )

    # Signing out revokes the refresh token in the database, which stops the
    # session renewing itself - but the access token in hand stays
    # cryptographically valid until it expires. This is what makes "sign out"
    # end the current session too. See core/revocation.py.
    if await revocation.is_revoked(payload.get("jti")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_token", "message": "Token invalid or expired"},
        )

    user = await db.get(User, int(payload["sub"]))
    if user is None or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "user_not_found", "message": "Account not found"},
        )
    if user.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "account_suspended", "message": "This account is suspended"},
        )

    # The one chokepoint every authenticated request passes through, so it is
    # where "this user is active" is recorded. Costs one Redis ZADD per request
    # and one row per user per day; never raises. See services/presence.py.
    from app.services import presence

    await presence.touch(db, user.id)
    return user


async def get_optional_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """For endpoints that work logged-out but personalize when logged in."""
    if not authorization:
        return None
    try:
        return await get_current_user(authorization, db)
    except HTTPException:
        return None








async def check_and_increment_usage(db: AsyncSession, user: User, commit: bool = True) -> int:
    """
    Atomically count today's analyses without daily quotas.
    Returns the new count for local usage statistics. With commit=False the
    count rides on the caller's transaction, saving a round trip.
    """
    today = date.today()

    result = await db.execute(
        text(
            """
            INSERT INTO usage_daily (user_id, day, analyses)
            VALUES (:uid, :day, 1)
            ON CONFLICT (user_id, day) DO UPDATE
              SET analyses = usage_daily.analyses + 1
            RETURNING analyses
            """
        ),
        {"uid": user.id, "day": today},
    )
    count = result.scalar_one()
    if commit:
        await db.commit()

    return count


async def usage_today(db: AsyncSession, user: User) -> int:
    row = await db.execute(
        select(UsageDaily.analyses).where(
            UsageDaily.user_id == user.id, UsageDaily.day == date.today()
        )
    )
    return row.scalar_one_or_none() or 0


async def require_admin(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Resolve an ADMIN token - never a player access token.

    This deliberately does not build on `get_current_user`. If it did, the
    ordinary session the app keeps in localStorage would also be an admin
    session, and an XSS anywhere in the player-facing app would reach the
    dashboard. `decode_admin_token` accepts only tokens minted by
    /admin/auth/login; see core/security.py.

    The is_admin / suspended / deleted checks are re-read from the database on
    every request rather than trusted from the token, so revoking the flag
    takes effect immediately instead of at the end of the token's hour.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "admin_auth_required", "message": "Admin authentication required"},
    )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise unauthorized

    payload = decode_admin_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        raise unauthorized

    # An admin token cannot be refreshed and has no database row to revoke, so
    # before this the only thing ending an admin session was the clock. Signing
    # out now actually ends it.
    if await revocation.is_revoked(payload.get("jti")):
        raise unauthorized

    user = await db.get(User, int(payload["sub"]))
    if (
        user is None
        or user.deleted_at is not None
        or user.suspended_at is not None
        or not user.is_admin
    ):
        raise unauthorized
    return user
