"""Opening explorer and reference-database search."""

from __future__ import annotations

import json
import logging
from datetime import date

import chess
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.chess_utils import validate_fen, zobrist_of
from app.core.db import get_db
from app.core.deps import get_optional_user
from app.core.ratelimit import rate_limit
from app.core.redis_client import get_redis
from app.models import User
from app.schemas import ExplorerMove, ExplorerOut, ExplorerRequest, GameOut, SearchResults
from app.services.lichess_explorer import ExplorerUnavailable, masters_moves

log = logging.getLogger(__name__)
router = APIRouter(tags=["explorer"])

# The reference tree only changes when we reload a dump, so this can be long.
EXPLORER_TTL = 86400


async def _lichess_live(fen: str, token: str | None = None) -> ExplorerOut:
    """Map Lichess's live masters response to our ExplorerOut shape."""
    try:
        data = await masters_moves(fen, token)
    except ExplorerUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": exc.code, "message": str(exc)},
        )

    moves: list[ExplorerMove] = []
    for m in data.get("moves", []):
        w, d, b = m.get("white", 0), m.get("draws", 0), m.get("black", 0)
        n = max(1, w + d + b)
        moves.append(
            ExplorerMove(
                uci=m.get("uci", ""),
                san=m.get("san", m.get("uci", "")),
                games=w + d + b,
                white_wins=w, draws=d, black_wins=b,
                avg_elo=m.get("averageRating"),
                white_pct=round(100 * w / n, 1),
                draw_pct=round(100 * d / n, 1),
                black_pct=round(100 * b / n, 1),
            )
        )

    total = data.get("white", 0) + data.get("draws", 0) + data.get("black", 0)
    return ExplorerOut(fen=fen, total_games=total, moves=moves)


@router.post("/explorer", response_model=ExplorerOut)
async def explorer(
    payload: ExplorerRequest,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """
    Move statistics for a position.

    scope="reference" (default): precomputed opening_tree of master games.
    scope="mine": aggregated live from the caller's own imported games -
    the Personal Opening Tree. Requires auth; user collections are small
    enough (free tier caps at 50 games) that an indexed GROUP BY at query
    time beats maintaining a second tree.
    scope="lichess_live": queried on demand from Lichess's Opening Explorer
    API, so the masters statistics are always current (not our snapshot).
    """
    try:
        board = validate_fen(payload.fen)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_fen", "message": str(exc)},
        )

    if payload.scope == "lichess_live":
        return await _lichess_live(payload.fen, payload.lichess_token.get_secret_value() if payload.lichess_token else None)

    zob = zobrist_of(payload.fen)

    # The reference tree is a static snapshot and openings are power-law
    # distributed, so a small cache absorbs most of the traffic the analysis
    # board generates. Keyed on the position, not the FEN string, so
    # transpositions share an entry. "mine" is per-user and changes on import,
    # so it is deliberately not cached here.
    cache_key = f"exp:ref:{zob}" if payload.scope == "reference" else None
    if cache_key:
        try:
            hit = await get_redis().get(cache_key)
            if hit:
                return ExplorerOut(**json.loads(hit))
        except Exception:
            log.warning("explorer cache read failed", exc_info=True)

    if payload.scope == "mine":
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "auth_required", "message": "Sign in to see your own games"},
            )
        rows = await db.execute(
            text(
                """
                SELECT p.move_uci,
                       COUNT(*)                                    AS games,
                       COUNT(*) FILTER (WHERE g.result = '1-0')    AS white_wins,
                       COUNT(*) FILTER (WHERE g.result = '1/2-1/2') AS draws,
                       COUNT(*) FILTER (WHERE g.result = '0-1')    AS black_wins,
                       AVG(GREATEST(g.white_elo, g.black_elo))::smallint AS avg_elo
                FROM game_positions p
                JOIN games g ON g.id = p.game_id
                WHERE p.zobrist = :zob AND g.owner_id = :uid
                GROUP BY p.move_uci
                ORDER BY games DESC
                LIMIT 20
                """
            ),
            {"zob": zob, "uid": user.id},
        )
    else:
        rows = await db.execute(
            text(
                """
                SELECT move_uci, games, white_wins, draws, black_wins, avg_elo
                FROM opening_tree
                WHERE zobrist = :zob
                ORDER BY games DESC
                LIMIT 20
                """
            ),
            {"zob": zob},
        )

    moves: list[ExplorerMove] = []
    total = 0
    for r in rows.mappings():
        total += r["games"]
        n = max(1, r["games"])
        try:
            san = board.san(chess.Move.from_uci(r["move_uci"]))
        except (ValueError, AssertionError):
            san = r["move_uci"]

        moves.append(
            ExplorerMove(
                uci=r["move_uci"], san=san, games=r["games"],
                white_wins=r["white_wins"], draws=r["draws"], black_wins=r["black_wins"],
                avg_elo=r["avg_elo"],
                white_pct=round(100 * r["white_wins"] / n, 1),
                draw_pct=round(100 * r["draws"] / n, 1),
                black_pct=round(100 * r["black_wins"] / n, 1),
            )
        )

    out = ExplorerOut(fen=payload.fen, total_games=total, moves=moves)

    if cache_key:
        try:
            await get_redis().setex(cache_key, EXPLORER_TTL, out.model_dump_json())
        except Exception:
            log.warning("explorer cache write failed", exc_info=True)

    return out


"""
How many results a page holds.

Fifty is the blueprint's cap (§8.4). One extra row is always fetched and then
discarded: it is what answers "is there a next page" without a COUNT over a
filtered five-million-row table, which costs more than the page itself.
"""
PAGE = 50

