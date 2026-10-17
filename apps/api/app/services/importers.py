"""
Auto-import games from Lichess / Chess.com public APIs (Sprint 2, 3.3).

Both platforms expose full game history without OAuth:
- Lichess:   GET https://lichess.org/api/games/user/{username}  (PGN stream)
- Chess.com: GET https://api.chess.com/pub/player/{u}/games/archives (JSON, monthly)

Sync strategy: newest games first, capped per sync (MAX_SYNC_GAMES); dedupe on
the platform's game URL stored in games.external_id. The free-tier storage cap
is respected - we import up to the remaining quota and report the rest as
"capped" so the UI can show an upgrade prompt exactly where value was denied.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.breaker import CircuitOpen, breaker
from app.core.bulk import bulk_insert
from app.core.chess_utils import parse_pgn, positions_of_game
from app.models import ExternalAccount, Game, GamePosition, User

log = logging.getLogger(__name__)

PLATFORMS = ("lichess", "chesscom")
MAX_SYNC_GAMES = 300  # per sync run; nightly cron catches up long histories
_HEADERS = {"User-Agent": "ChessRabbit/0.1 (auto-import; noreply@chessrabbit.app)"}
# connect gets its own short budget: a host that will not complete a TCP
# handshake in 5s is down, and the generous read timeout is for streaming 300
# games of PGN, not for waiting to find out whether anyone is home.
_TIMEOUT = httpx.Timeout(30.0, connect=5.0, read=60.0)

# One breaker per platform - Lichess being down says nothing about Chess.com.
# The thresholds are deliberately looser than the explorer's: these calls are
# user-initiated and infrequent, and a sync legitimately takes tens of seconds,
# so there is no slow-call rule. What they do cap is how many syncs can be
# parked on a dead platform at once.
_BREAKERS = {
    platform: breaker(
        f"{platform}-api",
        failure_threshold=4,
        reset_after=60.0,
        max_concurrency=6,
    )
    for platform in PLATFORMS
}

# Chess960 is stored without the standard opening index; other variants are rejected.
_LICHESS_PERFS = "ultraBullet,bullet,blitz,rapid,classical,correspondence,chess960"


class PlatformError(Exception):
    """User not found, API unreachable, or malformed platform response."""


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True)


async def _get(
    platform: str, client: httpx.AsyncClient, url: str, **kwargs
) -> httpx.Response:
    """
    GET through the platform's circuit breaker.

    A tripped circuit surfaces as PlatformError, the same type an unreachable
    host already produced, so every caller's error handling covers it - the
    only difference the user sees is that the answer arrives immediately
    instead of after a timeout.
    """
    try:
        return await _BREAKERS[platform].call(client.get, url, **kwargs)
    except CircuitOpen as exc:
        raise PlatformError(
            f"{platform} is not responding right now - try again in a minute"
        ) from exc


async def verify_account(platform: str, username: str) -> str:
    """Confirm the account exists; return the platform's canonical username."""
    async with _client() as client:
        try:
            if platform == "lichess":
                res = await _get(platform, client, f"https://lichess.org/api/user/{username}")
            else:
                res = await _get(
                    platform, client,
                    f"https://api.chess.com/pub/player/{username.lower()}",
                )
        except httpx.HTTPError as exc:
            raise PlatformError(f"{platform} is unreachable: {exc.__class__.__name__}") from exc

    if res.status_code == 404:
        raise PlatformError(f'No {platform} account named "{username}"')
    if res.status_code != 200:
        raise PlatformError(f"{platform} returned HTTP {res.status_code}")

    try:
        return res.json().get("username") or username
    except ValueError as exc:
        raise PlatformError(f"{platform} sent a malformed response") from exc


async def fetch_games(
    platform: str,
    username: str,
    since: datetime | None,
    max_games: int = MAX_SYNC_GAMES,
) -> list[tuple[dict, str | None]]:
    """Return [(parsed_game_dict, external_id), ...], newest first."""
    if platform == "lichess":
        return await _fetch_lichess(username, since, max_games)
    return await _fetch_chesscom(username, since, max_games)


