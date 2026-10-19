from pathlib import Path
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
import asyncio

import chess
import chess.pgn
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker  # noqa: E402
from uci import EvalLine  # noqa: E402
from worker import _build_reviews, _san_line  # noqa: E402


@pytest.mark.asyncio
async def test_cancel_between_subscribe_and_listen_is_not_lost():
    pubsub = SimpleNamespace(subscribe=AsyncMock(), unsubscribe=AsyncMock(), aclose=AsyncMock())
    redis = SimpleNamespace(pubsub=lambda: pubsub, get=AsyncMock(return_value=b"1"))
    stopped = asyncio.Event()
    await worker.watch_cancel(redis, 7, stopped)
    assert stopped.is_set()
    pubsub.subscribe.assert_awaited_once_with("cancel:7")


def test_chess960_review_renders_king_to_rook_castling():
    board = chess.Board("rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1", chess960=True)
    move = chess.Move.from_uci("b1h1")
    before = board.fen(shredder=True)
    board.push(move)
    after = board.fen(shredder=True)
    assert _san_line(before, ["b1h1"], chess960=True) == "O-O"
    rows = _build_reviews(
        [move], [before, after],
        [{"cp": 0, "mate": None, "pv": ["b1h1"]}, {"cp": 0, "mate": None, "pv": []}],
        set(), chess960=True,
    )
    assert rows[0]["move_san"] == "O-O"
    assert rows[0]["classification"] == "best"
    assert rows[0]["move_uci"] == "b1h1"


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel_after_first", [False, True])
async def test_full_game_review_uses_960_engine_without_standard_cache_or_training(
    monkeypatch, cancel_after_first,
):
    board = chess.Board.from_chess960_pos(0)
    first = next(iter(board.legal_moves))
    game = chess.pgn.Game.from_board(board)
    game.add_main_variation(first)
    movetext = game.accept(chess.pgn.StringExporter(headers=False))
    stored = {"id": 7, "owner_id": 3, "variant": "chess960",
              "start_fen": board.fen(shredder=True), "movetext": movetext}

    class Cursor:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def execute(self, *_): pass
        async def fetchone(self): return stored

    class Engine:
        supported_options = {"UCI_Chess960"}
        calls = []

        async def analyse(self, fen, **kwargs):
            self.calls.append((fen, kwargs))
            position = chess.Board(fen, chess960=True)
            yield EvalLine(depth=8, multipv=1, cp=0,
                           pv=[next(iter(position.legal_moves)).uci()])
            yield {"type": "bestmove"}

    engine = Engine()

    @asynccontextmanager
    async def acquire():
        yield engine

    pool = SimpleNamespace(acquire=acquire, cache_key="test")
    status = AsyncMock()
    monkeypatch.setattr(worker, "set_job_status", status)
    monkeypatch.setattr(worker, "is_abandoned", AsyncMock(
        side_effect=[False, True] if cancel_after_first else None,
        return_value=False,
    ))
    cache = AsyncMock()
    book = AsyncMock()
    cards = AsyncMock()
    puzzles = AsyncMock()
    annotations = AsyncMock()
    monkeypatch.setattr(worker, "cache_lookup", cache)
    monkeypatch.setattr(worker, "cache_store", cache)
    monkeypatch.setattr(worker, "_book_plies", book)
    monkeypatch.setattr(worker, "_store_mistake_cards", cards)
    monkeypatch.setattr(worker, "_store_personal_puzzles", puzzles)
    monkeypatch.setattr(worker, "_store_annotations", annotations)
    conn = SimpleNamespace(cursor=lambda **_: Cursor())
    await worker.handle_full_game_job(pool, SimpleNamespace(publish=AsyncMock()), conn,
                                      {"job_id": 5, "game_id": 7, "user_id": 3, "depth": 8})
    assert engine.calls[0][0] == stored["start_fen"]
    assert len(engine.calls) == (1 if cancel_after_first else 2)
    assert all(call[1]["chess960"] for call in engine.calls)
    cache.assert_not_awaited()
    book.assert_not_awaited()
    cards.assert_not_awaited()
    puzzles.assert_not_awaited()
    if cancel_after_first:
        annotations.assert_not_awaited()
        assert status.await_args.args[2] == "canceled"
    else:
        assert annotations.await_args.args[3][0]["move_uci"] == first.uci()


@pytest.mark.asyncio
async def test_full_game_resets_engine_on_first_uncached_position(monkeypatch):
    stored = {"id": 7, "owner_id": None, "variant": "standard",
              "start_fen": None, "movetext": "1. e4 e5 *"}

    class Cursor:
        async def __aenter__(self): return self
        async def __aexit__(self, *_): pass
        async def execute(self, *_): pass
        async def fetchone(self): return stored

    class Engine:
        supported_options = set()

        def __init__(self): self.calls = []

        async def analyse(self, fen, **kwargs):
            self.calls.append(kwargs)
            position = chess.Board(fen)
            yield EvalLine(depth=8, multipv=1, cp=0,
                           pv=[next(iter(position.legal_moves)).uci()])
            yield {"type": "bestmove"}

    engine = Engine()

    @asynccontextmanager
    async def acquire():
        yield engine

    cached = {"multipv": [{"cp": 0, "mate": None, "pv": ["e2e4"]}]}
    monkeypatch.setattr(worker, "cache_lookup", AsyncMock(side_effect=[cached, None, None]))
    monkeypatch.setattr(worker, "cache_store", AsyncMock())
    monkeypatch.setattr(worker, "is_abandoned", AsyncMock(return_value=False))
    monkeypatch.setattr(worker, "set_job_status", AsyncMock())
    monkeypatch.setattr(worker, "_book_plies", AsyncMock(return_value=set()))
    monkeypatch.setattr(worker, "_store_annotations", AsyncMock())
    conn = SimpleNamespace(cursor=lambda **_: Cursor())
    pool = SimpleNamespace(acquire=acquire, cache_key="test")
    await worker.handle_full_game_job(pool, SimpleNamespace(publish=AsyncMock()), conn,
                                      {"job_id": 5, "game_id": 7, "user_id": 3, "depth": 8})
    assert [call["new_game"] for call in engine.calls] == [True, False]
