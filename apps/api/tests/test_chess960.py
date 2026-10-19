import chess
import pytest
from fastapi import HTTPException

from app.routers.chess960 import MoveRequest, move, start


@pytest.mark.asyncio
async def test_chess960_start_and_castling_use_variant_legal_moves():
    position = await start(518, object())
    assert position["fen"].split()[2] == "HAha"
    assert position["turn"] == "white"

    fen = "rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1"
    board = chess.Board(fen, chess960=True)
    assert board.is_valid()
    result = await move(MoveRequest(fen=fen, uci="b1h1"), object())
    assert result["fen"].split()[0].endswith("R4RK1")
    with pytest.raises(HTTPException, match="Illegal"):
        await move(MoveRequest(fen=fen, uci="b1b8"), object())
