"""
Tactics puzzle trainer.

Puzzles come from the Lichess open puzzle database (CC0): a FEN plus a UCI
solution line whose first move is the opponent's setup (played automatically),
after which the solver must find the rest. `/puzzles/next` serves one near the
player's tactics rating; `/puzzles/attempt` records the result and nudges that
rating Elo-style so difficulty tracks the player.

Solutions are sent to the client, which validates moves locally (standard for
puzzle trainers - the same is true on Lichess). The rating that matters is
updated server-side from the reported outcome.
"""

from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.http_cache import cached_json, etag_response
from app.models import Puzzle, PuzzleAttempt, User
from app.schemas import (
    PuzzleAttemptIn,
    PuzzleAttemptResult,
    PuzzleOut,
    PuzzleStats,
    PuzzleTheme,
)

router = APIRouter(prefix="/puzzles", tags=["puzzles"])

RATING_WINDOW = 300     # how far from the player's rating we look first
K_FACTOR = 32           # Elo responsiveness
RATING_FLOOR, RATING_CEIL = 400, 3200

# How many rows an index range scan walks before we choose one, and how many
# random pivots we try before giving up on a window. See _pick_puzzle.
CANDIDATE_BATCH = 40
PIVOT_ATTEMPTS = 3

# The theme histogram only moves when pipeline/load_puzzles.py runs.
THEMES_TTL = 86400


def _like_escape(value: str) -> str:
    """Neutralise LIKE metacharacters so a themed search stays a substring match."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _pick_puzzle(
    db: AsyncSession,
    user_id: int,
    lo: int,
    hi: int,
    theme: str | None,
    exclude_seen: bool = True,
    source: str = "public",
) -> Puzzle | None:
    """
    One puzzle rated within [lo, hi], chosen without sorting the table.

    `ORDER BY random() LIMIT 1` had to assign a random key to every candidate
    row and sort them all to take one - a full scan of `puzzles` on every
    request, which on the full Lichess dump is millions of rows for a single
    puzzle served. Instead: drop a uniform pivot inside the rating window and
    let puzzles_rating_idx walk a bounded batch forward from it, then choose in
    Python. A final range scan handles sparse datasets where every random
    pivot happens to land above the available rows.
    """
    lo = max(RATING_FLOOR, min(lo, RATING_CEIL))
    hi = max(lo, min(hi, RATING_CEIL))

    stmt = select(Puzzle).where(Puzzle.rating >= lo, Puzzle.rating <= hi)
    stmt = stmt.where(
        Puzzle.owner_id == user_id if source == "mine" else Puzzle.owner_id.is_(None)
    )
    if exclude_seen:
        stmt = stmt.where(
            Puzzle.id.not_in(
                select(PuzzleAttempt.puzzle_id).where(PuzzleAttempt.user_id == user_id)
            )
        )
    if theme:
        stmt = stmt.where(Puzzle.themes.like(f"%{_like_escape(theme)}%", escape="\\"))

    for _ in range(PIVOT_ATTEMPTS):
        rows = (
            await db.execute(
                stmt.where(Puzzle.rating >= random.randint(lo, hi))
                .order_by(Puzzle.rating).limit(CANDIDATE_BATCH)
            )
        ).scalars().all()
        if rows:
            return random.choice(rows)
    rows = (
        await db.execute(stmt.order_by(Puzzle.rating).limit(CANDIDATE_BATCH))
    ).scalars().all()
    return random.choice(rows) if rows else None


def _to_out(p: Puzzle) -> PuzzleOut:
    return PuzzleOut(
        id=p.id,
        lichess_id=p.lichess_id,
        fen=p.fen,
        moves=p.moves.split(),
        rating=p.rating,
        themes=(p.themes or "").split(),
        game_url=p.game_url,
    )


@router.get("/themes", response_model=list[PuzzleTheme])
async def list_themes(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The most common themes across loaded puzzles, for the filter dropdown.

    The query unnests every theme of every puzzle - a full scan of the largest
    static table we have - and returns the same 25 rows to everybody until
    somebody reloads the puzzle dump. It was running on each open of the
    dropdown. Cached for a day in Redis; the ETag then keeps the repeat opens
    off the wire entirely.

    Private, not public: the endpoint requires a token, and no proxy needs to
    learn to tell this response apart from the personalised ones next to it.
    """

    async def produce() -> list[dict]:
        rows = await db.execute(
            text(
                """
                SELECT theme, COUNT(*) AS n
                FROM (SELECT unnest(string_to_array(themes, ' ')) AS theme
                      FROM puzzles WHERE owner_id IS NULL) t
                WHERE theme <> ''
                GROUP BY theme
                ORDER BY n DESC
                LIMIT 25
                """
            )
        )
        return [{"theme": r[0], "count": r[1]} for r in rows.all()]

    payload = await cached_json("puzzles:themes", THEMES_TTL, produce)
    return etag_response(request, payload, max_age=600)




