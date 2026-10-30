"""Game CRUD, PGN import/export, collections, annotations."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, func, insert, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.core.bulk import bulk_insert, bulk_upsert
from app.core.chess_utils import (
    ParseReport,
    mainline_uci,
    parse_pgn,
    positions_of_game,
    split_setup,
)
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ratelimit import user_rate_limit
from app.models import Annotation, Collection, CollectionGame, Game, GamePosition, User
from app.schemas import (
    AnnotationIn,
    AnnotationOut,
    CollectionIn,
    CollectionOut,
    DuplicateGroup,
    DuplicateGroups,
    GameDetail,
    GameIds,
    GameOut,
    GameUpdate,
    ImportPgnRequest,
    ImportResult,
)
from app.services.importers import color_played, user_identities

router = APIRouter(tags=["games"])


def _like(value: str) -> str:
    """A LIKE pattern matching `value` anywhere. Metacharacters escaped: a bare
    "%" would otherwise match the whole table and turn a search box into a scan."""
    return "%" + value.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# What the game list may be ordered by, as a database program's column headers
# are. A whitelist, not a column name taken from the query string.
SORTS = {
    "added": Game.created_at,
    "date": Game.played_on,
    "white": func.lower(Game.white),
    "black": func.lower(Game.black),
    "white_elo": Game.white_elo,
    "black_elo": Game.black_elo,
    "result": Game.result,
    "eco": Game.eco,
    "event": func.lower(Game.event),
    "moves": Game.ply_count,
}


@router.get("/games", response_model=list[GameOut])
async def list_games(
    # Bounded at the edge: an unchecked page=0 became OFFSET -50, which
    # Postgres rejects, turning a query-string typo into a 500.
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    collection: int | None = None,
    q: str | None = Query(default=None, max_length=100),
    result: str | None = None,
    eco: str | None = Query(default=None, max_length=8),
    white: str | None = Query(default=None, max_length=100),
    black: str | None = Query(default=None, max_length=100),
    opening: str | None = Query(default=None, max_length=100),
    event: str | None = Query(default=None, max_length=100),
    min_elo: int | None = Query(default=None, ge=0, le=4000),
    date_from: date | None = None,
    date_to: date | None = None,
    sort: str = Query(default="added", pattern="^(" + "|".join(SORTS) + ")$"),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # The list only ever renders GameOut. Without this the query also drags
    # back every game's full movetext - by far the widest column in the table -
    # which is then discarded during serialisation.
    stmt = (
        select(Game)
        .options(
            load_only(
                Game.id, Game.white, Game.black, Game.white_elo, Game.black_elo,
                Game.result, Game.event, Game.played_on, Game.eco, Game.opening,
                Game.ply_count,
            )
        )
        .where(Game.owner_id == user.id)
    )

    if collection is not None:
        stmt = stmt.join(CollectionGame, CollectionGame.game_id == Game.id).where(
            CollectionGame.collection_id == collection
        )
    if q:
        needle = _like(q)
        stmt = stmt.where(
            func.lower(Game.white).like(needle, escape="\\")
            | func.lower(Game.black).like(needle, escape="\\")
        )
    if white:
        stmt = stmt.where(func.lower(Game.white).like(_like(white), escape="\\"))
    if black:
        stmt = stmt.where(func.lower(Game.black).like(_like(black), escape="\\"))
    if opening:
        stmt = stmt.where(func.lower(func.coalesce(Game.opening, "")).like(_like(opening), escape="\\"))
    if event:
        stmt = stmt.where(func.lower(Game.event).like(_like(event), escape="\\"))
    if result in ("1-0", "0-1", "1/2-1/2", "*"):
        stmt = stmt.where(Game.result == result)
    if eco:
        # "B9" finds B90-B99, "B" the whole volume - the way an ECO range is
        # actually asked for.
        stmt = stmt.where(Game.eco.like(eco.upper()[:3].replace("%", "").replace("_", "") + "%"))
    if min_elo is not None:
        stmt = stmt.where(func.greatest(Game.white_elo, Game.black_elo) >= min_elo)
    if date_from:
        stmt = stmt.where(Game.played_on >= date_from)
    if date_to:
        stmt = stmt.where(Game.played_on <= date_to)

    column = SORTS[sort]
    ordered = column.asc().nulls_last() if order == "asc" else column.desc().nulls_last()

    # id breaks ties. Without it the sort is not a total order, and games
    # imported in the same batch share a timestamp to the microsecond - so
    # paging a freshly imported PGN could show one game twice and skip another
    # entirely. Same reason the reference search orders by id last.
    stmt = (
        stmt.order_by(ordered, Game.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    result_rows = await db.execute(stmt)
    return list(result_rows.scalars().all())


# Parsing and position-indexing up to 5MB of PGN is the most CPU this API will
# do on one request, and it had no limit of any kind.
@router.post(
    "/games",
    response_model=ImportResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[user_rate_limit("import_pgn", 20, 60)],
)
async def import_games(
    payload: ImportPgnRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import one or many games from PGN text."""
    report = ParseReport()
    parsed = parse_pgn(payload.pgn, report)
    errors = report.notes
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_pgn",
                "message": errors[0] if errors else "No valid games found in that PGN",
            },
        )

    # Lets Insights count a hand-pasted game as yours when the PGN names you.
    identities = await user_identities(db, user)
    known = await _known_games(db, user, parsed)

    # Build every row before touching the database. Replaying a PGN is where
    # a bad game actually fails, so validating first keeps the "skip the
    # broken game, import the rest" contract while letting the writes below
    # be two statements instead of two per game.
    rows: list[dict] = []
    indexes: list[list[tuple[int, int, str]]] = []
    duplicates = 0
    for entry in parsed:
        # The same file imported twice, or one game pasted into it twice, is
        # the same game: a second copy doubles every statistic built on it.
        key = _game_key(entry)
        moves = mainline_uci(entry["movetext"])
        if moves in known.setdefault(key, set()):
            duplicates += 1
            continue
        known[key].add(moves)
        try:
            positions = positions_of_game(entry["movetext"])
            rows.append({
                "owner_id": user.id,
                "source": "user",
                "user_color": color_played(entry, identities),
                **entry,
            })
            indexes.append(positions)
        except Exception as exc:  # keep importing the rest of the file
            errors.append(str(exc)[:200])

    ids: list[int] = []
    if rows:
        # sort_by_parameter_order pairs each returned id with the row that
        # produced it. Without it Postgres may return them in any order and
        # every position row would be indexed against the wrong game.
        result = await db.execute(
            insert(Game).returning(Game.id, sort_by_parameter_order=True), rows
        )
        ids = [r[0] for r in result]

        positions = [
            {"game_id": game_id, "ply": ply, "zobrist": zob, "move_uci": uci}
            for game_id, index in zip(ids, indexes)
            for ply, zob, uci in index
        ]
        await bulk_insert(db, GamePosition, positions)

    await db.commit()
    return ImportResult(
        imported=len(ids),
        # Games refused while parsing never reached `parsed`.
        skipped=len(parsed) - len(ids) - duplicates + report.refused,
        duplicates=duplicates,
        errors=errors,
        game_ids=ids,
    )


