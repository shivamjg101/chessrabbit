"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator

# ---------- auth ----------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(default="", max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    # Bounded like the registration field. Argon2 hashes whatever it is given,
    # so an unbounded password field lets one request spend seconds of CPU -
    # cheap to send, expensive to serve, and it sits in front of the login rate
    # limiter rather than behind it.
    password: str = Field(max_length=200)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotRequest(BaseModel):
    email: EmailStr


class ResetRequest(BaseModel):
    token: str = Field(max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class VerifyRequest(BaseModel):
    token: str = Field(max_length=200)


# ---------- admin ----------

class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class AdminToken(BaseModel):
    """
    Deliberately NOT a TokenPair: the admin surface issues no refresh token.
    The session expires and is signed in again, which is the only thing
    bounding a stolen admin token since there is nothing to revoke.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    display_name: str




# ---------- user ----------

class UserOut(BaseModel):
    id: int
    email: str
    display_name: str
    email_verified: bool
    created_at: datetime
    puzzle_rating: int = 1200

    class Config:
        from_attributes = True


class MeOut(UserOut):
    local_mode: bool = False
    analyses_today: int
    daily_limit: int | None
    max_depth: int
    max_multipv: int


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)


# ---------- games ----------

class GameOut(BaseModel):
    id: int
    white: str
    black: str
    white_elo: int | None
    black_elo: int | None
    result: str
    event: str
    played_on: date | None
    eco: str | None
    opening: str | None
    ply_count: int

    class Config:
        from_attributes = True


class SearchResults(BaseModel):
    """
    One page of reference-database hits.

    `has_more` rather than a total: counting the matches of a filtered query
    over millions of games costs more than fetching the page, and the only
    question the UI actually asks is whether there is a next one.
    """

    games: list[GameOut]
    page: int
    has_more: bool


class GameDetail(GameOut):
    movetext: str
    annotations: list[AnnotationOut] = []


class ImportPgnRequest(BaseModel):
    pgn: str = Field(max_length=5_000_000)


class ImportResult(BaseModel):
    imported: int
    skipped: int
    # Already in your database (or twice in the file): left out, not imported again.
    duplicates: int = 0
    errors: list[str] = []
    game_ids: list[int] = []


class DuplicateGroup(BaseModel):
    """One game that is in the database more than once."""

    keep: int
    duplicates: list[int]
    white: str
    black: str
    result: str
    played_on: date | None


class DuplicateGroups(BaseModel):
    groups: list[DuplicateGroup]
    # How many games deleting every group's duplicates would remove.
    total: int


# ---------- reports: crosstable, player dossier, novelty ----------

class EventSummary(BaseModel):
    event: str
    games: int
    first_date: date | None
    last_date: date | None


class CrosstablePlayer(BaseModel):
    name: str
    elo: int | None
    games: int
    wins: int
    draws: int
    losses: int
    score: float
    # Sonneborn-Berger: the scores of the players you beat, half of those you drew.
    tiebreak: float
    # Elo performance over the rated opponents; None when none were rated.
    performance: int | None
    # Against each player in `Crosstable.players`, in order: "1", "0", "½",
    # several separated by spaces for a double round, "" for no game.
    results: list[str]


class Crosstable(BaseModel):
    event: str
    games: int
    unfinished: int
    first_date: date | None
    last_date: date | None
    players: list[CrosstablePlayer]


class PlayerName(BaseModel):
    name: str
    games: int


class ScoreLine(BaseModel):
    games: int
    wins: int
    draws: int
    losses: int
    # Points per game from the player's side, 0-100.
    score_pct: float


class DossierOpening(BaseModel):
    eco: str | None
    opening: str | None
    games: int
    score_pct: float


class DossierOpponent(BaseModel):
    name: str
    games: int
    score_pct: float


class PlayerDossier(BaseModel):
    name: str
    total: ScoreLine
    as_white: ScoreLine
    as_black: ScoreLine
    highest_elo: int | None
    latest_elo: int | None
    first_date: date | None
    last_date: date | None
    openings_white: list[DossierOpening]
    openings_black: list[DossierOpening]
    opponents: list[DossierOpponent]
    recent: list[GameOut]


class NoveltyRequest(BaseModel):
    start_fen: str = Field(max_length=200)
    # The game's main line, as UCI. Only the indexed opening plies are checked.
    moves: list[str] = Field(max_length=600)
    scope: str = Field(default="reference", pattern="^(reference|mine)$")
    # The game being checked, when it is in your database: it must not count
    # as a precedent for itself.
    game_id: int | None = None


class NoveltyMove(BaseModel):
    uci: str
    san: str
    games: int
    # From the side to move, 0-100.
    score_pct: float


class NoveltyOut(BaseModel):
    # "novelty": the move at `ply` had never been played here before.
    # "known": every checked move has a precedent. "no_games": the database
    # has no game from the starting position at all.
    status: str
    ply: int | None = None
    san: str | None = None
    # Games that reached the position the novelty was played in.
    position_games: int = 0
    # What had been played there instead, most popular first.
    known_moves: list[NoveltyMove] = []
    checked_plies: int


class GameUpdate(BaseModel):
    """
    Header editing, as a database program does it. Everything optional; only
    what is sent changes. The moves are not editable here - a game whose moves
    changed would have every position row and review row describing a
    different game.
    """

    white: str | None = Field(default=None, max_length=200)
    black: str | None = Field(default=None, max_length=200)
    white_elo: int | None = Field(default=None, ge=0, le=4000)
    black_elo: int | None = Field(default=None, ge=0, le=4000)
    event: str | None = Field(default=None, max_length=200)
    site: str | None = Field(default=None, max_length=200)
    played_on: date | None = None
    result: str | None = Field(default=None, pattern=r"^(1-0|0-1|1/2-1/2|\*)$")
    # Empty string clears it; otherwise the A00-E99 shape every ECO code has.
    eco: str | None = Field(default=None, pattern=r"^([A-Ea-e][0-9]{2})?$")
    opening: str | None = Field(default=None, max_length=200)


class GameIds(BaseModel):
    """A selection from the game list, for the bulk actions."""

    ids: list[int] = Field(min_length=1, max_length=1000)


# ---------- annotations ----------

class AnnotationIn(BaseModel):
    ply: int
    nag: int | None = None
    comment: str | None = Field(default=None, max_length=2000)


class AnnotationOut(BaseModel):
    ply: int
    nag: int | None
    comment: str | None
    eval_cp: int | None
    best_uci: str | None = None
    # The move being reviewed. Lets a client confirm this row lines up with the
    # move it holds at this ply, instead of trusting the index (migration 011).
    move_uci: str | None = None
    move_san: str | None = None
    classification: str | None = None
    review: str | None = None

    class Config:
        from_attributes = True


# ---------- analysis ----------

class AnalysePositionRequest(BaseModel):
    engine: str = Field(default="stockfish", pattern=r"^[a-z0-9_-]{1,40}$")
    fen: str = Field(max_length=200)
    depth: int = Field(default=20, ge=1, le=40)
    multipv: int = Field(default=1, ge=1, le=10)


class AnalysisJobOut(BaseModel):
    job_id: int
    status: str
    cached: bool = False
    result: dict | None = None


# ---------- explorer ----------

class ExplorerRequest(BaseModel):
    fen: str = Field(max_length=200)
    min_elo: int | None = Field(default=None, ge=0, le=3500)
    scope: str = Field(default="reference", pattern="^(reference|mine|lichess_live)$")
    lichess_token: SecretStr | None = None


class ExplorerMove(BaseModel):
    uci: str
    san: str
    games: int
    white_wins: int
    draws: int
    black_wins: int
    avg_elo: int | None
    white_pct: float
    draw_pct: float
    black_pct: float


class ExplorerOut(BaseModel):
    fen: str
    total_games: int
    moves: list[ExplorerMove]


# ---------- puzzles ----------

class PuzzleOut(BaseModel):
    id: int
    lichess_id: str
    fen: str
    moves: list[str]           # UCI solution line; moves[0] is the setup move
    rating: int
    themes: list[str]
    game_url: str | None = None


class PuzzleAttemptIn(BaseModel):
    puzzle_id: int
    solved: bool


class PuzzleAttemptResult(BaseModel):
    solved: bool
    rating_before: int
    rating_after: int
    delta: int
    puzzle_rating: int


class PuzzleStats(BaseModel):
    puzzle_rating: int
    solved: int
    attempted: int
    streak: int


class PuzzleTheme(BaseModel):
    theme: str
    count: int


# ---------- play vs computer ----------

class PlayMoveIn(BaseModel):
    fen: str = Field(max_length=200)
    level: int = Field(default=4, ge=1, le=8)


class PlayMoveOut(BaseModel):
    move: str | None          # UCI, or null if the game is already over
    game_over: bool


# ---------- intuition trainer ----------

class IntuitionOut(BaseModel):
    fen: str
    master_uci: str
    master_san: str
    white: str
    black: str
    white_elo: int | None
    black_elo: int | None
    event: str
    ply: int


# ---------- opponent prep  ----------

# Platform usernames are pasted straight into a lichess.org / chess.com URL
# path, so the charset is the thing that keeps a "username" from being a path
# segment. Matches what both platforms actually allow.
PLATFORM_USERNAME = r"^[\w.-]+$"


class PrepRequest(BaseModel):
    platform: str = Field(pattern="^(lichess|chesscom)$")
    username: str = Field(min_length=1, max_length=60, pattern=PLATFORM_USERNAME)


class PrepLine(BaseModel):
    moves: list[str]
    count: int
    wins: int
    draws: int
    losses: int


class PrepDossier(BaseModel):
    username: str
    platform: str
    games_analyzed: int
    as_white: list[PrepLine]
    as_black: list[PrepLine]


class PrepRepertoireIn(BaseModel):
    platform: str = Field(pattern="^(lichess|chesscom)$")
    username: str = Field(min_length=1, max_length=60, pattern=PLATFORM_USERNAME)
    my_color: str = Field(pattern="^(white|black)$")


# ---------- opening catalog ----------

class OpeningOut(BaseModel):
    id: str
    name: str
    color: str
    eco: str
    description: str
    moves: str                # PGN with the opponent's alternatives in ( )
    rank: int                 # popularity order within the colour (1 = top)


# ---------- collections ----------

class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class CollectionOut(BaseModel):
    id: int
    name: str
    game_count: int = 0

    class Config:
        from_attributes = True


GameDetail.model_rebuild()


# ---------- connected accounts (auto-import) ----------

class ConnectAccountRequest(BaseModel):
    platform: str = Field(pattern="^(lichess|chesscom)$")
    username: str = Field(min_length=2, max_length=50, pattern=PLATFORM_USERNAME)


class ExternalAccountOut(BaseModel):
    platform: str
    username: str
    last_synced_at: datetime | None
    last_status: str | None
    games_imported: int

    class Config:
        from_attributes = True


class SyncResult(BaseModel):
    platform: str
    username: str
    fetched: int
    imported: int
    duplicates: int
    capped: int  # games skipped because the free-tier storage cap was hit
    errors: list[str] = []


# ---------- repertoire training ----------

class RepertoireCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = Field(pattern="^(white|black)$")
    pgn: str = Field(max_length=500_000)


class RepertoireOut(BaseModel):
    id: int
    name: str
    color: str
    card_count: int = 0
    due_count: int = 0
    prep_sources: dict[str, int] | None = None

    class Config:
        from_attributes = True


class TrainingCardOut(BaseModel):
    id: int
    repertoire_id: int
    repertoire_name: str
    color: str
    fen: str
    reps: int
    interval_days: float

    class Config:
        from_attributes = True


class TrainingAnswer(BaseModel):
    card_id: int
    answer_uci: str = Field(min_length=4, max_length=5)


class TrainingResult(BaseModel):
    correct: bool
    expected_uci: str
    expected_san: str
    next_due_days: float


# ---------- studies ----------

VISIBILITY = "^(private|unlisted|public)$"
ORIENTATION = "^(white|black)$"
CHAPTER_MODE = "^(normal|lesson|conceal)$"

# One chapter's movetext, with every variation and comment in it. Generous
# rather than unbounded: a heavily annotated opening chapter runs to tens of
# kilobytes, and the cap is what stops a study being used as blob storage.
MAX_CHAPTER_PGN = 400_000

MAX_TAGS = 40
MAX_TOPICS = 12


def clean_tags(tags: dict[str, str] | None) -> dict[str, str] | None:
    """
    PGN tag pairs, as the format allows them: a symbol for a name, a string
    for a value.

    FEN and SetUp are dropped rather than refused. They describe the start
    position, which the chapter keeps in its own column, and a second copy in
    the tags would be a second place for the two to disagree.
    """
    if tags is None:
        return None
    if len(tags) > MAX_TAGS:
        raise ValueError(f"At most {MAX_TAGS} tags")
    out: dict[str, str] = {}
    for key, value in tags.items():
        if not isinstance(key, str) or not key.isascii() or not key.replace("_", "").isalnum():
            raise ValueError(f"Tag names are letters, digits and underscores: {key!r}")
        if len(key) > 40:
            raise ValueError("Tag names are at most 40 characters")
        if key in ("FEN", "SetUp"):
            continue
        text = " ".join(str(value).split())
        if len(text) > 255:
            raise ValueError(f"The {key} tag is longer than 255 characters")
        out[key] = text
    return out


def clean_topics(topics: list[str] | None) -> list[str] | None:
    """Trimmed, de-duplicated without regard to case, in the order given."""
    if topics is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for raw in topics:
        topic = " ".join(str(raw).split())[:40]
        if topic and topic.lower() not in seen:
            seen.add(topic.lower())
            out.append(topic)
    if len(out) > MAX_TOPICS:
        raise ValueError(f"At most {MAX_TOPICS} topics")
    return out


class StudyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    visibility: str = Field(default="private", pattern=VISIBILITY)
    # Seed the first chapter from a game you already have, or from pasted PGN.
    # Both optional: an empty study opens on a board you can start playing on.
    from_game_id: int | None = None
    pgn: str | None = Field(default=None, max_length=MAX_CHAPTER_PGN)
    topics: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("topics")
    @classmethod
    def _topics(cls, v: list[str]) -> list[str] | None:
        return clean_topics(v)


class StudyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    visibility: str | None = Field(default=None, pattern=VISIBILITY)
    topics: list[str] | None = Field(default=None, max_length=50)

    @field_validator("topics")
    @classmethod
    def _topics(cls, v: list[str] | None) -> list[str] | None:
        return clean_topics(v)


class StudyClone(BaseModel):
    """Optional new name; the copy keeps the original's when absent."""

    name: str | None = Field(default=None, min_length=1, max_length=120)


class ChapterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=20_000)
    pgn: str = Field(default="", max_length=MAX_CHAPTER_PGN)
    starting_fen: str | None = Field(default=None, max_length=120)
    orientation: str = Field(default="white", pattern=ORIENTATION)
    from_game_id: int | None = None
    mode: str = Field(default="normal", pattern=CHAPTER_MODE)
    hide_engine: bool = False
    tags: dict[str, str] = Field(default_factory=dict)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: dict[str, str]) -> dict[str, str] | None:
        return clean_tags(v)