@router.post("/rush/start")
async def start_rush(user: User = Depends(get_current_user)):
    """Gate Puzzle Rush runs per day on the free tier."""
    return {"ok": True}


@router.post("/clock/start")
async def start_clock_drill(user: User = Depends(get_current_user)):
    """Gate Time Bank drill sessions per day on the free tier."""
    return {"ok": True}


@router.get("/next", response_model=PuzzleOut)
async def next_puzzle(
    theme: str | None = Query(default=None, max_length=40),
    rating: int | None = Query(default=None, ge=RATING_FLOOR, le=RATING_CEIL),
    mode: str = Query(default="practice", pattern="^(practice|rush|clock)$"),
    source: str = Query(default="public", pattern="^(public|mine)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    A public puzzle or one extracted from the player's own games, near a target
    rating (their own by default), optionally filtered by theme.

    The daily puzzle quota applies to practice only - rush and clock serves
    are covered by their own once-a-day session gates.
    """

    center = rating if rating is not None else user.puzzle_rating
    if source == "mine" and mode != "practice":
        raise HTTPException(status_code=400, detail={"code": "bad_source", "message": "Personal puzzles are for practice mode"})
    lo, hi = center - RATING_WINDOW, center + RATING_WINDOW

    # 1) unseen, near rating, matching theme -> 2) unseen at any rating ->
    # 3) anything (the player has solved everything the filter allows)
    for args in (
        (lo, hi, theme, True),
        (RATING_FLOOR, RATING_CEIL, theme, True),
        (RATING_FLOOR, RATING_CEIL, theme, False),
    ):
        puzzle = await _pick_puzzle(db, user.id, *args, source=source)
        if puzzle is not None:
            return _to_out(puzzle)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "no_puzzles", "message": (
            "Review your games to create personal puzzles."
            if source == "mine" else "No puzzles loaded. Run pipeline/load_puzzles.py."
        )},
    )


@router.post("/attempt", response_model=PuzzleAttemptResult)
async def record_attempt(
    payload: PuzzleAttemptIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record a solve/fail; only public puzzles change tactics rating."""
    puzzle = await db.get(Puzzle, payload.puzzle_id)
    if puzzle is None or (puzzle.owner_id is not None and puzzle.owner_id != user.id):
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Puzzle not found"},
        )

    before = user.puzzle_rating
    expected = 1.0 / (1.0 + 10 ** ((puzzle.rating - before) / 400.0))
    score = 1.0 if payload.solved else 0.0
    after = round(before + K_FACTOR * (score - expected)) if puzzle.owner_id is None else before
    after = max(RATING_FLOOR, min(RATING_CEIL, after))

    user.puzzle_rating = after
    db.add(
        PuzzleAttempt(
            user_id=user.id, puzzle_id=puzzle.id, solved=payload.solved,
            rating_before=before, rating_after=after,
        )
    )
    await db.commit()

    return PuzzleAttemptResult(
        solved=payload.solved,
        rating_before=before,
        rating_after=after,
        delta=after - before,
        puzzle_rating=puzzle.rating,
    )


@router.get("/stats", response_model=PuzzleStats)
async def puzzle_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Solve counts and the player's current solved streak."""
    totals = (
        await db.execute(
            select(
                func.count(PuzzleAttempt.id),
                func.count(PuzzleAttempt.id).filter(PuzzleAttempt.solved.is_(True)),
            ).where(PuzzleAttempt.user_id == user.id)
        )
    ).one()
    attempted, solved = totals[0], totals[1]

    recent = (
        await db.execute(
            select(PuzzleAttempt.solved)
            .where(PuzzleAttempt.user_id == user.id)
            .order_by(PuzzleAttempt.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    streak = 0
    for ok in recent:
        if not ok:
            break
        streak += 1

    return PuzzleStats(
        puzzle_rating=user.puzzle_rating,
        solved=solved,
        attempted=attempted,
        streak=streak,
    )
