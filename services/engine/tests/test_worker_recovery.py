import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self.sql = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def execute(self, sql, params=()):
        self.sql.append((sql, params))

    async def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, rows):
        self.cur = FakeCursor(rows)
        self.sql = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    def cursor(self, **_):
        return self.cur

    async def execute(self, sql, params):
        self.sql.append((sql, params))

    async def commit(self):
        pass


@pytest.mark.asyncio
async def test_recovery_requeues_unfinished_analysis_and_rejects_missing_engine(monkeypatch):
    rows = [
        {"id": 1, "user_id": 2, "game_id": None, "kind": "position",
         "params": {"fen": "test", "depth": 14, "engine": "stockfish", "variant": "chess960"}},
        {"id": 2, "user_id": 2, "game_id": 9, "kind": "full_game",
         "params": {"depth": 18, "engine": "stockfish"}},
        {"id": 3, "user_id": 2, "game_id": None, "kind": "position",
         "params": {"fen": "test", "engine": "removed"}},
    ]
    conn = FakeConnection(rows)

    async def connect(_):
        return conn

    monkeypatch.setattr(worker.psycopg.AsyncConnection, "connect", connect)
    redis = SimpleNamespace(rpush=None)
    pushed = []

    async def rpush(queue, payload):
        pushed.append((queue, json.loads(payload)))

    redis.rpush = rpush
    async def lrange(*_):
        return []

    redis.lrange = lrange
    assert await worker.recover_jobs(redis, {"stockfish"}) == 2
    assert pushed[0][0] == "q:stockfish:interactive"
    assert pushed[0][1]["variant"] == "chess960"
    assert pushed[1][0] == "q:stockfish:batch"
    assert pushed[1][1]["game_id"] == 9
    assert conn.sql[0][1] == (3,)
