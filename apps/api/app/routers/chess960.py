"""Small server-validated Chess960 board, independent of standard game indexing."""

import chess
import chess.pgn
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.deps import get_current_user
from app.core.db import get_db
from app.core.ratelimit import user_rate_limit
from app.models import User
from app.routers.games import import_games
from app.schemas import ImportPgnRequest
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/chess960", tags=["chess960"])


class MoveRequest(BaseModel):
    fen: str = Field(max_length=200)
    uci: str = Field(pattern=r"^[a-h][1-8][a-h][1-8][qrbn]?$", max_length=5)


class SaveGame(BaseModel):
    index: int = Field(ge=0, le=959)
    moves: list[str] = Field(max_length=400)
    white: str = Field(default="White", max_length=200)
    black: str = Field(default="Black", max_length=200)


def _out(board: chess.Board) -> dict:
    return {
        "fen": board.fen(shredder=True),
        "turn": "white" if board.turn else "black",
        "moves": [{"san": board.san(move), "uci": move.uci()} for move in board.legal_moves],
        "result": board.result(claim_draw=True) if board.is_game_over(claim_draw=True) else None,
    }


@router.get("/start")
async def start(index: int = Query(ge=0, le=959), _user: User = Depends(get_current_user)):
    return _out(chess.Board.from_chess960_pos(index))


@router.post("/move")
async def move(payload: MoveRequest, _user: User = Depends(get_current_user)):
    try:
        board = chess.Board(payload.fen, chess960=True)
        if not board.is_valid():
            raise ValueError("Invalid position")
        played = chess.Move.from_uci(payload.uci)
    except ValueError as exc:
        raise HTTPException(400, "Invalid Chess960 position or move") from exc
    if played not in board.legal_moves:
        raise HTTPException(400, "Illegal Chess960 move")
    board.push(played)
    return _out(board)


@router.post("/save", dependencies=[user_rate_limit("import_pgn", 20, 60)])
async def save_game(
    payload: SaveGame,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.moves:
        raise HTTPException(400, "Play at least one move before saving")
    board = chess.Board.from_chess960_pos(payload.index)
    game = chess.pgn.Game.from_board(board)
    game.headers["Event"] = "Chess960 practice"
    game.headers["White"] = payload.white.strip() or "White"
    game.headers["Black"] = payload.black.strip() or "Black"
    node = game
    for uci in payload.moves:
        try:
            played = chess.Move.from_uci(uci)
        except ValueError as exc:
            raise HTTPException(400, "Invalid Chess960 move") from exc
        if played not in board.legal_moves:
            raise HTTPException(400, "Illegal Chess960 move")
        node = node.add_variation(played)
        board.push(played)
    game.headers["Result"] = board.result(claim_draw=True) if board.is_game_over(claim_draw=True) else "*"
    imported = await import_games(ImportPgnRequest(pgn=str(game)), user, db)
    return {"game_id": imported.game_ids[0]}
