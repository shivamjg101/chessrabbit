"""
Studies: the move tree, kept somewhere it can be shared.

What the browser already had was a tree that branches, comments and exports
PGN — and nowhere to put it. Lines lived in localStorage, so they belonged to
one browser and could not be shown to anybody. This router is the other half.

Two decisions shape everything below.

**A chapter is stored as PGN.** Not a node table. The browser's `pgn.ts` writes
movetext with variations, comments, NAGs and shape commands, and reads its own
output back; the server keeps that string and hands it back unchanged. So a
chapter leaves here into ChessBase or Lichess without a converter, and the tree
can learn to hold new things without a migration. The server does not parse it
on the write path — validating it would mean re-implementing the branch parser
in Python and disagreeing with the browser about some edge of the format, which
is a worse failure than storing movetext nobody can read.

**Reading and writing are governed separately.** `visibility` answers who may
read; `study_members` answers who may write. That is why there is no viewer
role: a viewer is somebody you sent the link to.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.chess_utils import split_setup, validate_fen
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import get_current_user, get_optional_user
from app.core.ratelimit import rate_limit, user_rate_limit
from app.models import Game, Study, StudyChapter, StudyLike, StudyMember, User
from app.schemas import (
    ChapterCreate,
    ChapterImport,
    ChapterOrder,
    ChapterOut,
    ChapterUpdate,
    MemberAdd,
    StudyClone,
    StudyCreate,
    StudyDetail,
    StudyLikeOut,
    StudyMemberOut,
    StudyOut,
    StudyPage,
    StudyUpdate,
)

router = APIRouter(prefix="/studies", tags=["studies"])

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# Sparse positions, so dragging one chapter rewrites one row rather than the
# block beneath it.
POSITION_STEP = 1000


def _touch(study: Study) -> None:
    """
    Mark the study changed, so "my studies" sorts by what you last worked on.

    A real datetime rather than `func.now()`: sessions are configured
    expire_on_commit=False, so a SQL expression assigned here would still be a
    SQL expression after the commit, and serialising the study in the same
    request would hand Pydantic a function object instead of a time.
    """
    study.updated_at = datetime.now(timezone.utc)


def _not_found() -> HTTPException:
    """
    The only failure a reader is ever told about.

    A private study must not answer differently from one that does not exist,
    or the id space becomes an oracle for "does this person have a study".
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail={"code": "not_found", "message": "Study not found"},
    )


async def _resolve(
    db: AsyncSession, ref: str, user: User | None
) -> tuple[Study, bool]:
    """
    Find a study by numeric id or share slug, and say whether `user` may write.

    One function for both because the read rules are identical and duplicating
    them is how the slug route ends up more permissive than the id route.
    """
    # A slug is 43 url-safe characters; an id is digits. Nothing legitimate is
    # both, so this never has to guess. The digit case is bounded because a
    # number past bigint reaches the driver as an overflow rather than as a
    # miss, turning a typed URL into a 500.
    by_id = ref.isdigit()
    if by_id:
        if len(ref) > 19:
            raise _not_found()
        stmt = select(Study).where(Study.id == int(ref))
    else:
        stmt = select(Study).where(Study.slug == ref)

    study = (await db.execute(stmt)).scalar_one_or_none()
    if study is None:
        raise _not_found()

    if user is not None and study.owner_id == user.id:
        return study, True

    if user is not None:
        member = await db.execute(
            select(StudyMember.user_id).where(
                StudyMember.study_id == study.id, StudyMember.user_id == user.id
            )
        )
        if member.scalar_one_or_none() is not None:
            return study, True

    # Reached here, the caller is a stranger, so the reference they used is the
    # credential.
    if stranger_may_read(study.visibility, by_id):
        return study, False

    raise _not_found()


def stranger_may_read(visibility: str, by_id: bool) -> bool:
    """
    May somebody with no relationship to this study read it with this reference?

    "Unlisted" promises the study is not listed anywhere and that the link is
    the key. Ids are sequential, so honouring the id route for a stranger meant
    walking /studies/1, /studies/2, ... and reading every unlisted study on the
    server without ever holding a link - the slug was unguessable and entirely
    optional. A stranger must present the slug; only "public" is meant to be
    reachable by enumeration.

    Split out from `_resolve` so the rule can be tested without a database:
    this is the sentence that decides whether private work stays private.
    """
    if visibility == "public":
        return True
    return visibility == "unlisted" and not by_id