# Every paged query below ends `ORDER BY <rank> DESC NULLS LAST, g.id DESC`.
# The id is not decoration - it is what makes the sort a TOTAL order. Ranking
# by top Elo alone leaves every game sharing a rating in an order Postgres may
# choose differently on each execution, and LIMIT/OFFSET then hands the same
# game out on two pages while never showing another at all. Measured on 5,000
# seeded games: three pages of 50 returned 145 distinct games.

def _like_escape(value: str) -> str:
    """Neutralise LIKE metacharacters so a search stays a substring match."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _paged(rows: list, page: int) -> SearchResults:
    return SearchResults(
        games=[GameOut(**dict(r)) for r in rows[:PAGE]],
        page=page,
        has_more=len(rows) > PAGE,
    )


@router.post(
    "/search/position",
    response_model=SearchResults,
    # Public, and the heaviest read in the API: an index probe plus a join per
    # result. Per IP rather than per account because a share link and a curious
    # crawler both arrive without one (BLUEPRINT 8.4, 12.2).
    dependencies=[rate_limit("search_position", 60, 60)],
)
async def search_by_position(
    payload: ExplorerRequest,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """
    Find games that reached this exact position (BLUEPRINT 10.3): reference
    games by default, or with scope="mine" your own - which on a new install,
    with no reference database loaded, is the only search that finds anything.
    """
    try:
        validate_fen(payload.fen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_fen", "message": str(exc)})

    if payload.scope == "mine":
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "auth_required", "message": "Sign in to search your own games"},
            )
        owner, params = "g.owner_id = :uid", {"uid": user.id}
    else:
        owner, params = "g.owner_id IS NULL", {}

    # A semi-join rather than a join: a position repeated within one game (a
    # knight shuffle, a repetition) is one hit, not that game listed twice.
    rows = await db.execute(
        text(
            f"""
            SELECT g.id, g.white, g.black, g.white_elo, g.black_elo, g.result,
                   g.event, g.played_on, g.eco, g.opening, g.ply_count
            FROM games g
            WHERE {owner}
              AND g.id IN (SELECT p.game_id FROM game_positions p WHERE p.zobrist = :zob)
            ORDER BY GREATEST(g.white_elo, g.black_elo) DESC NULLS LAST, g.id DESC
            LIMIT :lim OFFSET :off
            """
        ),
        {"zob": zobrist_of(payload.fen), "lim": PAGE + 1, "off": (page - 1) * PAGE, **params},
    )
    return _paged(list(rows.mappings()), page)


@router.get(
    "/search/games",
    response_model=SearchResults,
    dependencies=[rate_limit("search_games", 60, 60)],
)
async def search_games(
    # Bounded like `opening` already was. These land in a LIKE pattern against
    # a five-million-row table, and an unbounded one is a cheap request that
    # buys expensive work.
    white: str | None = Query(default=None, max_length=100),
    black: str | None = Query(default=None, max_length=100),
    eco: str | None = Query(default=None, max_length=8),
    opening: str | None = Query(default=None, max_length=100),
    result: str | None = None,
    min_elo: int | None = Query(default=None, ge=0, le=4000),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """
    Metadata search over the public reference database (BLUEPRINT 8.4).

    Every LIKE here is an infix match, which a btree cannot answer. The trigram
    GIN indexes from migration 012 (names) and 015 (opening) are what keep this
    off a sequential scan - do not "optimise" these into prefix matches without
    checking the plan, and do not add a new LIKE column without an index to go
    with it.
    """
    clauses = ["g.owner_id IS NULL"]
    params: dict = {"lim": PAGE + 1, "off": (page - 1) * PAGE}

    # `%` and `_` are wildcards to LIKE, not letters. Passing them through
    # unescaped let a one-character search ("%") match every game in the
    # reference database, which is a full scan the trigram index cannot help
    # with - the cheapest denial-of-service in the API. Escaping them makes the
    # box search for the characters the user typed, which is also what they
    # meant. (Not an injection: values are bound, never interpolated.)
    if white:
        clauses.append("lower(g.white) LIKE :white ESCAPE '\\'")
        params["white"] = f"%{_like_escape(white.lower())}%"
    if black:
        clauses.append("lower(g.black) LIKE :black ESCAPE '\\'")
        params["black"] = f"%{_like_escape(black.lower())}%"
    if eco:
        clauses.append("g.eco = :eco")
        params["eco"] = eco.upper()[:3]
    if opening:
        clauses.append("lower(g.opening) LIKE :opening ESCAPE '\\'")
        params["opening"] = f"%{_like_escape(opening.lower())}%"
    if result in ("1-0", "0-1", "1/2-1/2", "*"):
        clauses.append("g.result = :result")
        params["result"] = result
    if min_elo:
        clauses.append("GREATEST(g.white_elo, g.black_elo) >= :min_elo")
        params["min_elo"] = min_elo
    # A game with no date is excluded by either bound rather than treated as
    # matching: "games since 2020" should not hand back everything undated.
    if date_from:
        clauses.append("g.played_on >= :date_from")
        params["date_from"] = date_from
    if date_to:
        clauses.append("g.played_on <= :date_to")
        params["date_to"] = date_to

    sql = f"""
        SELECT g.id, g.white, g.black, g.white_elo, g.black_elo, g.result,
               g.event, g.played_on, g.eco, g.opening, g.ply_count
        FROM games g
        WHERE {' AND '.join(clauses)}
        ORDER BY GREATEST(g.white_elo, g.black_elo) DESC NULLS LAST, g.id DESC
        LIMIT :lim OFFSET :off
    """
    rows = await db.execute(text(sql), params)
    return _paged(list(rows.mappings()), page)
