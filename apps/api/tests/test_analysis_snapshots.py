from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import analysis
from app.routers.analysis import SaveSnapshot, save_snapshot


@pytest.mark.asyncio
async def test_snapshot_requires_owned_completed_job_and_copies_server_provenance():
    job = SimpleNamespace(
        id=9, user_id=3, kind="position", status="done",
        params={"fen": "test-fen", "engine": "stockfish"},
        result={"depth": 18, "lines": [{"cp": 40}], "engine_cache_key": "stockfish:abc", "engine_version": "19"},
    )
    saved = SimpleNamespace(
        id=2, fen="test-fen", engine_id="stockfish", engine_version="19", cache_key="stockfish:abc",
        depth=18, lines=[{"cp": 40}], note="my thought",
        created_at=datetime.now(timezone.utc),
    )
    statements = []

    async def execute(stmt):
        statements.append(stmt)
        return SimpleNamespace(scalar_one=lambda: saved)

    db = SimpleNamespace(get=AsyncMock(return_value=job), execute=execute, commit=AsyncMock())
    with pytest.raises(HTTPException) as forbidden:
        await save_snapshot(SaveSnapshot(job_id=9), SimpleNamespace(id=4), db)
    assert forbidden.value.status_code == 404

    result = await save_snapshot(SaveSnapshot(job_id=9, note=" my thought "), SimpleNamespace(id=3), db)
    assert result["engine_cache_key"] == "stockfish:abc"
    params = statements[0].compile().params
    assert params["fen"] == "test-fen"
    assert params["cache_key"] == "stockfish:abc"
    assert params["note"] == "my thought"


@pytest.mark.asyncio
async def test_cancel_job_stops_worker_and_preserves_canceled_status(monkeypatch):
    job = SimpleNamespace(id=12, user_id=3, status="running")
    db = SimpleNamespace(get=AsyncMock(return_value=job), commit=AsyncMock())
    redis = SimpleNamespace(set=AsyncMock(), publish=AsyncMock())
    monkeypatch.setattr(analysis, "get_redis", lambda: redis)
    await analysis.cancel_job(12, SimpleNamespace(id=3), db)
    assert job.status == "canceled"
    redis.set.assert_awaited_once_with("cancel:12", "1", ex=300)
    redis.publish.assert_awaited_once_with("cancel:12", "1")
