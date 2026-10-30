"""
Reports over your games, the ones a database program is opened for.

A crosstable of an event, a dossier on a player, and the novelty in a game -
the first move nobody in the database had played in that position before.
They read the games and the position index the rest of the API already keeps;
nothing here writes.
"""

from __future__ import annotations

import math
from collections import defaultdict

import chess
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.chess_utils import MAX_INDEXED_PLY, validate_fen, zobrist_of
from app.core.db import get_db
from app.core.deps import get_current_user
from app.core.ratelimit import user_rate_limit
from app.models import Game, User
from app.schemas import (
    Crosstable,
    CrosstablePlayer,
    DossierOpening,
    DossierOpponent,
    EventSummary,
    GameOut,
    NoveltyMove,
    NoveltyOut,
    NoveltyRequest,
    PlayerDossier,
    PlayerName,
    ScoreLine,
)

router = APIRouter(prefix="/reports", tags=["reports"])

# A crosstable of more games than this is not a tournament - it is a server's
# "Rated Blitz game" event - and the matrix of it nobody could read.
MAX_EVENT_GAMES = 2000
# Above this many players the standings are given without the matrix.
MAX_MATRIX_PLAYERS = 40
# A dossier reads every game of one player. Bounded like any other scan.
MAX_DOSSIER_GAMES = 20000

POINTS = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}


def _like(value: str) -> str:
    return "%" + value.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _mark(points: float) -> str:
    return "½" if points == 0.5 else str(int(points))


def performance(opponent_elos: list[int], points: float) -> int | None:
    """
    Elo performance: the rating whose expected score against these opponents
    is the score made. A perfect or zero score has no finite answer, so it is
    capped at ±800 around the average, as FIDE's table is.
    """
    if not opponent_elos:
        return None
    average = sum(opponent_elos) / len(opponent_elos)
    p = points / len(opponent_elos)
    if p <= 0:
        dp = -800.0
    elif p >= 1:
        dp = 800.0
    else:
        dp = max(-800.0, min(800.0, 400 * math.log10(p / (1 - p))))
    return round(average + dp)


def _score(wins: int, draws: int, losses: int) -> ScoreLine:
    games = wins + draws + losses
    pct = round(100 * (wins + draws / 2) / games, 1) if games else 0.0
    return ScoreLine(games=games, wins=wins, draws=draws, losses=losses, score_pct=pct)


# ---------- events and crosstables ----------

@router.get("/events", response_model=list[EventSummary])
async def list_events(
    q: str | None = Query(default=None, max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Your events with more than one game, most recent first."""
    count = func.count()
    last = func.max(Game.played_on)
    stmt = (
        select(Game.event, count, func.min(Game.played_on), last)
        .where(Game.owner_id == user.id, Game.event.not_in(["", "?"]))
        .group_by(Game.event)
        .having(count > 1)
    )
    if q:
        stmt = stmt.where(func.lower(Game.event).like(_like(q), escape="\\"))
    rows = await db.execute(stmt.order_by(last.desc().nulls_last(), count.desc(), Game.event).limit(50))
    return [
        EventSummary(event=event, games=n, first_date=first, last_date=latest)
        for event, n, first, latest in rows.all()
    ]


@router.get("/crosstable", response_model=Crosstable)
async def crosstable(
    event: str = Query(min_length=1, max_length=300),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The standings of one event in your database, and who beat whom.

    Ranked by points, then Sonneborn-Berger, the tiebreak a round robin uses.
    Unfinished games ("*") name their players but score nothing.
    """
    rows = (
        await db.execute(
            select(Game.white, Game.black, Game.white_elo, Game.black_elo, Game.result, Game.played_on)
            .where(Game.owner_id == user.id, Game.event == event)
            .limit(MAX_EVENT_GAMES + 1)
        )
    ).all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": "No games from that event in your database"},
        )
    if len(rows) > MAX_EVENT_GAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "too_many_games",
                "message": f"That event has more than {MAX_EVENT_GAMES} games - too many for a crosstable",
            },
        )

    elo: dict[str, int | None] = {}
    tally: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])  # wins, draws, losses
    against: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    rated: dict[str, list[tuple[int, float]]] = defaultdict(list)  # (opponent elo, points)
    unfinished = 0
    dates = [r.played_on for r in rows if r.played_on]

    for white, black, white_elo, black_elo, result, _ in rows:
        white, black = white or "?", black or "?"
        for name, rating in ((white, white_elo), (black, black_elo)):
            if rating and (elo.get(name) is None or rating > elo[name]):
                elo[name] = rating
            else:
                elo.setdefault(name, None)
            tally.setdefault(name, [0, 0, 0])  # every player gets a row, scored or not
        if result not in POINTS:
            unfinished += 1
            continue
        for name, opponent, points, opponent_elo in (
            (white, black, POINTS[result], black_elo),
            (black, white, 1 - POINTS[result], white_elo),
        ):
            against[name][opponent].append(points)
            tally[name][0 if points == 1 else 1 if points == 0.5 else 2] += 1
            if opponent_elo:
                rated[name].append((opponent_elo, points))

    totals = {name: sum(sum(v) for v in against[name].values()) for name in tally}
    tiebreak = {
        name: sum(points * totals[opponent] for opponent, games in against[name].items() for points in games)
        for name in tally
    }
    order = sorted(tally, key=lambda n: (-totals[n], -tiebreak[n], n.lower()))
    matrix = len(order) <= MAX_MATRIX_PLAYERS

    players = []
    for name in order:
        wins, draws, losses = tally[name]
        players.append(CrosstablePlayer(
            name=name,
            elo=elo.get(name),
            games=wins + draws + losses,
            wins=wins, draws=draws, losses=losses,
            score=totals[name],
            tiebreak=round(tiebreak[name], 2),
            performance=performance([e for e, _ in rated[name]], sum(p for _, p in rated[name])),
            results=[
                " ".join(_mark(p) for p in against[name].get(opponent, []))
                for opponent in order
            ] if matrix else [],
        ))

    return Crosstable(
        event=event,
        games=len(rows),
        unfinished=unfinished,
        first_date=min(dates) if dates else None,
        last_date=max(dates) if dates else None,
        players=players,
    )


