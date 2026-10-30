"""
Play a game against Stockfish.

One move per request: the client posts the current position and a difficulty
level, we enqueue a short skill-limited engine job, wait for its move on the
job's Redis channel, and return it. Levels map to Stockfish Skill Level + a
short movetime, giving beatable, increasingly strong opponents.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.chess_utils import validate_fen
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.engines import resolve_engine
from app.core.ratelimit import user_rate_limit
from app.core.redis_client import get_redis
from app.models import AnalysisJob, User
from app.schemas import PlayMoveIn, PlayMoveOut

router = APIRouter(prefix="/play", tags=["play"])

# level -> (Skill Level 0-20, movetime ms). Eight human-ish tiers.
LEVELS: dict[int, tuple[int, int]] = {
    1: (0, 100),
    2: (2, 150),
    3: (5, 200),
    4: (8, 300),
    5: (11, 400),
    6: (14, 600),
    7: (17, 800),
    8: (20, 1200),
}
MOVE_TIMEOUT_S = 15


async def _await_move(pubsub) -> str | None:
    """Wait for the worker's 'done' on this job's channel; return the UCI move."""
    try:
        async with asyncio.timeout(MOVE_TIMEOUT_S):
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = json.loads(message["data"])
                if data.get("type") == "done":
                    return data.get("best")
                if data.get("type") == "error":
                    return None
    except (asyncio.TimeoutError, TimeoutError):
        return None
    return None


# Every call holds an engine for up to 1.2s of search, so this endpoint is the
# cheapest way to burn the pool. Counted per account rather than per IP: a
# household or a school behind one address are separate players, and the engine
# time is charged to whoever's logged in. A real game needs roughly one move
# per second at bullet pace; 90/min leaves headroom without leaving it open.
@router.post(
    "/move",
    response_model=PlayMoveOut,
    dependencies=[user_rate_limit("play_move", limit=90, window_s=60)],
)
async def play_move(
    payload: PlayMoveIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        board = validate_fen(payload.fen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_fen", "message": str(exc)})

    if board.is_game_over():
        return PlayMoveOut(move=None, game_over=True)

    await resolve_engine("stockfish")
    skill, movetime = LEVELS.get(payload.level, LEVELS[4])

    job = AnalysisJob(
        user_id=user.id,
        kind="play",
        params={"fen": payload.fen, "skill": skill, "movetime": movetime},
        status="queued",
    )
    db.add(job)
    await db.commit()  # the INSERT returns the id; no refresh needed
    job_id = job.id

    redis = get_redis()
    pubsub = redis.pubsub()
    # Subscribe BEFORE enqueueing so we can't miss the worker's publish.
    await pubsub.subscribe(f"eval:{job_id}")
    try:
        queue = "q:stockfish:interactive"
        await redis.rpush(
            queue,
            json.dumps({
                "job_id": job_id, "kind": "play", "fen": payload.fen,
                "skill": skill, "movetime": movetime, "user_id": user.id,
            }),
        )
        move = await _await_move(pubsub)
    finally:
        await pubsub.unsubscribe(f"eval:{job_id}")
        await pubsub.aclose()

    if move is None:
        raise HTTPException(
            status_code=504,
            detail={"code": "engine_timeout", "message": "The engine did not reply in time."},
        )
    return PlayMoveOut(move=move, game_over=False)
