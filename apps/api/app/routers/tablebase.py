"""
Endgame tablebase: the exact result of every move, seven pieces or fewer.

`/analysis/tablebase` answers one question about one position from the
Syzygy files on disk. The board's Tablebase tab needs more than that - the
verdict of every legal move, which is how a tablebase is actually read - and
it needs an answer on the many installs that have no tables at all.

So, in order: the rules (insufficient material is a draw without any files),
local Syzygy tables when SYZYGY_PATH has them (offline, and the local-first
answer), then Lichess's public tablebase. Each answer says which one it came
from.
"""

from __future__ import annotations

import chess
import chess.syzygy
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.chess_utils import validate_fen
from app.core.deps import get_current_user
from app.core.ratelimit import rate_limit
from app.models import User
from app.routers.analysis import _tablebase
from app.schemas import TablebaseMove, TablebaseOut
from app.services.tablebase import MAX_PIECES, TablebaseUnavailable, probe

router = APIRouter(tags=["tablebase"])

# Syzygy WDL, from the side to move's point of view, in Lichess's vocabulary.
_CATEGORY = {2: "win", 1: "cursed-win", 0: "draw", -1: "blessed-loss", -2: "loss"}


def piece_count(board: chess.Board) -> int:
    return chess.popcount(board.occupied)


def _local(board: chess.Board, tb: chess.syzygy.Tablebase) -> TablebaseOut | None:
    """
    Every legal move probed against the tables on disk, or None when a table
    this material balance needs is missing - a partial set of files is the
    common case (3-4-5 installed, 6 and 7 not).
    """
    try:
        wdl = tb.probe_wdl(board)
        dtz = tb.probe_dtz(board)
        moves: list[TablebaseMove] = []
        for move in board.legal_moves:
            san = board.san(move)
            zeroing = board.is_zeroing(move)
            board.push(move)
            try:
                if board.is_checkmate():
                    after = TablebaseMove(
                        uci=move.uci(), san=san, category="loss", dtz=0,
                        zeroing=zeroing, checkmate=True,
                    )
                elif board.is_stalemate():
                    after = TablebaseMove(
                        uci=move.uci(), san=san, category="draw", dtz=0,
                        zeroing=zeroing, stalemate=True,
                    )
                else:
                    after = TablebaseMove(
                        uci=move.uci(), san=san,
                        category=_CATEGORY[tb.probe_wdl(board)],
                        dtz=tb.probe_dtz(board), zeroing=zeroing,
                    )
            finally:
                board.pop()
            moves.append(after)
    except (KeyError, chess.syzygy.MissingTableError):
        return None

    return TablebaseOut(
        fen=board.fen(), source="syzygy", category=_CATEGORY[wdl], dtz=dtz,
        moves=moves,
    )


@router.get(
    "/tablebase",
    response_model=TablebaseOut,
    dependencies=[rate_limit("tablebase", 120, 60)],
)
async def tablebase(
    fen: str = Query(max_length=120),
    user: User = Depends(get_current_user),
):
    try:
        board = validate_fen(fen)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_fen", "message": str(exc)},
        ) from None

    # Refused here rather than forwarded: the online service would answer
    # "unknown" for eight pieces, and asking about every middlegame position
    # the board visits would be a request per move for nothing.
    if piece_count(board) > MAX_PIECES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "too_many_pieces",
                "message": f"Tablebases cover positions with {MAX_PIECES} pieces or fewer.",
            },
        )

    if board.is_insufficient_material():
        return TablebaseOut(
            fen=board.fen(), source="rules", category="draw", insufficient_material=True,
        )

    tb = _tablebase()
    if tb is not None:
        local = _local(board, tb)
        if local is not None:
            return local

    try:
        data = await probe(board.fen())
    except TablebaseUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "tablebase_unavailable", "message": str(exc)},
        ) from None

    return TablebaseOut(
        fen=board.fen(),
        source="lichess",
        category=str(data.get("category") or "unknown"),
        dtz=data.get("dtz"),
        dtm=data.get("dtm"),
        checkmate=bool(data.get("checkmate")),
        stalemate=bool(data.get("stalemate")),
        insufficient_material=bool(data.get("insufficient_material")),
        moves=[
            TablebaseMove(
                uci=str(m.get("uci", "")),
                san=str(m.get("san", m.get("uci", ""))),
                category=str(m.get("category") or "unknown"),
                dtz=m.get("dtz"),
                dtm=m.get("dtm"),
                zeroing=bool(m.get("zeroing")),
                checkmate=bool(m.get("checkmate")),
                stalemate=bool(m.get("stalemate")),
            )
            for m in data.get("moves", [])
            if isinstance(m, dict)
        ],
    )