# ---------- players ----------

@router.get("/players", response_model=list[PlayerName])
async def find_players(
    q: str = Query(min_length=1, max_length=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Player names in your games containing `q`, the most games first."""
    rows = await db.execute(
        text(
            """
            SELECT name, COUNT(*) AS games
            FROM (
                SELECT white AS name FROM games WHERE owner_id = :uid
                UNION ALL
                SELECT black AS name FROM games WHERE owner_id = :uid
            ) names
            WHERE name <> '' AND lower(name) LIKE :q ESCAPE '\\'
            GROUP BY name
            ORDER BY games DESC, name
            LIMIT 20
            """
        ),
        {"uid": user.id, "q": _like(q)},
    )
    return [PlayerName(name=name, games=n) for name, n in rows.all()]


@router.get("/player", response_model=PlayerDossier)
async def player_dossier(
    name: str = Query(min_length=1, max_length=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Everything your database knows about one player: their score with each
    colour, what they open with, whom they meet, their rating, their latest
    games. Names match without regard to case.
    """
    who = name.lower()
    games = (
        await db.execute(
            select(Game)
            .where(
                Game.owner_id == user.id,
                or_(func.lower(Game.white) == who, func.lower(Game.black) == who),
            )
            .order_by(Game.played_on.desc().nulls_last(), Game.id.desc())
            .limit(MAX_DOSSIER_GAMES)
        )
    ).scalars().all()
    if not games:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found", "message": f'No games of "{name}" in your database'},
        )

    colour_tally = {"w": [0, 0, 0], "b": [0, 0, 0]}
    openings = {"w": defaultdict(lambda: [0, 0.0]), "b": defaultdict(lambda: [0, 0.0])}
    opponents: dict[str, list] = defaultdict(lambda: [0, 0.0])
    opponent_names: dict[str, str] = {}
    elos: list[int] = []
    latest_elo = None
    display = name

    for g in games:
        side = "w" if g.white.lower() == who else "b"
        display = g.white if side == "w" else g.black
        rating = g.white_elo if side == "w" else g.black_elo
        if rating:
            elos.append(rating)
            if latest_elo is None:  # games arrive newest first
                latest_elo = rating
        if g.result not in POINTS:
            continue
        points = POINTS[g.result] if side == "w" else 1 - POINTS[g.result]
        colour_tally[side][0 if points == 1 else 1 if points == 0.5 else 2] += 1
        line = openings[side][(g.eco, g.opening)]
        line[0] += 1
        line[1] += points
        opponent = g.black if side == "w" else g.white
        key = (opponent or "?").lower()
        opponent_names.setdefault(key, opponent or "?")
        opponents[key][0] += 1
        opponents[key][1] += points

    def top_openings(side: str) -> list[DossierOpening]:
        ranked = sorted(openings[side].items(), key=lambda kv: (-kv[1][0], kv[0][0] or "~"))
        return [
            DossierOpening(eco=eco, opening=opening, games=n, score_pct=round(100 * pts / n, 1))
            for (eco, opening), (n, pts) in ranked[:8]
        ]

    white, black = colour_tally["w"], colour_tally["b"]
    dated = [g.played_on for g in games if g.played_on]
    return PlayerDossier(
        name=display,
        total=_score(white[0] + black[0], white[1] + black[1], white[2] + black[2]),
        as_white=_score(*white),
        as_black=_score(*black),
        highest_elo=max(elos) if elos else None,
        latest_elo=latest_elo,
        first_date=min(dated) if dated else None,
        last_date=max(dated) if dated else None,
        openings_white=top_openings("w"),
        openings_black=top_openings("b"),
        opponents=[
            DossierOpponent(name=opponent_names[key], games=n, score_pct=round(100 * pts / n, 1))
            for key, (n, pts) in sorted(opponents.items(), key=lambda kv: (-kv[1][0], kv[0]))[:10]
        ],
        recent=[GameOut.model_validate(g) for g in games[:10]],
    )


# ---------- novelty ----------

@router.post(
    "/novelty",
    response_model=NoveltyOut,
    dependencies=[user_rate_limit("novelty", 30, 60)],
)
async def find_novelty(
    payload: NoveltyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    The first move of a game that the database had never seen played in its
    position - what ChessBase marks N.

    Only the opening plies the position index holds are checked; a game that
    stays in known territory that long has its novelty, if any, later than the
    index can see, and is reported as known.
    """
    try:
        board = validate_fen(payload.start_fen)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_fen", "message": str(exc)})

    boards: list[chess.Board] = []
    for uci in payload.moves[:MAX_INDEXED_PLY]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            move = None
        if move is None or move not in board.legal_moves:
            raise HTTPException(
                status_code=400,
                detail={"code": "illegal_move", "message": f"{uci} is not a legal move in that game"},
            )
        boards.append(board.copy(stack=False))
        board.push(move)

    if not boards:
        return NoveltyOut(status="known", checked_plies=0)
    zobs = [zobrist_of(b.fen()) for b in boards]

    if payload.scope == "reference":
        rows = await db.execute(
            text(
                """
                SELECT zobrist, move_uci, games, white_wins, draws, black_wins
                FROM opening_tree
                WHERE zobrist = ANY(:zobs)
                """
            ),
            {"zobs": zobs},
        )
    else:
        rows = await db.execute(
            text(
                """
                SELECT p.zobrist, p.move_uci,
                       COUNT(*)                                     AS games,
                       COUNT(*) FILTER (WHERE g.result = '1-0')     AS white_wins,
                       COUNT(*) FILTER (WHERE g.result = '1/2-1/2') AS draws,
                       COUNT(*) FILTER (WHERE g.result = '0-1')     AS black_wins
                FROM game_positions p
                JOIN games g ON g.id = p.game_id
                WHERE p.zobrist = ANY(:zobs) AND g.owner_id = :uid AND g.id <> :exclude
                GROUP BY p.zobrist, p.move_uci
                """
            ),
            # A game does not set a precedent for itself.
            {"zobs": zobs, "uid": user.id, "exclude": payload.game_id or 0},
        )

    stats: dict[int, dict[str, tuple[int, int, int, int]]] = defaultdict(dict)
    for zob, uci, games, white_wins, draws, black_wins in rows.all():
        stats[zob][uci] = (games, white_wins, draws, black_wins)

    for ply, (before, zob, uci) in enumerate(zip(boards, zobs, payload.moves)):
        here = stats.get(zob, {})
        total = sum(s[0] for s in here.values())
        if not total:
            # Nothing reached the start: an empty database. Later than that,
            # the line left the index by transposition, not by a new move.
            return NoveltyOut(status="no_games" if ply == 0 else "known", checked_plies=ply)
        if uci in here:
            continue
        white_to_move = before.turn == chess.WHITE
        known = []
        for move_uci, (games, white_wins, draws, black_wins) in sorted(here.items(), key=lambda kv: -kv[1][0])[:5]:
            try:
                san = before.san(chess.Move.from_uci(move_uci))
            except (ValueError, AssertionError):
                san = move_uci
            mine = white_wins if white_to_move else black_wins
            known.append(NoveltyMove(
                uci=move_uci, san=san, games=games,
                score_pct=round(100 * (mine + draws / 2) / games, 1) if games else 0.0,
            ))
        return NoveltyOut(
            status="novelty",
            ply=ply,
            san=before.san(chess.Move.from_uci(uci)),
            position_games=total,
            known_moves=known,
            checked_plies=ply + 1,
        )

    return NoveltyOut(status="known", checked_plies=len(boards))