async def _require_write(db: AsyncSession, ref: str, user: User) -> Study:
    study, can_edit = await _resolve(db, ref, user)
    if not can_edit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "read_only",
                "message": "You have read access to this study, not write access.",
            },
        )
    return study


async def _chapter(db: AsyncSession, study: Study, chapter_id: int) -> StudyChapter:
    chapter = await db.get(StudyChapter, chapter_id)
    # The study_id check is what stops a chapter id from one study being edited
    # through another study you happen to own.
    if chapter is None or chapter.study_id != study.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Chapter not found"},
        )
    return chapter


async def _members_of(db: AsyncSession, study_id: int) -> list[StudyMemberOut]:
    rows = await db.execute(
        select(StudyMember, User)
        .join(User, User.id == StudyMember.user_id)
        .where(StudyMember.study_id == study_id)
        .order_by(User.display_name, User.email)
    )
    return [
        StudyMemberOut(
            user_id=u.id,
            display_name=u.display_name or u.email.split("@")[0],
            email=u.email,
            role=m.role,
        )
        for m, u in rows.all()
    ]


async def _like_counts(db: AsyncSession, ids: list[int]) -> dict[int, int]:
    """Likes per study, for a whole page in one grouped query."""
    if not ids:
        return {}
    rows = await db.execute(
        select(StudyLike.study_id, func.count())
        .where(StudyLike.study_id.in_(ids))
        .group_by(StudyLike.study_id)
    )
    return dict(rows.all())


async def _liked_by(db: AsyncSession, ids: list[int], user_id: int | None) -> set[int]:
    """Which of these studies `user_id` has liked. Nobody, for an anonymous reader."""
    if not ids or user_id is None:
        return set()
    rows = await db.execute(
        select(StudyLike.study_id).where(
            StudyLike.study_id.in_(ids), StudyLike.user_id == user_id
        )
    )
    return set(rows.scalars().all())


async def _chapter_counts(db: AsyncSession, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = await db.execute(
        select(StudyChapter.study_id, func.count(StudyChapter.id))
        .where(StudyChapter.study_id.in_(ids))
        .group_by(StudyChapter.study_id)
    )
    return dict(rows.all())


async def _out(
    db: AsyncSession,
    study: Study,
    can_edit: bool,
    owner: User | None = None,
    chapter_count: int | None = None,
    likes: int | None = None,
    liked: bool | None = None,
    viewer_id: int | None = None,
) -> StudyOut:
    """
    The listing shape. `owner`, `chapter_count`, `likes` and `liked` are passed
    in by callers that already hold them - the listings count a whole page in
    a few grouped queries rather than a few queries per row.
    """
    owner = owner or await db.get(User, study.owner_id)
    if chapter_count is None:
        chapter_count = (await _chapter_counts(db, [study.id])).get(study.id, 0)
    if likes is None:
        likes = (await _like_counts(db, [study.id])).get(study.id, 0)
    if liked is None:
        liked = study.id in await _liked_by(db, [study.id], viewer_id)

    return StudyOut(
        id=study.id,
        name=study.name,
        description=study.description,
        visibility=study.visibility,
        slug=study.slug,
        chapter_count=chapter_count,
        updated_at=study.updated_at,
        owner_id=study.owner_id,
        owner_name=(owner.display_name or owner.email.split("@")[0]) if owner else "?",
        can_edit=can_edit,
        topics=list(study.topics or []),
        likes=likes,
        liked=liked,
        cloned_from=study.cloned_from,
    )


async def _seed_pgn(db: AsyncSession, user: User, game_id: int) -> tuple[str, str]:
    """
    A chapter started from a game you own: its movetext - the tree's half -
    and the position it starts from, which a chapter keeps in its own column.
    """
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Game not found"},
        )
    tags, movetext = split_setup(game.movetext or "")
    fen = next((t[6:-2] for t in tags if t.startswith('[FEN "')), START_FEN)
    return movetext, fen


# ---------- studies ----------

