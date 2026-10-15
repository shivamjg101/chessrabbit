from types import SimpleNamespace
from unittest.mock import AsyncMock

import chess
import chess.pgn
import pytest
from fastapi import HTTPException

from app.core.chess_utils import game_from_movetext, parse_pgn, positions_of_game
from app.routers import chess960 as chess960_router
from app.routers.games import export_game_pgn, get_game_line


def _pgn(index=0):
    board = chess.Board.from_chess960_pos(index)
    game = chess.pgn.Game.from_board(board)
    move = next(iter(board.legal_moves))
    game.add_main_variation(move)
    return str(game), move


def test_chess960_import_preserves_start_and_skips_standard_index():
    pgn, move = _pgn()
    parsed = parse_pgn(pgn)
    assert len(parsed) == 1
    game = parsed[0]
    assert game["variant"] == "chess960"
    assert game["start_fen"] == chess.Board.from_chess960_pos(0).fen(shredder=True)
    assert positions_of_game(game["movetext"], variant="chess960", start_fen=game["start_fen"]) == []
    replay = game_from_movetext(game["movetext"], game["variant"], game["start_fen"])
    assert replay.board().chess960
    assert list(replay.mainline_moves()) == [move]


@pytest.mark.asyncio
async def test_chess960_line_is_authorized_and_replays_castling():
    fen = "rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1"
    game = chess.pgn.Game.from_board(chess.Board(fen, chess960=True))
    game.add_main_variation(chess.Move.from_uci("b1h1"))
    stored = parse_pgn(str(game))[0]
    row = SimpleNamespace(id=4, owner_id=9, **stored)
    db = SimpleNamespace(get=AsyncMock(return_value=row))
    result = await get_game_line(4, SimpleNamespace(id=9), db)
    assert result["moves"][0]["san"] == "O-O"
    assert result["moves"][0]["uci"] == "b1h1"
    assert result["moves"][0]["fen"].split()[0].endswith("R4RK1")
    exported = await export_game_pgn(4, SimpleNamespace(id=9), db)
    assert parse_pgn(exported.body.decode())[0]["start_fen"] == fen
    with pytest.raises(HTTPException) as denied:
        await get_game_line(4, SimpleNamespace(id=10), db)
    assert denied.value.status_code == 404


@pytest.mark.asyncio
async def test_save_validates_whole_chess960_line(monkeypatch):
    board = chess.Board.from_chess960_pos(0)
    move = next(iter(board.legal_moves)).uci()
    importer = AsyncMock(return_value=SimpleNamespace(game_ids=[42]))
    monkeypatch.setattr(chess960_router, "import_games", importer)
    saved = await chess960_router.save_game(
        chess960_router.SaveGame(index=0, moves=[move]), SimpleNamespace(id=9), object()
    )
    assert saved == {"game_id": 42}
    assert parse_pgn(importer.call_args.args[0].pgn)[0]["variant"] == "chess960"
    with pytest.raises(HTTPException) as denied:
        await chess960_router.save_game(
            chess960_router.SaveGame(index=0, moves=["a1a8"]), SimpleNamespace(id=9), object()
        )
    assert denied.value.status_code == 400


def test_standard_setup_is_preserved_without_becoming_chess960():
    pgn = '[SetUp "1"]\n[FEN "8/8/8/8/8/8/4k3/K6R w - - 0 1"]\n\n1. Rh2 *'
    parsed = parse_pgn(pgn)[0]
    assert parsed["variant"] == "standard"
    assert parsed["start_fen"] == "8/8/8/8/8/8/4k3/K6R w - - 0 1"
    assert len(positions_of_game(parsed["movetext"], start_fen=parsed["start_fen"])) == 1