class ChapterImport(BaseModel):
    """
    Several chapters in one request - a multi-game PGN, or a selection of
    games. One request so the chapter limit is checked once for the whole
    batch, and a batch that does not fit is refused whole rather than half
    imported.
    """

    chapters: list[ChapterCreate] = Field(min_length=1, max_length=64)


class ChapterUpdate(BaseModel):
    """
    Every field optional: the board autosaves `pgn` alone many times per
    session, and the header form saves `name` without touching the tree.

    `version` is not optional in practice - a write that omits it is taken as
    "I did not read this chapter first" and is only allowed when it changes
    nothing about the tree. See routers/studies.py.
    """

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=20_000)
    pgn: str | None = Field(default=None, max_length=MAX_CHAPTER_PGN)
    orientation: str | None = Field(default=None, pattern=ORIENTATION)
    mode: str | None = Field(default=None, pattern=CHAPTER_MODE)
    hide_engine: bool | None = None
    tags: dict[str, str] | None = None
    version: int | None = None

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        return clean_tags(v)


class ChapterOut(BaseModel):
    id: int
    name: str
    description: str | None
    pgn: str
    starting_fen: str
    orientation: str
    mode: str = "normal"
    hide_engine: bool = False
    tags: dict[str, str] = Field(default_factory=dict)
    position: int
    version: int

    class Config:
        from_attributes = True