@router.get("", response_model=list[StudyOut])
async def list_studies(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Studies you own, then studies somebody shared with you. Newest first."""
    owned = (
        await db.execute(
            select(Study).where(Study.owner_id == user.id).order_by(Study.updated_at.desc())
        )
    ).scalars().all()

    shared = (
        await db.execute(
            select(Study)
            .join(StudyMember, StudyMember.study_id == Study.id)
            .where(StudyMember.user_id == user.id)
            .order_by(Study.updated_at.desc())
        )
    ).scalars().all()

    ids = [s.id for s in owned] + [s.id for s in shared]
    if not ids:
        return []

    # One grouped count for the whole page. A count per row is the shape this
    # listing naturally takes and the shape that makes it cost N queries.
    counts = await _chapter_counts(db, ids)
    likes = await _like_counts(db, ids)
    liked = await _liked_by(db, ids, user.id)
    owners = {
        u.id: u
        for u in (
            await db.execute(
                select(User).where(User.id.in_({s.owner_id for s in shared}))
            )
        ).scalars().all()
    }

    def row(s: Study, owner: User | None):
        return _out(
            db, s, True, owner=owner, chapter_count=counts.get(s.id, 0),
            likes=likes.get(s.id, 0), liked=s.id in liked,
        )

    out = [await row(s, user) for s in owned]
    out += [await row(s, owners.get(s.owner_id)) for s in shared]
    return out


PUBLIC_PAGE = 24

PUBLIC_SORTS = ("popular", "newest", "updated")


def _like_needle(q: str) -> str:
    """A LIKE pattern matching `q` anywhere, with its metacharacters escaped."""
    escaped = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get(
    "/public",
    response_model=StudyPage,
    # Declared before /{ref}: routes match in order, and "public" would
    # otherwise be looked up as a share slug and answered with a 404.
    dependencies=[rate_limit("public_studies", 120, 60)],
)
async def public_studies(
    q: str | None = Query(default=None, max_length=100),
    topic: str | None = Query(default=None, max_length=40),
    sort: str = Query(default="popular", pattern="^(popular|newest|updated)$"),
    page: int = Query(default=1, ge=1, le=500),
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Studies their owners chose to publish, for anybody to find.

    Only "public" is ever listed. "Unlisted" means exactly that: the link is
    the way in, and appearing here would make the link pointless.
    """
    likes_sq = (
        select(StudyLike.study_id, func.count().label("n"))
        .group_by(StudyLike.study_id)
        .subquery()
    )
    like_count = func.coalesce(likes_sq.c.n, 0)
    stmt = (
        select(Study, like_count)
        .outerjoin(likes_sq, likes_sq.c.study_id == Study.id)
        .where(Study.visibility == "public")
    )
    if q and q.strip():
        needle = _like_needle(q.strip())
        stmt = stmt.where(
            func.lower(Study.name).like(needle, escape="\\")
            | func.lower(func.coalesce(Study.description, "")).like(needle, escape="\\")
            | func.lower(func.array_to_string(Study.topics, " ")).like(needle, escape="\\")
        )
    if topic and topic.strip():
        stmt = stmt.where(Study.topics.any(topic.strip()))

    if sort == "popular":
        stmt = stmt.order_by(like_count.desc(), Study.updated_at.desc(), Study.id.desc())
    elif sort == "newest":
        stmt = stmt.order_by(Study.created_at.desc(), Study.id.desc())
    else:
        stmt = stmt.order_by(Study.updated_at.desc(), Study.id.desc())

    rows = (
        await db.execute(stmt.offset((page - 1) * PUBLIC_PAGE).limit(PUBLIC_PAGE + 1))
    ).all()
    has_more = len(rows) > PUBLIC_PAGE
    rows = rows[:PUBLIC_PAGE]

    ids = [s.id for s, _ in rows]
    counts = await _chapter_counts(db, ids)
    liked = await _liked_by(db, ids, user.id if user else None)
    owners = {
        u.id: u
        for u in (
            await db.execute(select(User).where(User.id.in_({s.owner_id for s, _ in rows})))
        ).scalars().all()
    }

    studies = []
    for s, n in rows:
        mine = user is not None and s.owner_id == user.id
        out = await _out(
            db, s, mine, owner=owners.get(s.owner_id),
            chapter_count=counts.get(s.id, 0), likes=n, liked=s.id in liked,
        )
        # A public study is opened by id. Broadcasting its slug here would hand
        # every visitor a key that keeps working if the owner later steps it
        # back to "unlisted" - which is the whole point of stepping it back.
        if not mine:
            out.slug = ""
        studies.append(out)
    return StudyPage(studies=studies, page=page, has_more=has_more)


@router.post(
    "",
    response_model=StudyDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[user_rate_limit("create_study", 30, 3600)],
)
async def create_study(
    payload: StudyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study = Study(
        owner_id=user.id,
        name=payload.name,
        description=payload.description,
        visibility=payload.visibility,
        topics=payload.topics or [],
        # 32 bytes url-safe. For an unlisted study this string is the whole
        # access control, so it is minted from secrets, never from the name.
        slug=secrets.token_urlsafe(32),
    )
    db.add(study)
    await db.flush()

    pgn, fen = payload.pgn or "", START_FEN
    if payload.from_game_id is not None:
        pgn, fen = await _seed_pgn(db, user, payload.from_game_id)

    # Every study opens on a board. A first chapter is created even when there
    # is nothing to put in it, so "new study" never lands on an empty screen
    # whose only affordance is a second button.
    db.add(
        StudyChapter(
            study_id=study.id,
            name="Chapter 1",
            pgn=pgn,
            starting_fen=fen,
            position=POSITION_STEP,
        )
    )
    await db.commit()
    await db.refresh(study)
    return await _detail(db, study, True, owner=user, viewer_id=user.id)


async def _detail(
    db: AsyncSession,
    study: Study,
    can_edit: bool,
    owner: User | None = None,
    viewer_id: int | None = None,
) -> StudyDetail:
    chapters = (
        await db.execute(
            select(StudyChapter)
            .where(StudyChapter.study_id == study.id)
            .order_by(StudyChapter.position, StudyChapter.id)
        )
    ).scalars().all()

    base = await _out(db, study, can_edit, owner=owner, viewer_id=viewer_id)
    return StudyDetail(
        **base.model_dump(),
        chapters=[ChapterOut.model_validate(c) for c in chapters],
        # Only somebody who can write needs the contributor list, and for a
        # public study it is not the reader's business who else has the keys.
        members=await _members_of(db, study.id) if can_edit else [],
    )


@router.get("/{ref}", response_model=StudyDetail)
async def get_study(
    ref: str,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """By id for a study you have access to, or by slug for a shared link."""
    study, can_edit = await _resolve(db, ref, user)
    return await _detail(db, study, can_edit, viewer_id=user.id if user else None)


@router.patch("/{ref}", response_model=StudyOut)
async def update_study(
    ref: str,
    payload: StudyUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study = await _require_write(db, ref, user)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(study, field, value)
    _touch(study)
    await db.commit()
    await db.refresh(study)
    return await _out(db, study, True, viewer_id=user.id)


@router.delete("/{ref}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_study(
    ref: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Owner only. A contributor may edit a study; they may not destroy it."""
    study, _ = await _resolve(db, ref, user)
    if study.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "owner_only", "message": "Only the owner can delete a study"},
        )
    await db.delete(study)
    await db.commit()


@router.post("/{ref}/reshare", response_model=StudyOut)
async def reshare_study(
    ref: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Mint a new slug, breaking every link handed out under the old one.

    The counterpart to a share link having no expiry: revoking it has to be
    possible without deleting the study, and this is the only way back once a
    link has left your hands.
    """
    study, _ = await _resolve(db, ref, user)
    if study.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "owner_only", "message": "Only the owner can reset the link"},
        )
    study.slug = secrets.token_urlsafe(32)
    await db.commit()
    await db.refresh(study)
    return await _out(db, study, True, owner=user, viewer_id=user.id)


# ---------- chapters ----------

async def _room_for(db: AsyncSession, study: Study, adding: int) -> None:
    """Refuse a write that would take the study past its chapter limit."""
    count = await db.execute(
        select(func.count(StudyChapter.id)).where(StudyChapter.study_id == study.id)
    )
    have = count.scalar_one()
    if have + adding > settings.MAX_CHAPTERS_PER_STUDY:
        room = max(0, settings.MAX_CHAPTERS_PER_STUDY - have)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "chapter_limit_reached",
                "message": f"A study holds {settings.MAX_CHAPTERS_PER_STUDY} chapters"
                           + (f" and this one has room for {room} more" if adding > 1 else "")
                           + ". Start a second study.",
            },
        )


async def _build_chapter(
    db: AsyncSession, study: Study, user: User, payload: ChapterCreate, position: int
) -> StudyChapter:
    fen = payload.starting_fen or START_FEN
    # The one thing worth validating server-side: a chapter whose start position
    # does not parse is a board the client cannot draw at all, and it would fail
    # every time the chapter is opened rather than once here.
    try:
        validate_fen(fen)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_fen",
                "message": f'The starting position of "{payload.name}" is not legal',
            },
        ) from None

    pgn = payload.pgn
    if payload.from_game_id is not None:
        # The game decides where its chapter starts, whatever the draft said.
        pgn, fen = await _seed_pgn(db, user, payload.from_game_id)

    return StudyChapter(
        study_id=study.id,
        name=payload.name,
        description=payload.description,
        pgn=pgn,
        starting_fen=fen,
        orientation=payload.orientation,
        mode=payload.mode,
        hide_engine=payload.hide_engine,
        tags=payload.tags or {},
        position=position,
    )