def _game_key(entry: dict) -> tuple:
    """What two copies of one game agree on before their moves are compared."""
    return (
        entry.get("white"),
        entry.get("black"),
        entry.get("result"),
        entry.get("played_on"),
        entry.get("ply_count"),
    )


async def _known_games(db: AsyncSession, user: User, parsed: list[dict]) -> dict[tuple, set]:
    """
    The main lines of your games that share players, result, date and length
    with something being imported - the only ones that could be the same game.

    Narrowed by name and length in SQL, so a 2,000-game file costs one query
    and a replay of the handful of rows that actually collide, not a replay of
    the whole database.
    """
    known: dict[tuple, set] = {}
    triples = {(e["white"], e["black"], e["ply_count"]) for e in parsed}
    if not triples:
        return known
    candidates = tuple_(Game.white, Game.black, Game.ply_count)
    for chunk in _chunks(sorted(triples), 500):
        rows = await db.execute(
            select(
                Game.white, Game.black, Game.result, Game.played_on, Game.ply_count, Game.movetext
            ).where(Game.owner_id == user.id, candidates.in_(chunk))
        )
        for white, black, result, played_on, ply_count, movetext in rows.all():
            key = _game_key({
                "white": white, "black": black, "result": result,
                "played_on": played_on, "ply_count": ply_count,
            })
            known.setdefault(key, set()).add(mainline_uci(movetext))
    return known


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