class StudyMemberOut(BaseModel):
    user_id: int
    display_name: str
    email: str
    role: str


class StudyOut(BaseModel):
    """The listing shape: everything but the chapters' movetext."""

    id: int
    name: str
    description: str | None
    visibility: str
    slug: str
    chapter_count: int
    updated_at: datetime
    owner_id: int
    owner_name: str
    # False when you are reading somebody else's shared study.
    can_edit: bool
    topics: list[str] = Field(default_factory=list)
    likes: int = 0
    # Whether the account asking has liked it. False for an anonymous reader.
    liked: bool = False
    cloned_from: int | None = None


class StudyDetail(StudyOut):
    chapters: list[ChapterOut]
    members: list[StudyMemberOut]


class StudyPage(BaseModel):
    """One page of the public listing. `has_more` for the same reason as SearchResults."""

    studies: list[StudyOut]
    page: int
    has_more: bool


class StudyLikeOut(BaseModel):
    likes: int
    liked: bool


class MemberAdd(BaseModel):
    email: EmailStr


class ChapterOrder(BaseModel):
    chapter_ids: list[int] = Field(min_length=1, max_length=200)


# ---------- endgame tablebase ----------

class TablebaseMove(BaseModel):
    uci: str
    san: str
    # win | loss | draw | cursed-win | blessed-loss | maybe-win | maybe-loss |
    # unknown - for the side to move AFTER this move, exactly as the tablebase
    # reports it. The board flips it to the mover's point of view.
    category: str
    dtz: int | None = None
    dtm: int | None = None
    zeroing: bool = False
    checkmate: bool = False
    stalemate: bool = False


class TablebaseOut(BaseModel):
    fen: str
    # rules | syzygy (files on this machine) | lichess (the online service)
    source: str
    # The position's verdict for the side to move.
    category: str
    dtz: int | None = None
    dtm: int | None = None
    checkmate: bool = False
    stalemate: bool = False
    insufficient_material: bool = False
    moves: list[TablebaseMove] = []