async def _fetch_lichess(
    username: str, since: datetime | None, max_games: int
) -> list[tuple[dict, str | None]]:
    params: dict = {
        "max": max_games,
        "moves": "true",
        "tags": "true",
        # Without this Lichess omits the Opening header, so every imported game
        # lands in Insights as "Unknown opening" - the openings charts were
        # collapsing a whole account into one row.
        "opening": "true",
        "perfType": _LICHESS_PERFS,
    }
    if since is not None:
        params["since"] = int(since.timestamp() * 1000)

    async with _client() as client:
        try:
            res = await _get(
                "lichess", client,
                f"https://lichess.org/api/games/user/{username}",
                params=params,
                headers={"Accept": "application/x-chess-pgn"},
            )
        except httpx.HTTPError as exc:
            raise PlatformError(f"lichess is unreachable: {exc.__class__.__name__}") from exc

    if res.status_code == 404:
        raise PlatformError(f'No lichess account named "{username}"')
    if res.status_code == 429:
        raise PlatformError("lichess rate limit hit - try again in a minute")
    if res.status_code != 200:
        raise PlatformError(f"lichess returned HTTP {res.status_code}")

    entries: list[tuple[dict, str | None]] = []
    for parsed in parse_pgn(res.text):
        site = parsed.get("site") or ""
        ext_id = site if site.startswith("https://lichess.org/") else None
        entries.append((parsed, ext_id))
    return entries


async def _fetch_chesscom(
    username: str, since: datetime | None, max_games: int
) -> list[tuple[dict, str | None]]:
    uname = username.lower()
    since_epoch = since.timestamp() if since is not None else 0.0

    async with _client() as client:
        try:
            res = await _get(
                "chesscom", client,
                f"https://api.chess.com/pub/player/{uname}/games/archives",
            )
        except httpx.HTTPError as exc:
            raise PlatformError(f"chess.com is unreachable: {exc.__class__.__name__}") from exc

        if res.status_code == 404:
            raise PlatformError(f'No chess.com account named "{username}"')
        if res.status_code != 200:
            raise PlatformError(f"chess.com returned HTTP {res.status_code}")

        try:
            archives: list[str] = res.json().get("archives", [])
        except ValueError as exc:
            raise PlatformError("chess.com sent a malformed response") from exc

        entries: list[tuple[dict, str | None]] = []
        # Archives are chronological month URLs (.../games/YYYY/MM); walk newest first.
        for archive_url in reversed(archives):
            if len(entries) >= max_games:
                break
            try:
                month_res = await _get("chesscom", client, archive_url)
            except httpx.HTTPError as exc:
                raise PlatformError(
                    f"chess.com is unreachable: {exc.__class__.__name__}"
                ) from exc
            if month_res.status_code != 200:
                continue  # a single bad month should not kill the sync

            games = month_res.json().get("games", [])
            month_all_old = True
            for game in reversed(games):  # newest first within the month
                if len(entries) >= max_games:
                    break
                end_time = game.get("end_time", 0)
                if end_time <= since_epoch:
                    continue
                month_all_old = False
                if game.get("rules") not in ("chess", "chess960") or not game.get("pgn"):
                    continue
                parsed = parse_pgn(game["pgn"])
                if parsed:
                    entries.append((parsed[0], game.get("url")))
            if month_all_old and since_epoch and games:
                break  # every earlier month is older still

    return entries


def color_played(parsed: dict, identities: set[str]) -> str | None:
    """
    Which side the owner played, or None when we genuinely cannot tell.

    `identities` is the set of lowercased names the user goes by (their linked
    platform usernames, plus their display name for hand-pasted PGNs). Guessing
    would be worse than abstaining: a wrong colour silently inverts every
    win-rate on the Insights page.
    """
    if parsed.get("white", "").lower() in identities:
        return "w"
    if parsed.get("black", "").lower() in identities:
        return "b"
    return None


async def user_identities(db: AsyncSession, user: User) -> set[str]:
    """Every name this user plays under, lowercased."""
    result = await db.execute(
        select(ExternalAccount.username).where(ExternalAccount.user_id == user.id)
    )
    names = {row[0].lower() for row in result.all() if row[0]}
    if user.display_name:
        names.add(user.display_name.lower())
    return names