@router.get("/games/duplicates", response_model=DuplicateGroups)
async def find_duplicates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Games that are in your database more than once: the same players, result,
    date and main line. ChessBase calls these doubles.

    Each group keeps the copy with the most annotations - a review or your own
    notes are the part that cannot be re-imported - and offers the rest for
    deletion. Nothing is deleted here.
    """
    clash = (
        select(Game.white, Game.black, Game.result, Game.played_on, Game.ply_count)
        .where(Game.owner_id == user.id)
        .group_by(Game.white, Game.black, Game.result, Game.played_on, Game.ply_count)
        .having(func.count() > 1)
        .subquery()
    )
    notes = (
        select(func.count())
        .where(Annotation.game_id == Game.id, Annotation.user_id == user.id)
        .correlate(Game)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(Game.id, Game.white, Game.black, Game.result, Game.played_on, Game.ply_count,
               Game.movetext, notes)
        .join(
            clash,
            (Game.white == clash.c.white) & (Game.black == clash.c.black)
            & (Game.result == clash.c.result) & (Game.ply_count == clash.c.ply_count)
            & Game.played_on.is_not_distinct_from(clash.c.played_on),
        )
        .where(Game.owner_id == user.id)
        .order_by(Game.id)
    )
    same: dict[tuple, list[tuple[int, int]]] = {}
    for gid, white, black, result, played_on, ply_count, movetext, n_notes in rows.all():
        key = (white, black, result, played_on, ply_count, mainline_uci(movetext))
        same.setdefault(key, []).append((gid, n_notes))

    groups: list[DuplicateGroup] = []
    for (white, black, result, played_on, _, _), copies in same.items():
        if len(copies) < 2:
            continue
        # Most annotations first; the oldest copy among equals.
        copies.sort(key=lambda c: (-c[1], c[0]))
        groups.append(DuplicateGroup(
            keep=copies[0][0], duplicates=[c[0] for c in copies[1:]],
            white=white, black=black, result=result, played_on=played_on,
        ))
    return DuplicateGroups(groups=groups, total=sum(len(g.duplicates) for g in groups))


@router.get("/games/{game_id}", response_model=GameDetail)
async def get_game(
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "Game not found"},
        )

    result = await db.execute(
        select(Annotation).where(Annotation.game_id == game_id, Annotation.user_id == user.id)
    )
    annotations = [AnnotationOut.model_validate(a) for a in result.scalars().all()]

    detail = GameDetail.model_validate(game)
    detail.annotations = annotations
    return detail


@router.patch("/games/{game_id}", response_model=GameOut)
async def update_game(
    game_id: int,
    payload: GameUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await db.get(Game, game_id)
    if game is None or game.owner_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})

    for field, value in payload.model_dump(exclude_none=True).items():
        if field == "eco":
            # An empty box clears the code rather than storing "".
            value = value.upper() or None
        setattr(game, field, value)
    await db.commit()
    await db.refresh(game)
    return game


@router.post("/games/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_games(
    payload: GameIds,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a selection. Only your own games: a reference game in the same list
    is skipped, not refused, because the selection is a request about yours.
    """
    await db.execute(
        delete(Game).where(Game.id.in_(payload.ids), Game.owner_id == user.id)
    )
    await db.commit()


@router.post("/games/export")
async def export_games_pgn(
    payload: GameIds,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A selection as one multi-game PGN file, in the order the ids were given."""
    rows = (
        await db.execute(
            select(Game).where(
                Game.id.in_(payload.ids),
                (Game.owner_id == user.id) | (Game.owner_id.is_(None)),
            )
        )
    ).scalars().all()
    by_id = {g.id: g for g in rows}
    body = "\n".join(game_pgn(by_id[i]) for i in dict.fromkeys(payload.ids) if i in by_id)
    return PlainTextResponse(
        body,
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": 'attachment; filename="games.pgn"'},
    )


@router.delete("/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_game(
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await db.get(Game, game_id)
    if game is None or game.owner_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})
    await db.delete(game)
    await db.commit()


@router.get("/games/{game_id}/pgn")
async def export_game_pgn(
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a game as a .pgn file with headers rebuilt from metadata."""
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})

    return PlainTextResponse(
        game_pgn(game),
        media_type="application/x-chess-pgn",
        headers={"Content-Disposition": f'attachment; filename="game_{game_id}.pgn"'},
    )


@router.put("/games/{game_id}/annotations", response_model=list[AnnotationOut])
async def upsert_annotations(
    game_id: int,
    payload: list[AnnotationIn],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})

    # One statement for the whole payload. The read-then-branch version cost a
    # SELECT plus a write per ply, so saving the comments on a 40-move game was
    # ~120 round trips; annotations' UNIQUE (game_id, user_id, ply) already
    # decides insert-vs-update, so asking first was never necessary.
    #
    # Only nag and comment are overwritten: the engine owns eval_cp, best_uci,
    # move_uci/san, classification and review, and a user editing a comment
    # must not blank the review that came with it.
    await bulk_upsert(
        db,
        Annotation,
        [
            {
                "game_id": game_id, "user_id": user.id, "ply": item.ply,
                "nag": item.nag, "comment": item.comment,
            }
            for item in payload
        ],
        conflict_on=("game_id", "user_id", "ply"),
        update=("nag", "comment"),
    )

    await db.commit()
    result = await db.execute(
        select(Annotation).where(Annotation.game_id == game_id, Annotation.user_id == user.id)
    )
    return list(result.scalars().all())