async def _last_position(db: AsyncSession, study: Study) -> int:
    last = await db.execute(
        select(func.max(StudyChapter.position)).where(StudyChapter.study_id == study.id)
    )
    return last.scalar_one() or 0


@router.post(
    "/{ref}/chapters",
    response_model=ChapterOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_chapter(
    ref: str,
    payload: ChapterCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study = await _require_write(db, ref, user)
    await _room_for(db, study, 1)

    chapter = await _build_chapter(
        db, study, user, payload, await _last_position(db, study) + POSITION_STEP
    )
    db.add(chapter)
    # Adding a chapter is a change to the study, and the listing sorts on it.
    _touch(study)
    await db.commit()
    await db.refresh(chapter)
    return chapter


@router.post(
    "/{ref}/chapters/import",
    response_model=list[ChapterOut],
    status_code=status.HTTP_201_CREATED,
    dependencies=[user_rate_limit("import_chapters", 60, 3600)],
)
async def import_chapters(
    ref: str,
    payload: ChapterImport,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Many chapters at once, appended in the order given.

    What "import PGN into a study" is: every game in a multi-game file becomes
    a chapter. The browser splits the file - it already reads PGN, variations
    and all - and this keeps the batch whole: it fits, or nothing is added.
    """
    study = await _require_write(db, ref, user)
    await _room_for(db, study, len(payload.chapters))

    at = await _last_position(db, study)
    made: list[StudyChapter] = []
    for item in payload.chapters:
        at += POSITION_STEP
        made.append(await _build_chapter(db, study, user, item, at))

    db.add_all(made)
    _touch(study)
    await db.commit()
    for chapter in made:
        await db.refresh(chapter)
    return made


@router.patch("/{ref}/chapters/{chapter_id}", response_model=ChapterOut)
async def update_chapter(
    ref: str,
    chapter_id: int,
    payload: ChapterUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save a chapter. The board calls this on a debounce as you explore.

    The version guard is the whole point. A chapter is written whole, so a save
    built on a stale copy does not merge badly — it silently deletes whatever
    the other person added since. Rather than take it, the server refuses with
    409 and hands back the current version so the client can say so.

    A write that touches no movetext (renaming a chapter, flipping the board)
    skips the guard: those are not edits to the tree, and making a rename fail
    because somebody else moved a piece would be noise.
    """
    study = await _require_write(db, ref, user)
    chapter = await _chapter(db, study, chapter_id)

    fields = payload.model_dump(exclude_none=True)
    fields.pop("version", None)
    if not fields:
        return chapter

    if payload.pgn is not None:
        if payload.version is None or payload.version != chapter.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "stale_chapter",
                    "message": "Somebody else saved this chapter while you were editing. "
                               "Reload to get their version.",
                },
            )
        chapter.version += 1

    for field, value in fields.items():
        setattr(chapter, field, value)
    _touch(study)
    await db.commit()
    await db.refresh(chapter)
    return chapter


@router.delete("/{ref}/chapters/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    ref: str,
    chapter_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study = await _require_write(db, ref, user)
    chapter = await _chapter(db, study, chapter_id)

    count = await db.execute(
        select(func.count(StudyChapter.id)).where(StudyChapter.study_id == study.id)
    )
    # A study with no chapters has no board to open, and the page would have to
    # grow a second empty state to describe it. Deleting the last one is asking
    # to delete the study.
    if count.scalar_one() <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "last_chapter",
                "message": "A study keeps at least one chapter. Delete the study instead.",
            },
        )

    await db.delete(chapter)
    _touch(study)
    await db.commit()


