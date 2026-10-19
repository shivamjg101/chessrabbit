from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.routers.puzzles import _pick_puzzle, record_attempt
from app.schemas import PuzzleAttemptIn


@pytest.mark.asyncio
async def test_puzzle_search_scopes_public_and_personal_rows():
    statements = []

    async def execute(stmt):
        statements.append(str(stmt.compile(compile_kwargs={"literal_binds": True})))
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))

    db = SimpleNamespace(execute=execute)
    await _pick_puzzle(db, 17, 1200, 1300, None, source="mine")
    assert all("puzzles.owner_id = 17" in sql for sql in statements)
    statements.clear()
    await _pick_puzzle(db, 17, 1200, 1300, None, source="public")
    assert all("puzzles.owner_id IS NULL" in sql for sql in statements)


@pytest.mark.asyncio
async def test_puzzle_search_falls_back_when_random_pivots_miss():
    puzzle = SimpleNamespace(id=7)
    statements = []

    async def execute(stmt):
        statements.append(str(stmt.compile(compile_kwargs={"literal_binds": True})))
        found = [puzzle] if len(statements) == 4 else []
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: found))

    with patch("app.routers.puzzles.random.randint", return_value=1500):
        result = await _pick_puzzle(SimpleNamespace(execute=execute), 17, 900, 1500, None)

    assert result is puzzle
    assert len(statements) == 4
    assert "puzzles.rating >= 1500" not in statements[-1]


@pytest.mark.asyncio
async def test_private_puzzle_attempt_is_owner_only_and_unrated():
    puzzle = SimpleNamespace(id=3, owner_id=17, rating=1200)
    db = SimpleNamespace(get=AsyncMock(return_value=puzzle), add=lambda _: None, commit=AsyncMock())
    with pytest.raises(HTTPException) as error:
        await record_attempt(PuzzleAttemptIn(puzzle_id=3, solved=True), SimpleNamespace(id=18), db)
    assert error.value.status_code == 404
    user = SimpleNamespace(id=17, puzzle_rating=1500)
    result = await record_attempt(PuzzleAttemptIn(puzzle_id=3, solved=True), user, db)
    assert result.rating_before == result.rating_after == 1500
    assert user.puzzle_rating == 1500
