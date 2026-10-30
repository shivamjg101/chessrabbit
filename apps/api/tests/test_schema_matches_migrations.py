"""
The SQLAlchemy models and db/migrations/ describe the same database.

models.py opens by calling itself a mirror of the migrations. Nothing checked
that, and the two drift silently: a column added to a model but not to a
migration works perfectly in every test that never touches a real database, and
fails on the first query after deploy. A column added to a migration but not to
a model is quieter still - it simply goes unused until somebody wonders why the
data is never written.

This runs against the database CI builds by applying every migration in order,
so it is a test of the migrations as much as of the models: it is the reason
002-014 are executed at all, rather than 001 alone.

Skipped when CHESSRABBIT_TEST_DB is unset, which is how it stays out of the way
of a laptop with no Postgres on it. CI always sets it.
"""

from __future__ import annotations

import os

# Importing the package is what registers every mapper on Base.metadata.
# Without it this file would compare the migrations against an empty set and
# cheerfully pass.
import app.models  # noqa: F401
import pytest
from app.core.db import Base
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DB = os.environ.get("CHESSRABBIT_TEST_DB")

pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="CHESSRABBIT_TEST_DB is not set (needs a migrated database)"
)

# Tables the migrations own that no model maps, deliberately. Listed rather
# than ignored wholesale, so a table that appears by accident still fails.
UNMAPPED_BY_DESIGN = {
    # Retained as historical records when upgrading an existing installation.
    "subscriptions", "subscription_events", "processed_webhook_events",
    # The desktop runtime's own ledger of applied migrations
    # (apps/desktop/backend/database.py), present on any desktop-made database.
    "desktop_schema_migrations",
}


async def _reflect() -> tuple[set[str], dict[str, set[str]]]:
    """Every table and column the migrated database actually has."""
    engine = create_async_engine(TEST_DB)
    try:
        async with engine.connect() as conn:
            tables = await conn.run_sync(
                lambda c: set(inspect(c).get_table_names(schema="public"))
            )
            columns = await conn.run_sync(
                lambda c: {
                    t: {col["name"] for col in inspect(c).get_columns(t, schema="public")}
                    for t in inspect(c).get_table_names(schema="public")
                }
            )
        return tables, columns
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_every_model_has_a_table_in_the_migrations():
    tables, _ = await _reflect()
    missing = sorted(set(Base.metadata.tables) - tables)
    assert not missing, (
        f"Models declare tables the migrations never create: {missing}. "
        "Add a migration, or the first query against them fails after deploy."
    )


@pytest.mark.asyncio
async def test_every_model_column_exists_in_the_migrations():
    _, columns = await _reflect()

    drift: dict[str, list[str]] = {}
    for name, table in Base.metadata.tables.items():
        actual = columns.get(name)
        if actual is None:
            continue  # the table itself is missing; the test above says so
        extra = {c.name for c in table.columns} - actual
        if extra:
            drift[name] = sorted(extra)

    assert not drift, (
        f"Models declare columns the migrations never create: {drift}. "
        "These read as NULL at best and raise UndefinedColumn at worst."
    )


@pytest.mark.asyncio
async def test_every_migrated_table_is_either_mapped_or_listed():
    """
    The other direction. A table created by a migration and mapped by nothing
    is either dead weight or a model somebody forgot to write; both are worth
    saying out loud once rather than discovering later.
    """
    tables, _ = await _reflect()
    unmapped = sorted(tables - set(Base.metadata.tables) - UNMAPPED_BY_DESIGN)
    assert not unmapped, (
        f"Migrated tables that no model maps: {unmapped}. Add the model, or add "
        "the table to UNMAPPED_BY_DESIGN with a note saying why."
    )
