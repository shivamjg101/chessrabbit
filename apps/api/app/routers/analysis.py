"""Analysis endpoints: queue positions/games for the server-side engine."""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache

import chess
import chess.syzygy
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.chess_utils import validate_fen, zobrist_of
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import check_and_increment_usage, get_current_user
from app.core.engines import resolve_engine
from app.core.ratelimit import user_rate_limit
from app.core.redis_client import get_redis
from app.models import AnalysisCache, AnalysisJob, AnalysisSnapshot, Game, User
from app.schemas import AnalysePositionRequest, AnalysisJobOut

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _tablebase() -> chess.syzygy.Tablebase | None:
    """
    The process-wide Syzygy handle, or None when tablebases aren't installed.

    open_tablebase() opens and memory-maps every .rtbw/.rtbz in the directory -
    around 145 files for the 3-4-5 piece set. Doing that per request made a
    probe cost far more than the lookup it wrapped; the handle is safe to reuse
    for probing, so one instance serves the process.
    """
    if not settings.SYZYGY_PATH or not os.path.isdir(settings.SYZYGY_PATH):
        return None
    try:
        return chess.syzygy.open_tablebase(settings.SYZYGY_PATH)
    except (OSError, ValueError):
        log.warning("SYZYGY_PATH set but no tablebases could be opened", exc_info=True)
        return None



router = APIRouter(prefix="/analysis", tags=["analysis"])


class SaveSnapshot(BaseModel):
    job_id: int = Field(gt=0)
    note: str = Field(default="", max_length=2000)


def _snapshot_out(row: AnalysisSnapshot) -> dict:
    return {
        "id": row.id, "fen": row.fen, "engine_id": row.engine_id,
        "engine_version": row.engine_version,
        "engine_cache_key": row.cache_key, "depth": row.depth,
        "lines": row.lines, "note": row.note,
        "created_at": row.created_at.isoformat(),
    }