# ---------- collections ----------

@router.get("/collections", response_model=list[CollectionOut])
async def list_collections(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Collection, func.count(CollectionGame.game_id))
        .outerjoin(CollectionGame, CollectionGame.collection_id == Collection.id)
        .where(Collection.user_id == user.id)
        .group_by(Collection.id)
    )
    return [
        CollectionOut(id=c.id, name=c.name, game_count=n) for c, n in result.all()
    ]


@router.post("/collections", response_model=CollectionOut, status_code=status.HTTP_201_CREATED)
async def create_collection(
    payload: CollectionIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    col = Collection(user_id=user.id, name=payload.name)
    db.add(col)
    await db.commit()
    await db.refresh(col)
    return CollectionOut(id=col.id, name=col.name, game_count=0)


@router.post("/collections/{collection_id}/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_to_collection(
    collection_id: int,
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    col = await db.get(Collection, collection_id)
    if col is None or col.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Collection not found"})

    # The game has to be one you may read, or a collection becomes a handle on
    # arbitrary rows: /analysis/collection queues a review for every game in it
    # and hands the result back through /analysis/jobs, which would have
    # returned another user's private game to whoever filed the job.
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})

    await db.execute(
        pg_insert(CollectionGame)
        .values(collection_id=collection_id, game_id=game_id)
        .on_conflict_do_nothing()
    )
    await db.commit()


async def _own_collection(db: AsyncSession, collection_id: int, user: User) -> Collection:
    col = await db.get(Collection, collection_id)
    if col is None or col.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Collection not found"})
    return col


@router.post("/collections/{collection_id}/games", response_model=CollectionOut)
async def add_many_to_collection(
    collection_id: int,
    payload: GameIds,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    File a selection. Games you may not read are dropped silently, for the
    reason the single-game route spells out: a collection must never become a
    handle on somebody else's rows.
    """
    col = await _own_collection(db, collection_id, user)
    readable = (
        await db.execute(
            select(Game.id).where(
                Game.id.in_(payload.ids),
                (Game.owner_id == user.id) | (Game.owner_id.is_(None)),
            )
        )
    ).scalars().all()
    if readable:
        await db.execute(
            pg_insert(CollectionGame)
            .values([{"collection_id": col.id, "game_id": gid} for gid in readable])
            .on_conflict_do_nothing()
        )
        await db.commit()
    count = await db.execute(
        select(func.count()).select_from(CollectionGame).where(CollectionGame.collection_id == col.id)
    )
    return CollectionOut(id=col.id, name=col.name, game_count=count.scalar_one())


@router.delete(
    "/collections/{collection_id}/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_from_collection(
    collection_id: int,
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Take a game out of a collection. The game itself is untouched."""
    await _own_collection(db, collection_id, user)
    await db.execute(
        delete(CollectionGame).where(
            CollectionGame.collection_id == collection_id, CollectionGame.game_id == game_id
        )
    )
    await db.commit()


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(
    collection_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete the folder, not what is in it: the games stay in your database."""
    col = await _own_collection(db, collection_id, user)
    await db.delete(col)
    await db.commit()


def _tag(value: str) -> str:
    # An unescaped quote inside a tag value ends the tag early.
    return value.replace("\\", "\\\\").replace('"', '\\"')


def game_pgn(game: Game) -> str:
    """One game as PGN, with its headers rebuilt from the row."""
    date_tag = game.played_on.strftime("%Y.%m.%d") if game.played_on else "????.??.??"
    headers = [
        f'[Event "{_tag(game.event or "?")}"]',
        f'[Site "{_tag(game.site or "?")}"]',
        f'[Date "{date_tag}"]',
        f'[White "{_tag(game.white or "?")}"]',
        f'[Black "{_tag(game.black or "?")}"]',
        f'[Result "{game.result}"]',
    ]
    if game.white_elo:
        headers.append(f'[WhiteElo "{game.white_elo}"]')
    if game.black_elo:
        headers.append(f'[BlackElo "{game.black_elo}"]')
    if game.eco:
        headers.append(f'[ECO "{game.eco}"]')
    if game.opening:
        headers.append(f'[Opening "{_tag(game.opening)}"]')
    if game.time_control:
        headers.append(f'[TimeControl "{_tag(game.time_control)}"]')

    # A set-up game carries its [SetUp]/[FEN] in the movetext; a file has one
    # tag section, so they join the rest rather than starting a second game.
    setup, movetext = split_setup(game.movetext)
    body = "\n".join(headers + setup) + "\n\n" + movetext
    if not body.rstrip().endswith(game.result):
        body = body.rstrip() + f" {game.result}"
    return body + "\n"
