"""A multi-chapter import must validate the whole batch before saving it."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.routers import studies
from app.schemas import ChapterImportRequest


def fake_db(*query_values):
    results = [SimpleNamespace(scalar_one=lambda value=value: value) for value in query_values]
    return SimpleNamespace(
        execute=AsyncMock(side_effect=results),
        add=Mock(),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )


@pytest.mark.asyncio
async def test_import_saves_a_whole_batch_once(monkeypatch):
    study = SimpleNamespace(id=7, updated_at=None)
    monkeypatch.setattr(studies, "_require_write", AsyncMock(return_value=study))
    db = fake_db(None, 1, 1000)  # row lock, existing count, last position
    payload = ChapterImportRequest(chapters=[
        {"name": "First", "pgn": "1. e4 (1. d4) e5 *"},
        {"name": "Second", "pgn": "1. d4 d5 *", "orientation": "black"},
    ])

    chapters = await studies.import_chapters("7", payload, SimpleNamespace(id=1), db)

    assert [chapter.position for chapter in chapters] == [2000, 3000]
    assert chapters[0].pgn == "1. e4 (1. d4) e5 *"
    assert chapters[1].orientation == "black"
    assert db.add.call_count == 2
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_import_rejects_invalid_position_without_adding_any_chapter(monkeypatch):
    monkeypatch.setattr(
        studies, "_require_write", AsyncMock(return_value=SimpleNamespace(id=7))
    )
    db = fake_db(None, 1)
    payload = ChapterImportRequest(chapters=[
        {"name": "Valid", "pgn": "1. e4 *"},
        {"name": "Broken", "pgn": "*", "starting_fen": "not a FEN"},
    ])

    with pytest.raises(HTTPException) as exc:
        await studies.import_chapters("7", payload, SimpleNamespace(id=1), db)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "invalid_fen"
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
