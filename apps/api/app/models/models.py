"""SQLAlchemy models mirroring db/migrations/001_initial_schema.sql."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, default="", nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    puzzle_rating: Mapped[int] = mapped_column(Integer, default=1200, nullable=False)

    games: Mapped[list[Game]] = relationship(back_populates="owner")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Root token id of this rotation chain (migration 012). Presenting an
    # already-revoked member means a copy of it exists somewhere, so the whole
    # family is revoked - see routers/auth.py.
    family_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EmailToken(Base):
    __tablename__ = "email_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)






class DailyActiveUser(Base):
    """
    One row per user per day they were seen (migration 013).

    The durable half of presence tracking: Redis answers "who is online right
    now", this answers "how many were active on any past day" and survives a
    Redis flush.
    """

    __tablename__ = "daily_active_users"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class AdminAudit(Base):
    """
    Every admin mutation and every /admin sign-in attempt (migration 013).

    `admin_id` is nullable: a failed login has no authenticated actor, and
    deleting an admin account must not erase the record of what it did.
    """

    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    owner_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    source: Mapped[str] = mapped_column(Text, default="user", nullable=False)
    white: Mapped[str] = mapped_column(Text, default="", nullable=False)
    black: Mapped[str] = mapped_column(Text, default="", nullable=False)
    white_elo: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    black_elo: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    result: Mapped[str] = mapped_column(Text, default="*", nullable=False)
    event: Mapped[str] = mapped_column(Text, default="", nullable=False)
    site: Mapped[str] = mapped_column(Text, default="", nullable=False)
    played_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    eco: Mapped[str | None] = mapped_column(String(3), nullable=True)
    opening: Mapped[str | None] = mapped_column(Text, nullable=True)
    ply_count: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    movetext: Mapped[str] = mapped_column(Text, nullable=False)
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Insights metadata (migration 010). All nullable: games imported before
    # 010, and reference games, simply do not participate in those charts.
    user_color: Mapped[str | None] = mapped_column(String(1), nullable=True)
    termination: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_control: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_class: Mapped[str | None] = mapped_column(Text, nullable=True)
    played_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner: Mapped[User | None] = relationship(back_populates="games")


class GamePosition(Base):
    __tablename__ = "game_positions"

    game_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )
    ply: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    zobrist: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    move_uci: Mapped[str] = mapped_column(Text, nullable=False)


class OpeningTree(Base):
    __tablename__ = "opening_tree"

    zobrist: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    move_uci: Mapped[str] = mapped_column(Text, primary_key=True)
    games: Mapped[int] = mapped_column(Integer, nullable=False)
    white_wins: Mapped[int] = mapped_column(Integer, nullable=False)
    draws: Mapped[int] = mapped_column(Integer, nullable=False)
    black_wins: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_elo: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)


class AnalysisCache(Base):
    __tablename__ = "analysis_cache"

    zobrist: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    engine_version: Mapped[str] = mapped_column(Text, primary_key=True)
    fen: Mapped[str] = mapped_column(Text, nullable=False)
    depth: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    multipv: Mapped[list] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    game_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("games.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(Text, default="queued", nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    game_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("games.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    ply: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    nag: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    eval_cp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_uci: Mapped[str | None] = mapped_column(Text, nullable=True)
    # The move this row reviews (migration 011). Nullable: rows written before
    # it have none, and the client falls back to a coarser alignment check.
    move_uci: Mapped[str | None] = mapped_column(Text, nullable=True)
    move_san: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification: Mapped[str | None] = mapped_column(Text, nullable=True)
    review: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("game_id", "user_id", "ply"),)


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CollectionGame(Base):
    __tablename__ = "collection_games"

    collection_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    game_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )


class UsageDaily(Base):
    __tablename__ = "usage_daily"

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    analyses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class ExternalAccount(Base):
    __tablename__ = "external_accounts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    platform: Mapped[str] = mapped_column(Text, nullable=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    games_imported: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("user_id", "platform"),)


class Repertoire(Base):
    __tablename__ = "repertoires"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Study(Base):
    """A shareable notebook of positions. See db/migrations/014_studies.sql."""

    __tablename__ = "studies"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    owner_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # private | unlisted | public. For an unlisted study the slug is the
    # credential, so it is minted unguessable at creation - see the migration.
    visibility: Mapped[str] = mapped_column(Text, nullable=False, default="private")
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    # Free-text labels a public study is found by. See migration 017.
    topics: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    cloned_from: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("studies.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StudyLike(Base):
    """One reader's star on a study. The count is what the public list sorts by."""

    __tablename__ = "study_likes"

    study_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("studies.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudyChapter(Base):
    """One board in a study: a start position plus the tree played from it."""

    __tablename__ = "study_chapters"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    study_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("studies.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Movetext with variations, exactly as the browser's pgn.ts writes it.
    pgn: Mapped[str] = mapped_column(Text, nullable=False, default="")
    starting_fen: Mapped[str] = mapped_column(Text, nullable=False)
    orientation: Mapped[str] = mapped_column(Text, nullable=False, default="white")
    # normal | lesson | conceal - how a reader meets the moves. Migration 017.
    mode: Mapped[str] = mapped_column(Text, nullable=False, default="normal")
    hide_engine: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # PGN tag pairs, written out as tags by the export.
    tags: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Bumped on every accepted write; a write quoting a stale one is refused.
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StudyMember(Base):
    """Who besides the owner may write. Reading is governed by visibility."""

    __tablename__ = "study_members"

    study_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("studies.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(Text, nullable=False, default="contributor")
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Puzzle(Base):
    __tablename__ = "puzzles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lichess_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    fen: Mapped[str] = mapped_column(Text, nullable=False)
    moves: Mapped[str] = mapped_column(Text, nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    rating_dev: Mapped[int | None] = mapped_column(Integer, nullable=True)
    popularity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nb_plays: Mapped[int | None] = mapped_column(Integer, nullable=True)
    themes: Mapped[str | None] = mapped_column(Text, nullable=True)
    game_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    opening_tags: Mapped[str | None] = mapped_column(Text, nullable=True)


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    puzzle_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("puzzles.id", ondelete="CASCADE"))
    solved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    rating_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrainingCard(Base):
    __tablename__ = "training_cards"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    repertoire_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("repertoires.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"))
    zobrist: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fen: Mapped[str] = mapped_column(Text, nullable=False)
    expected_uci: Mapped[str] = mapped_column(Text, nullable=False)
    expected_san: Mapped[str] = mapped_column(Text, nullable=False)
    ease: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    interval_days: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lapses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (UniqueConstraint("repertoire_id", "zobrist"),)