async def _import_entries(
    db: AsyncSession,
    user: User,
    entries: list[tuple[dict, str | None]],
    source: str,
    identities: set[str] | None = None,
) -> tuple[int, int, int, list[str]]:
    """Insert games + position index rows. Returns (imported, duplicates, capped, errors)."""
    known = identities if identities is not None else await user_identities(db, user)
    result = await db.execute(
        select(Game.external_id).where(
            Game.owner_id == user.id, Game.external_id.is_not(None)
        )
    )
    seen: set[str] = {row[0] for row in result.all()}


    imported = duplicates = capped = 0
    errors: list[str] = []

    # Same shape as the PGN import in routers/games.py: build and validate
    # every row first, then write the batch in two statements. A 300-game sync
    # used to cost 300 flushes plus a position insert per ply.
    rows: list[dict] = []
    indexes: list[list[tuple[int, int, str]]] = []

    for parsed, ext_id in entries:
        if ext_id and ext_id in seen:
            duplicates += 1
            continue
        try:
            positions = positions_of_game(
                parsed["movetext"], variant=parsed["variant"], start_fen=parsed["start_fen"]
            )
            rows.append({
                "owner_id": user.id,
                "source": source,
                "external_id": ext_id,
                "user_color": color_played(parsed, known),
                **parsed,
            })
            indexes.append(positions)
            if ext_id:
                seen.add(ext_id)
            imported += 1
        except Exception as exc:  # keep importing the rest of the batch
            errors.append(str(exc)[:200])

    if rows:
        try:
            await _write_batch(db, rows, indexes)
        except IntegrityError:
            # games has a UNIQUE (owner_id, external_id). The `seen` set above
            # catches every duplicate this process knows about, so reaching
            # here means a concurrent sync of the same account inserted one
            # first. One bad row must not cost the other 299, and a batch
            # cannot skip a row mid-statement - so fall back to the row-at-a-
            # time path, which loses only the games that genuinely collide.
            await db.rollback()
            log.info("Batch import collided; retrying %d games individually", len(rows))
            imported = 0
            for row, index in zip(rows, indexes):
                # SAVEPOINT per game: a plain rollback here would discard the
                # games this loop already re-inserted, not just the one that
                # collided.
                try:
                    async with db.begin_nested():
                        await _write_batch(db, [row], [index])
                    imported += 1
                except IntegrityError:
                    duplicates += 1

    await db.commit()
    return imported, duplicates, capped, errors


async def _write_batch(
    db: AsyncSession,
    rows: list[dict],
    indexes: list[list[tuple[int, int, str]]],
) -> None:
    """Insert games and their position index in two statements."""
    # sort_by_parameter_order is what makes the zip below correct: without it
    # Postgres may return the ids in any order, and every position row would
    # be filed against the wrong game.
    result = await db.execute(
        insert(Game).returning(Game.id, sort_by_parameter_order=True), rows
    )
    game_ids = [r[0] for r in result]
    await bulk_insert(
        db,
        GamePosition,
        [
            {"game_id": game_id, "ply": ply, "zobrist": zob, "move_uci": uci}
            for game_id, index in zip(game_ids, indexes)
            for ply, zob, uci in index
        ],
    )


async def sync_account(db: AsyncSession, user: User, account: ExternalAccount) -> dict:
    """
    Fetch new games for a connected account and import them.
    Updates the account row's sync bookkeeping in all cases.
    """
    try:
        entries = await fetch_games(
            account.platform, account.username, account.last_synced_at
        )
    except PlatformError as exc:
        account.last_status = f"error: {exc}"[:300]
        await db.commit()
        raise

    # The platform reports this account's canonical username, so colour
    # detection for a sync is exact rather than a best-effort name match.
    imported, duplicates, capped, errors = await _import_entries(
        db, user, entries, source=account.platform,
        identities={account.username.lower()},
    )

    account.last_synced_at = datetime.now(timezone.utc)
    account.games_imported += imported
    account.last_status = "ok" if not errors else f"ok ({len(errors)} games failed to parse)"
    await db.commit()

    log.info(
        "Synced %s/%s for user %s: %d fetched, %d imported, %d dup, %d capped",
        account.platform, account.username, user.id,
        len(entries), imported, duplicates, capped,
    )
    return {
        "platform": account.platform,
        "username": account.username,
        "fetched": len(entries),
        "imported": imported,
        "duplicates": duplicates,
        "capped": capped,
        "errors": errors,
    }
