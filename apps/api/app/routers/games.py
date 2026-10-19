"""Game CRUD, PGN import/export, collections, annotations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.core.bulk import bulk_insert, bulk_upsert
from app.core.chess_utils import game_from_movetext, parse_pgn, positions_of_game
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ratelimit import user_rate_limit
from app.models import Annotation, Collection, CollectionGame, Game, GamePosition, User
from app.schemas import (
    AnnotationIn,
    AnnotationOut,
    CollectionIn,
    CollectionOut,
    GameDetail,
    GameOut,
    GameUpdate,
    ImportPgnRequest,
    ImportResult,
)
from app.services.importers import color_played, user_identities

router = APIRouter(tags=["games"])




@router.get("/games", response_model=list[GameOut])
async def list_games(
    # Bounded at the edge: an unchecked page=0 became OFFSET -50, which
    # Postgres rejects, turning a query-string typo into a 500.
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    collection: int | None = None,
    q: str | None = Query(default=None, max_length=100),
    result: str | None = None,
    eco: str | None = None,
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
                Game.ply_count, Game.variant,
            )
        )
        .where(Game.owner_id == user.id)
    )

    if collection is not None:
        stmt = stmt.join(CollectionGame, CollectionGame.game_id == Game.id).where(
            CollectionGame.collection_id == collection
        )
    if q:
        # Escape LIKE metacharacters: a bare "%" would otherwise match the
        # whole table and turn the search box into a full scan.
        needle = "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(
            func.lower(Game.white).like(needle, escape="\\")
            | func.lower(Game.black).like(needle, escape="\\")
        )
    if result in ("1-0", "0-1", "1/2-1/2", "*"):
        stmt = stmt.where(Game.result == result)
    if eco:
        stmt = stmt.where(Game.eco == eco.upper()[:3])

    # id breaks ties on created_at. Without it the sort is not a total order,
    # and games imported in the same batch share a timestamp to the microsecond
    # - so paging a freshly imported PGN could show one game twice and skip
    # another entirely. Same reason the reference search orders by id last.
    stmt = (
        stmt.order_by(Game.created_at.desc(), Game.id.desc())
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
    parsed = parse_pgn(payload.pgn)
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_pgn", "message": "No valid games found in that PGN"},
        )

    errors: list[str] = []
    # Lets Insights count a hand-pasted game as yours when the PGN names you.
    identities = await user_identities(db, user)

    # Build every row before touching the database. Replaying a PGN is where
    # a bad game actually fails, so validating first keeps the "skip the
    # broken game, import the rest" contract while letting the writes below
    # be two statements instead of two per game.
    rows: list[dict] = []
    indexes: list[list[tuple[int, int, str]]] = []
    for entry in parsed:
        try:
            positions = positions_of_game(
                entry["movetext"], variant=entry["variant"], start_fen=entry["start_fen"]
            )
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
        imported=len(ids), skipped=len(parsed) - len(ids), errors=errors, game_ids=ids
    )


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


@router.get("/games/{game_id}/line")
async def get_game_line(
    game_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    game = await db.get(Game, game_id)
    if game is None or (game.owner_id is not None and game.owner_id != user.id):
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Game not found"})
    try:
        pgn = game_from_movetext(game.movetext, game.variant, game.start_fen)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Stored game could not be replayed") from exc
    board = pgn.board()
    start_fen = board.fen(shredder=board.chess960)
    moves = []
    for ply, played in enumerate(pgn.mainline_moves()):
        san = board.san(played)
        board.push(played)
        moves.append({"ply": ply, "san": san, "uci": played.uci(),
                      "fen": board.fen(shredder=board.chess960)})
    return {"variant": game.variant, "start_fen": start_fen, "moves": moves}


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
        setattr(game, field, value)
    await db.commit()
    await db.refresh(game)
    return game


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

    date_tag = game.played_on.strftime("%Y.%m.%d") if game.played_on else "????.??.??"
    headers = [
        f'[Event "{game.event or "?"}"]',
        f'[Site "{game.site or "?"}"]',
        f'[Date "{date_tag}"]',
        f'[White "{game.white or "?"}"]',
        f'[Black "{game.black or "?"}"]',
        f'[Result "{game.result}"]',
    ]
    if game.white_elo:
        headers.append(f'[WhiteElo "{game.white_elo}"]')
    if game.black_elo:
        headers.append(f'[BlackElo "{game.black_elo}"]')
    if game.eco:
        headers.append(f'[ECO "{game.eco}"]')
    if game.variant == "chess960":
        headers.extend(['[Variant "Chess960"]', '[SetUp "1"]', f'[FEN "{game.start_fen}"]'])
    elif game.start_fen:
        headers.extend(['[SetUp "1"]', f'[FEN "{game.start_fen}"]'])

    body = "\n".join(headers) + "\n\n" + game.movetext
    if not body.rstrip().endswith(game.result):
        body = body.rstrip() + f" {game.result}"
    body += "\n"

    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        body,
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

    db.add(CollectionGame(collection_id=collection_id, game_id=game_id))
    await db.commit()