@router.post("/{ref}/chapters/order", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_chapters(
    ref: str,
    payload: ChapterOrder,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study = await _require_write(db, ref, user)

    owned = (
        await db.execute(
            select(StudyChapter).where(StudyChapter.study_id == study.id)
        )
    ).scalars().all()
    by_id = {c.id: c for c in owned}

    # Ids from another study are ignored rather than rejected: the request says
    # what order to put this study's chapters in, and a stray id is not an
    # instruction to reorder somebody else's.
    for rank, cid in enumerate(payload.chapter_ids):
        chapter = by_id.get(cid)
        if chapter is not None:
            chapter.position = (rank + 1) * POSITION_STEP

    _touch(study)
    await db.commit()


# ---------- clone and likes ----------

@router.post(
    "/{ref}/clone",
    response_model=StudyDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[user_rate_limit("create_study", 30, 3600)],
)
async def clone_study(
    ref: str,
    payload: StudyClone | None = Body(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Copy a study you can read into one you own.

    The way to build on somebody else's work without being able to change
    theirs: the copy is private, has no contributors, and gets its own link.
    Anything that can read a study can clone it - a reader already holds every
    move in it, and the copy grants nothing the original did not.
    """
    source, _ = await _resolve(db, ref, user)

    copy = Study(
        owner_id=user.id,
        name=(payload.name if payload and payload.name else source.name),
        description=source.description,
        visibility="private",
        topics=list(source.topics or []),
        cloned_from=source.id,
        slug=secrets.token_urlsafe(32),
    )
    db.add(copy)
    await db.flush()

    chapters = (
        await db.execute(
            select(StudyChapter)
            .where(StudyChapter.study_id == source.id)
            .order_by(StudyChapter.position, StudyChapter.id)
        )
    ).scalars().all()
    db.add_all(
        StudyChapter(
            study_id=copy.id,
            name=c.name,
            description=c.description,
            pgn=c.pgn,
            starting_fen=c.starting_fen,
            orientation=c.orientation,
            mode=c.mode,
            hide_engine=c.hide_engine,
            tags=dict(c.tags or {}),
            position=(i + 1) * POSITION_STEP,
        )
        for i, c in enumerate(chapters)
    )
    await db.commit()
    await db.refresh(copy)
    return await _detail(db, copy, True, owner=user, viewer_id=user.id)


async def _like_state(db: AsyncSession, study: Study, user: User) -> StudyLikeOut:
    likes = (await _like_counts(db, [study.id])).get(study.id, 0)
    liked = study.id in await _liked_by(db, [study.id], user.id)
    return StudyLikeOut(likes=likes, liked=liked)


@router.post(
    "/{ref}/like",
    response_model=StudyLikeOut,
    dependencies=[user_rate_limit("like_study", 120, 3600)],
)
async def like_study(
    ref: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Star a study you can read. Liking twice is liking once."""
    study, _ = await _resolve(db, ref, user)
    await db.execute(
        pg_insert(StudyLike)
        .values(study_id=study.id, user_id=user.id)
        .on_conflict_do_nothing(index_elements=["study_id", "user_id"])
    )
    await db.commit()
    return await _like_state(db, study, user)


@router.delete("/{ref}/like", response_model=StudyLikeOut)
async def unlike_study(
    ref: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study, _ = await _resolve(db, ref, user)
    await db.execute(
        delete(StudyLike).where(StudyLike.study_id == study.id, StudyLike.user_id == user.id)
    )
    await db.commit()
    return await _like_state(db, study, user)


# ---------- members ----------

@router.post("/{ref}/members", response_model=list[StudyMemberOut])
async def add_member(
    ref: str,
    payload: MemberAdd,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Give somebody write access, by the email they signed up with.

    An address with no account behind it returns the member list unchanged
    rather than an error: the alternative tells whoever asks whether a given
    email is registered here, which is a membership oracle for the whole site.
    """
    study, _ = await _resolve(db, ref, user)
    if study.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "owner_only", "message": "Only the owner can add contributors"},
        )

    invitee = (
        await db.execute(select(User).where(func.lower(User.email) == payload.email.lower()))
    ).scalar_one_or_none()

    if invitee is not None and invitee.deleted_at is None and invitee.id != study.owner_id:
        already = await db.execute(
            select(StudyMember.user_id).where(
                StudyMember.study_id == study.id, StudyMember.user_id == invitee.id
            )
        )
        if already.scalar_one_or_none() is None:
            db.add(StudyMember(study_id=study.id, user_id=invitee.id))
            await db.commit()

    return await _members_of(db, study.id)


@router.delete("/{ref}/members/{user_id}", response_model=list[StudyMemberOut])
async def remove_member(
    ref: str,
    user_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    study, _ = await _resolve(db, ref, user)
    # A contributor may show themselves out; only the owner may show out anyone
    # else. Ownership itself is not a membership and cannot be removed here.
    if study.owner_id != user.id and user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "owner_only", "message": "Only the owner can remove contributors"},
        )

    await db.execute(
        delete(StudyMember).where(
            StudyMember.study_id == study.id, StudyMember.user_id == user_id
        )
    )
    await db.commit()
    return await _members_of(db, study.id) if study.owner_id == user.id else []


# ---------- export ----------

@router.get("/{ref}/pgn")
async def export_study_pgn(
    ref: str,
    chapter: int | None = Query(default=None, description="One chapter, or all of them"),
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The whole study as one PGN file — the format's own answer to a chapter list.

    Each chapter becomes a game with its own tag pairs, which is exactly how
    ChessBase and Lichess read a multi-game file, so a study opens over there as
    the same chapters rather than as one run-on game.
    """
    from fastapi.responses import PlainTextResponse

    study, _ = await _resolve(db, ref, user)
    stmt = (
        select(StudyChapter)
        .where(StudyChapter.study_id == study.id)
        .order_by(StudyChapter.position, StudyChapter.id)
    )
    if chapter is not None:
        stmt = stmt.where(StudyChapter.id == chapter)
    chapters = (await db.execute(stmt)).scalars().all()

    games: list[str] = []
    for c in chapters:
        games.append(chapter_pgn(study.name, c))

    safe = "".join(ch if ch.isalnum() else "_" for ch in study.name)[:40] or "study"
    return PlainTextResponse(
        "\n".join(games),
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="{safe}.pgn"'},
    )


_RESULT_AT_END = re.compile(r"(1-0|0-1|1/2-1/2|\*)\s*$")


def _quote(value: str) -> str:
    # Tag values are quoted strings; an unescaped quote inside one ends the
    # tag early and every reader after it is parsing garbage.
    return value.replace("\\", "\\\\").replace('"', '\\"')


def chapter_pgn(study_name: str, c: StudyChapter) -> str:
    """
    One chapter as one PGN game.

    The seven-tag roster comes first, filled from the chapter's own tags where
    it has them, so a chapter imported from a game goes back out naming the
    players it came in with. The start position, the side it is read from and
    how it is read are derived from the row and always win: a stale FEN tag
    would describe a board the moves were never played on.
    """
    tags: dict[str, str] = {
        "Event": f"{study_name}: {c.name}",
        "Site": "ChessRabbit",
        "Date": "????.??.??",
        "Round": "?",
        "White": "?",
        "Black": "?",
        "Result": "*",
    }
    for key, value in (c.tags or {}).items():
        if key not in ("FEN", "SetUp") and value:
            tags[key] = value
    if c.starting_fen != START_FEN:
        tags["SetUp"] = "1"
        tags["FEN"] = c.starting_fen
    if c.orientation == "black":
        tags["Orientation"] = "black"
    if c.mode and c.mode != "normal":
        tags["ChapterMode"] = c.mode

    result = tags["Result"] if tags["Result"] in ("1-0", "0-1", "1/2-1/2", "*") else "*"
    body = (c.pgn or "").strip()
    # A chapter's prose lives beside the tree, not in it. Written as the
    # comment before the first move, which is where a reader shows it.
    if c.description:
        body = f"{{{c.description.replace('}', ')')}}} {body}".strip()
    if not _RESULT_AT_END.search(body):
        body = f"{body} {result}".strip()

    head = "\n".join(f'[{k} "{_quote(str(v))}"]' for k, v in tags.items())
    return head + "\n\n" + body + "\n"
