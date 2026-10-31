"""The game list against a real migrated database: every GameOut field loads."""

import os
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Game, User
from app.routers import games
from app.schemas import GameOut

pytestmark = pytest.mark.skipif(not os.getenv("CHESSRABBIT_TEST_DB"), reason="Needs an isolated migrated database")


@pytest.mark.asyncio
async def test_list_serialises_every_field_including_time_control():
    """
    The list loads only GameOut's columns. A field added to GameOut but not to
    that list is a lazy load at serialisation, which an async session refuses
    with a 500 - the time control did exactly that when it was added.
    """
    engine = create_async_engine(os.environ["CHESSRABBIT_TEST_DB"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            user = User(email=f"list-{uuid.uuid4().hex}@test.invalid", password_hash="x")
            db.add(user)
            await db.flush()
            db.add(Game(owner_id=user.id, white="A", black="B", movetext="1. e4 *", time_control="180+2"))
            await db.commit()
            try:
                rows = await games.list_games(
                    page=1, limit=50, collection=None, q=None, result=None, eco=None,
                    white=None, black=None, opening=None, event=None, min_elo=None,
                    date_from=None, date_to=None, sort="added", order="desc", user=user, db=db,
                )
                out = [GameOut.model_validate(g) for g in rows]
                assert [g.time_control for g in out] == ["180+2"]
            finally:
                await db.execute(delete(User).where(User.id == user.id))
                await db.commit()
    finally:
        await engine.dispose()