@router.post("/snapshots")
async def save_snapshot(
    payload: SaveSnapshot,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(AnalysisJob, payload.job_id)
    if job is None or job.user_id != user.id or job.kind != "position":
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Analysis job not found"})
    result = job.result or {}
    if job.status != "done" or not result.get("lines") or not result.get("engine_cache_key"):
        raise HTTPException(status_code=409, detail={"code": "not_ready", "message": "A completed position analysis with provenance is required"})
    await db.execute(
        pg_insert(AnalysisSnapshot).values(
            user_id=user.id, job_id=job.id, fen=job.params["fen"],
            engine_id=job.params["engine"], engine_version=result.get("engine_version") or "unknown",
            cache_key=result["engine_cache_key"],
            depth=result["depth"], lines=result["lines"], note=payload.note.strip(),
        ).on_conflict_do_nothing(index_elements=["job_id"])
    )
    await db.commit()
    row = (await db.execute(select(AnalysisSnapshot).where(AnalysisSnapshot.job_id == job.id))).scalar_one()
    return _snapshot_out(row)


@router.get("/snapshots")
async def list_snapshots(
    fen: str | None = Query(default=None, max_length=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisSnapshot).where(AnalysisSnapshot.user_id == user.id)
    if fen:
        query = query.where(AnalysisSnapshot.fen == fen)
    rows = (await db.execute(query.order_by(AnalysisSnapshot.created_at.desc()).limit(50))).scalars().all()
    return [_snapshot_out(row) for row in rows]


@router.post(
    "/position",
    response_model=AnalysisJobOut,
    dependencies=[user_rate_limit("analyse_position", 120, 60)],
)
async def analyse_position(
    payload: AnalysePositionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Request analysis of a position.

    Cache hit  -> returns the stored evaluation immediately (status='done').
    Cache miss -> enqueues a job; client subscribes to /ws/analysis for the stream.
    """
    try:
        if payload.variant == "chess960":
            board = chess.Board(payload.fen, chess960=True)
            if not board.is_valid():
                raise ValueError("Position is not legal")
        else:
            validate_fen(payload.fen)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_fen", "message": str(exc)},
        )

    # Clamp to local resource limits shared by every account
    engine = await resolve_engine(payload.engine)
    depth = min(payload.depth, settings.ENGINE_MAX_DEPTH)
    multipv = min(payload.multipv, settings.ENGINE_MAX_MULTIPV)
    zob = zobrist_of(payload.fen) if payload.variant == "standard" else None

    hit = None
    if zob is not None:
        cached = await db.execute(
            select(AnalysisCache).where(
                AnalysisCache.zobrist == zob, AnalysisCache.depth >= depth,
                AnalysisCache.engine_version == engine["cache_key"],
                func.jsonb_array_length(AnalysisCache.multipv) >= multipv
            ).limit(1)
        )
        hit = cached.scalar_one_or_none()
    if hit:
        job = AnalysisJob(
            user_id=user.id, kind="position",
            params={"fen": payload.fen, "depth": depth, "multipv": multipv, "engine": payload.engine, "variant": payload.variant},
            status="done",
            result={"cached": True, "depth": hit.depth, "lines": hit.multipv[:multipv], "engine": payload.engine, "engine_version": engine.get("version"), "engine_cache_key": engine["cache_key"]},
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        return AnalysisJobOut(job_id=job.id, status="done", cached=True, result=job.result)

    # Cache miss: meter it, then queue
    await check_and_increment_usage(db, user)

    job = AnalysisJob(
        user_id=user.id, kind="position",
        params={"fen": payload.fen, "depth": depth, "multipv": multipv, "engine": payload.engine, "variant": payload.variant},
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    queue = f"q:{payload.engine}:interactive"
    await get_redis().rpush(
        queue,
        json.dumps({
            "job_id": job.id, "kind": "position", "fen": payload.fen,
            "depth": depth, "multipv": multipv, "user_id": user.id, "engine": payload.engine,
            "variant": payload.variant,
        }),
    )

    return AnalysisJobOut(job_id=job.id, status="queued", cached=False)


# Reviews have a request-rate limit to protect local resources.
@router.post(
    "/game/{game_id}",
    response_model=AnalysisJobOut,
    dependencies=[user_rate_limit("analyse_game", 30, 60)],
)
async def analyse_full_game(
    game_id: int,
    engine: str = Query(default="stockfish", pattern=r"^[a-z0-9_-]{1,40}$"),
    depth: int = Query(default=18, ge=1, le=40),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Queue a full-game annotation pass. All accounts have access."""
    await resolve_engine(engine)
    depth = min(depth, settings.ENGINE_MAX_DEPTH)
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Game not found"},
        )

    job = AnalysisJob(
        user_id=user.id, game_id=game_id, kind="full_game",
        params={"depth": depth, "engine": engine}, status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Batch jobs run behind interactive position requests.
    await get_redis().rpush(
        f"q:{engine}:batch",
        json.dumps({
            "job_id": job.id, "kind": "full_game", "game_id": game_id,
            "user_id": user.id, "depth": depth, "engine": engine,
        }),
    )
    return AnalysisJobOut(job_id=job.id, status="queued")


# 25 full-game reviews per call, so this is the single heaviest request in the
# API. Five a minute is still 125 games queued per minute per account.
@router.post(
    "/collection/{collection_id}",
    response_model=list[AnalysisJobOut],
    dependencies=[user_rate_limit("analyse_collection", 5, 60)],
)
async def analyse_collection(
    collection_id: int,
    engine: str = Query(default="stockfish", pattern=r"^[a-z0-9_-]{1,40}$"),
    depth: int = Query(default=18, ge=1, le=40),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Queue a full-game annotation pass for every game in a collection.

    Capped at 25 games per request to keep one user from monopolising the
    engine pool; call again for the next batch.
    """
    from app.models import Collection, CollectionGame

    await resolve_engine(engine)
    depth = min(depth, settings.ENGINE_MAX_DEPTH)
    col = await db.get(Collection, collection_id)
    if col is None or col.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Collection not found"},
        )

    # Join through games and re-check ownership rather than trusting membership:
    # a collection row is only as trustworthy as every path that ever wrote to
    # it, and the job result this produces is readable by the caller.
    rows = await db.execute(
        select(CollectionGame.game_id)
        .join(Game, Game.id == CollectionGame.game_id)
        .where(
            CollectionGame.collection_id == collection_id,
            (Game.owner_id == user.id) | (Game.owner_id.is_(None)),
        )
        .limit(25)
    )
    game_ids = [r[0] for r in rows.all()]
    if not game_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "empty_collection", "message": "Collection has no games"},
        )

    redis = get_redis()

    # One INSERT for the whole batch. sort_by_parameter_order is what lets the
    # returned ids be zipped back to their game ids below; without it Postgres
    # is free to return them in any order and every queued job would name the
    # wrong game.
    result = await db.execute(
        insert(AnalysisJob).returning(AnalysisJob.id, sort_by_parameter_order=True),
        [
            {
                "user_id": user.id, "game_id": gid, "kind": "full_game",
                "params": {"depth": depth, "engine": engine}, "status": "queued",
            }
            for gid in game_ids
        ],
    )
    out = [AnalysisJobOut(job_id=row[0], status="queued") for row in result]
    await db.commit()

    # Queue after the commit, in one pipeline: a worker that picks a job up
    # before its row is visible fails looking it up, and 25 sequential rpushes
    # is 25 round trips to Redis for what is one write batch.
    pipe = redis.pipeline(transaction=False)
    for job_out, gid in zip(out, game_ids):
        pipe.rpush(
            f"q:{engine}:batch",
            json.dumps({
                "job_id": job_out.job_id, "kind": "full_game",
                "game_id": gid, "user_id": user.id, "depth": depth, "engine": engine,
            }),
        )
    await pipe.execute()
    return out


@router.get("/tablebase")
async def tablebase_probe(
    fen: str,
    user: User = Depends(get_current_user),
):
    """
    Exact endgame result for positions with <= 7 pieces.

    Sources, in order:
    1. Chess rules - insufficient-material positions are draws, no files needed.
    2. Syzygy tablebases on disk (SYZYGY_PATH) - exact WDL + DTZ.
    If neither applies, returns available=false with install instructions
    rather than an error: absence of tablebases is a configuration state,
    not a client mistake.
    """
    try:
        board = validate_fen(fen)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_fen", "message": str(exc)},
        )

    piece_count = chess.popcount(board.occupied)
    if piece_count > 7:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "too_many_pieces",
                "message": f"Tablebases cover at most 7 pieces; position has {piece_count}",
            },
        )

    side = "white" if board.turn == chess.WHITE else "black"

    # Exact by rule: neither side can ever mate.
    if board.is_insufficient_material():
        return {
            "available": True,
            "source": "rules",
            "pieces": piece_count,
            "side_to_move": side,
            "wdl": 0,
            "dtz": None,
            "category": "draw",
            "detail": "Insufficient mating material",
        }

    tb = _tablebase()
    if tb is not None:
        try:
            wdl = tb.probe_wdl(board)   # side-to-move view: 2/1/0/-1/-2
            dtz = tb.probe_dtz(board)
        except (KeyError, chess.syzygy.MissingTableError):
            return {
                "available": False,
                "pieces": piece_count,
                "message": f"No table for this {piece_count}-piece material balance "
                           f"in SYZYGY_PATH; download the matching .rtbw/.rtbz files.",
            }

        category = {
            2: "win", 1: "cursed-win", 0: "draw",
            -1: "blessed-loss", -2: "loss",
        }[wdl]
        return {
            "available": True,
            "source": "syzygy",
            "pieces": piece_count,
            "side_to_move": side,
            "wdl": wdl,
            "dtz": dtz,
            "category": category,
            "detail": f"{side} to move: {category}"
                      + (f", zeroing in {abs(dtz)}" if dtz else ""),
        }

    return {
        "available": False,
        "pieces": piece_count,
        "message": "Syzygy tablebases not installed. Download 3-4-5 piece files "
                   "(~1 GB) from tablebase.lichess.ovh and set SYZYGY_PATH.",
    }


@router.get("/jobs/{job_id}", response_model=AnalysisJobOut)
async def get_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(AnalysisJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Job not found"})
    return AnalysisJobOut(
        job_id=job.id, status=job.status,
        cached=bool((job.result or {}).get("cached")), result=job.result,
    )


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_job(
    job_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.get(AnalysisJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Job not found"})
    if job.status in ("queued", "running"):
        job.status = "canceled"
        await db.commit()
        try:
            redis = get_redis()
            await redis.set(f"cancel:{job.id}", "1", ex=300)
            await redis.publish(f"cancel:{job.id}", "1")
        except Exception:
            log.warning("Could not notify worker of canceled job %s", job.id, exc_info=True)
