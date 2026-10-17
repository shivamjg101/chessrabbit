"""
Player Insights: "how do YOU play?", aggregated across a player's own games.

Two passes, split by cost:

1. SQL, over every game matching the filter. Counts, win rates, openings,
   terminations, calendar - things Postgres can group far faster than Python.
2. A replay pass over the most recent `REPLAY_LIMIT` *reviewed* games. Anything
   that needs the board (which piece moved, when you castled, which phase a
   move fell in) or the eval curve (accuracy, game shape) is computed here,
   joining the stored engine annotations to the replayed position.

Only games with a known `user_color` are counted. A game we cannot attribute
would otherwise invert every win rate on the page, so it is excluded and the
response reports how many were skipped.
"""

from __future__ import annotations

import io
import json
import logging
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable

import chess
import chess.pgn
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.openings import normalize_eco, opening_label
from app.models import Annotation, User

log = logging.getLogger(__name__)

# How many reviewed games the replay pass walks. A full review is ~80 plies of
# python-chess work; 400 keeps the endpoint well under a second while covering
# far more games than most players will ever have reviewed.
REPLAY_LIMIT = 400

CACHE_TTL = 300  # seconds

# An opening you played once says nothing about how you play it, and a long
# tail of one-offs buries the lines you actually have a record in.
MIN_OPENING_GAMES = 2
MAX_OPENING_ROWS = 12

CLASSIFICATIONS = (
    "brilliant", "best", "excellent", "good", "book",
    "inaccuracy", "mistake", "blunder",
)

PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
    chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
}

DAY_LABELS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")


# ----------------------------------------------------------------------------
# Scoring helpers - identical maths to the engine worker, so a number here
# always agrees with the same number on a game's review panel.
# ----------------------------------------------------------------------------

def win_percent(cp: float) -> float:
    """Centipawns -> White's win probability (0-100)."""
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(loss: float) -> float:
    """One move's accuracy from the win% it gave away."""
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * loss) - 3.1669))


def _mean(values: Iterable[float]) -> float | None:
    vals = list(values)
    return round(sum(vals) / len(vals), 1) if vals else None


@dataclass
class Filters:
    time_class: str | None = None       # bullet|blitz|rapid|classical|correspondence
    color: str | None = None            # 'w' | 'b'
    since: date | None = None           # inclusive lower bound on played_on
    tz_offset: int = 0                  # viewer's minutes from UTC

    def cache_key(self, user_id: int) -> str:
        return (
            f"insights:{user_id}:{self.time_class or 'all'}"
            f":{self.color or 'all'}:{self.since or 'all'}:{self.tz_offset}"
        )

    def as_dict(self) -> dict:
        return {
            "time_class": self.time_class,
            "color": self.color,
            "since": self.since.isoformat() if self.since else None,
            "tz_offset": self.tz_offset,
        }


@dataclass
class _Tally:
    """Games and their outcomes, the unit almost every chart is built from."""
    games: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    accuracies: list[float] = field(default_factory=list)

    def add(self, outcome: str, accuracy: float | None = None) -> None:
        self.games += 1
        if outcome == "win":
            self.wins += 1
        elif outcome == "draw":
            self.draws += 1
        else:
            self.losses += 1
        if accuracy is not None:
            self.accuracies.append(accuracy)

    def as_dict(self) -> dict:
        return {
            "games": self.games,
            "wins": self.wins,
            "draws": self.draws,
            "losses": self.losses,
            "accuracy": _mean(self.accuracies),
        }


def outcome_for(result: str, color: str) -> str:
    """Result from the owner's point of view."""
    if result == "1/2-1/2":
        return "draw"
    if result == "1-0":
        return "win" if color == "w" else "loss"
    if result == "0-1":
        return "win" if color == "b" else "loss"
    return "draw"  # unfinished games are rare; treat as neutral rather than drop


# ----------------------------------------------------------------------------
# Pass 1 - SQL aggregates over every matching game
# ----------------------------------------------------------------------------

def _where(filters: Filters) -> tuple[str, dict]:
    # An unfinished game ('*') has no outcome to learn from, and counting it
    # would make wins + draws + losses disagree with the game total.
    clauses = ["g.owner_id = :uid", "g.user_color IS NOT NULL", "g.result <> '*'"]
    params: dict[str, Any] = {"tzoff": filters.tz_offset}
    if filters.time_class:
        clauses.append("g.time_class = :tc")
        params["tc"] = filters.time_class
    if filters.color:
        clauses.append("g.user_color = :col")
        params["col"] = filters.color
    if filters.since:
        clauses.append("g.played_on >= :since")
        params["since"] = filters.since
    return " AND ".join(clauses), params


async def _sql_aggregates(db: AsyncSession, user_id: int, filters: Filters) -> dict:
    where, params = _where(filters)
    params["uid"] = user_id

    async def rows(sql: str) -> list:
        res = await db.execute(text(sql), params)
        return res.all()

    # --- headline counts + monthly volume ---
    totals = (await rows(f"""
        SELECT count(*)                                              AS games,
               count(*) FILTER (WHERE g.result = '1-0' AND g.user_color = 'w'
                                   OR g.result = '0-1' AND g.user_color = 'b') AS wins,
               count(*) FILTER (WHERE g.result = '1/2-1/2')          AS draws,
               count(*) FILTER (WHERE g.result = '1-0' AND g.user_color = 'b'
                                   OR g.result = '0-1' AND g.user_color = 'w') AS losses
        FROM games g WHERE {where}
    """))[0]

    by_month = await rows(f"""
        SELECT to_char(date_trunc('month', g.played_on), 'YYYY-MM') AS label,
               count(*) AS games
        FROM games g WHERE {where} AND g.played_on IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # --- how games ended ---
    terminations = await rows(f"""
        SELECT CASE WHEN g.result = '1/2-1/2' THEN 'draw'
                    WHEN (g.result = '1-0') = (g.user_color = 'w') THEN 'win'
                    ELSE 'loss' END                        AS outcome,
               coalesce(g.termination, 'other')            AS reason,
               count(*)                                    AS games
        FROM games g WHERE {where}
        GROUP BY 1, 2 ORDER BY 3 DESC
    """)

    # --- results against opponent strength, in 200-point buckets ---
    opponents = await rows(f"""
        SELECT (CASE WHEN g.user_color = 'w' THEN g.black_elo ELSE g.white_elo END / 200) * 200 AS bucket,
               count(*)                                                        AS games,
               count(*) FILTER (WHERE (g.result = '1-0') = (g.user_color = 'w')
                                  AND g.result <> '1/2-1/2')                   AS wins,
               count(*) FILTER (WHERE g.result = '1/2-1/2')                    AS draws
        FROM games g
        WHERE {where}
          AND (CASE WHEN g.user_color = 'w' THEN g.black_elo ELSE g.white_elo END) IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # --- openings, split by the colour you held. Grouped by the (name, code)
    # pair the PGN actually carried, never by name alone: nameless games would
    # otherwise pool into one row wearing whichever ECO sorted highest. The
    # displayed name, and the "played twice" cut, are settled in Python, where
    # a game holding only a code can still be given its family's name. ---
    openings = await rows(f"""
        SELECT g.user_color                                            AS color,
               nullif(btrim(g.opening), '')                            AS name,
               nullif(btrim(g.eco), '')                                AS eco,
               count(*)                                                AS games,
               count(*) FILTER (WHERE (g.result = '1-0') = (g.user_color = 'w')
                                  AND g.result <> '1/2-1/2')           AS wins,
               count(*) FILTER (WHERE g.result = '1/2-1/2')            AS draws
        FROM games g WHERE {where} AND g.variant = 'standard'
        GROUP BY 1, 2, 3
    """)

    # --- calendar. played_at is the only source with a clock on it, and the
    # slots only mean anything in the viewer's own timezone, so we shift the
    # stored UTC instant by the offset the browser reported. ---
    time_of_day = await rows(f"""
        WITH local AS (
            SELECT extract(hour FROM (g.played_at AT TIME ZONE 'UTC')
                                     + make_interval(mins => :tzoff)) AS hour,
                   g.result, g.user_color
            FROM games g WHERE {where} AND g.played_at IS NOT NULL
        )
        SELECT CASE WHEN hour < 6  THEN 'night'
                    WHEN hour < 12 THEN 'morning'
                    WHEN hour < 18 THEN 'afternoon'
                    ELSE 'evening' END                                  AS slot,
               count(*)                                                 AS games,
               count(*) FILTER (WHERE (result = '1-0') = (user_color = 'w')
                                  AND result <> '1/2-1/2')              AS wins,
               count(*) FILTER (WHERE result = '1/2-1/2')               AS draws
        FROM local
        GROUP BY 1
    """)

    day_of_week = await rows(f"""
        SELECT extract(dow FROM g.played_on)::int                       AS dow,
               count(*)                                                 AS games,
               count(*) FILTER (WHERE (g.result = '1-0') = (g.user_color = 'w')
                                  AND g.result <> '1/2-1/2')            AS wins,
               count(*) FILTER (WHERE g.result = '1/2-1/2')             AS draws
        FROM games g WHERE {where} AND g.played_on IS NOT NULL
        GROUP BY 1 ORDER BY 1
    """)

    # --- move quality, counting only the plies you actually moved ---
    quality = await rows(f"""
        SELECT a.classification AS cls, count(*) AS moves
        FROM annotations a JOIN games g ON g.id = a.game_id
        WHERE {where}
          AND a.user_id = :uid
          AND a.classification IS NOT NULL
          AND (a.ply % 2 = 0) = (g.user_color = 'w')
        GROUP BY 1
    """)

    # Recent reviewed games with a concrete next action. Count both sides:
    # the interactive review asks about every critical position in a game.
    practice_games = await rows(f"""
        SELECT g.id, g.white, g.black, g.opening, g.played_on,
               count(*) AS critical_moves
        FROM games g JOIN annotations a ON a.game_id = g.id
        WHERE {where}
          AND a.user_id = :uid
          AND a.classification IN ('inaccuracy', 'mistake', 'blunder')
          AND a.best_uci IS NOT NULL
        GROUP BY g.id
        ORDER BY g.played_on DESC NULLS LAST, g.id DESC
        LIMIT 6
    """)

    # --- games we could not attribute to a colour, so the page can say so ---
    unattributed = (await rows("""
        SELECT count(*) FROM games g
        WHERE g.owner_id = :uid AND g.user_color IS NULL
    """))[0][0]

    return {
        "totals": totals,
        "by_month": by_month,
        "terminations": terminations,
        "opponents": opponents,
        "openings": openings,
        "time_of_day": time_of_day,
        "day_of_week": day_of_week,
        "quality": quality,
        "practice_games": practice_games,
        "unattributed": unattributed,
    }


# ----------------------------------------------------------------------------
# Pass 2 - replay reviewed games for anything needing the board or eval curve
# ----------------------------------------------------------------------------

def _phase_of(board: chess.Board, ply: int) -> str:
    """
    Opening until both sides have developed or ply 20; endgame once the heavy
    material is off. Deliberately simple and stated in the UI, so a reader can
    tell what the number means.
    """
    if ply < 20:
        return "opening"
    officers = sum(
        len(board.pieces(pt, color))
        for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
        for color in (chess.WHITE, chess.BLACK)
    )
    return "endgame" if officers <= 6 else "middlegame"


def _shape_of(swings: list[float], lead_changes: int, plies: int) -> str:
    """
    Name the trajectory of a game from its eval curve.

    Our own taxonomy, not Chess.com's - the thresholds are ours and are spelled
    out in the UI so nobody has to guess what "wild" means:
      smooth  - nothing much happened; one side stayed on top
      grind   - long and quiet
      sudden  - calm, then a single decisive swing
      sharp   - repeatedly volatile
      wild    - volatile AND the advantage changed hands repeatedly
    """
    if not swings:
        return "smooth"
    mean_swing = sum(swings) / len(swings)
    peak = max(swings)
    volatile = mean_swing >= 6

    if volatile and lead_changes >= 3:
        return "wild"
    if volatile:
        return "sharp"
    # Guarded on `not volatile`, so "one decisive moment in an otherwise calm
    # game" cannot be swallowed by the volatility branches above.
    if peak >= 25:
        return "sudden"
    if plies >= 80:
        return "grind"
    return "smooth"


async def _replay_pass(
    db: AsyncSession, user_id: int, filters: Filters
) -> dict:
    where, params = _where(filters)
    params["uid"] = user_id
    params["lim"] = REPLAY_LIMIT

    res = await db.execute(text(f"""
        SELECT g.id, g.result, g.user_color, g.movetext, g.ply_count, g.played_on
        FROM games g
        WHERE {where}
          AND EXISTS (SELECT 1 FROM annotations a
                      WHERE a.game_id = g.id AND a.user_id = :uid
                        AND a.classification IS NOT NULL)
        ORDER BY g.played_on DESC NULLS LAST, g.id DESC
        LIMIT :lim
    """), params)
    games = res.all()
    if not games:
        return {"reviewed": 0}

    ann_res = await db.execute(
        select(Annotation.game_id, Annotation.ply, Annotation.eval_cp,
               Annotation.classification)
        .where(Annotation.user_id == user_id,
               Annotation.game_id.in_([g[0] for g in games]))
        .order_by(Annotation.game_id, Annotation.ply)
    )
    by_game: dict[int, list[tuple]] = defaultdict(list)
    for gid, ply, cp, cls in ann_res.all():
        by_game[gid].append((ply, cp, cls))

    # Accumulators
    overall: list[float] = []
    by_outcome: dict[str, list[float]] = defaultdict(list)
    by_move_number: dict[int, list[float]] = defaultdict(list)
    phase_acc: dict[str, list[float]] = defaultdict(list)
    ended_in = _counter()
    phase_tally: dict[str, _Tally] = defaultdict(_Tally)
    shape_tally: dict[str, _Tally] = defaultdict(_Tally)
    piece_moves = _counter()
    piece_acc: dict[str, list[float]] = defaultdict(list)
    castle_phase = _counter()
    castle_side = _counter()
    castle_tally: dict[str, _Tally] = defaultdict(_Tally)
    quality_by_month: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    clock_quality: dict[str, dict[str, int]] = defaultdict(lambda: {"moves": 0, "errors": 0})
    reviewed = 0

    for gid, result, color, movetext, ply_count, played_on in games:
        anns = by_game.get(gid)
        if not anns:
            continue
        reviewed += 1
        white = color == "w"
        outcome = outcome_for(result, color)
        month = played_on.strftime("%Y-%m") if played_on else None

        cp_by_ply = {ply: cp for ply, cp, _ in anns if cp is not None}
        cls_by_ply = {ply: cls for ply, _, cls in anns if cls}

        game = chess.pgn.read_game(io.StringIO(movetext))
        if game is None:
            continue
        board = game.board()

        accuracies: list[float] = []
        swings: list[float] = []
        lead_changes = 0
        prev_side = None
        last_phase = "opening"
        castled_at: tuple[str, str] | None = None
        # Eval before the first move: the start position is level.
        prev_cp = 0.0

        for ply, node in enumerate(game.mainline()):
            move = node.move
            phase = _phase_of(board, ply)
            last_phase = phase
            mine = (ply % 2 == 0) == white
            cp = cp_by_ply.get(ply)

            # Shape is a property of the whole game, so the eval curve is
            # tracked across both sides' moves.
            if cp is not None:
                before, after = win_percent(prev_cp), win_percent(cp)
                swings.append(abs(after - before))
                if prev_side is not None and (after >= 50) != prev_side:
                    lead_changes += 1
                prev_side = after >= 50
                # Accuracy is always the loss suffered by whoever moved.
                loss = max(0.0, (before - after) if ply % 2 == 0 else (after - before))
                prev_cp = cp
            else:
                loss = None

            if mine:
                piece = board.piece_at(move.from_square)
                name = PIECE_NAMES.get(piece.piece_type) if piece else None
                if board.is_castling(move):
                    castled_at = (
                        phase, "short" if board.is_kingside_castling(move) else "long"
                    )
                if name:
                    piece_moves[name] += 1

                if loss is not None:
                    acc = move_accuracy(loss)
                    accuracies.append(acc)
                    by_move_number[ply // 2 + 1].append(acc)
                    phase_acc[phase].append(acc)
                    if name:
                        piece_acc[name].append(acc)

                cls = cls_by_ply.get(ply)
                if cls and month:
                    quality_by_month[month][cls] += 1
                if cls and (seconds := node.clock()) is not None:
                    band = "under_30" if seconds <= 30 else "over_30"
                    clock_quality[band]["moves"] += 1
                    if cls in {"inaccuracy", "mistake", "blunder"}:
                        clock_quality[band]["errors"] += 1

            board.push(move)

        game_accuracy = _mean(accuracies)
        if game_accuracy is not None:
            overall.append(game_accuracy)
            by_outcome[outcome].append(game_accuracy)

        ended_in[last_phase] += 1
        phase_tally[last_phase].add(outcome, game_accuracy)

        shape = _shape_of(swings, lead_changes, ply_count)
        shape_tally[shape].add(outcome, game_accuracy)

        if castled_at:
            castle_phase[castled_at[0]] += 1
            castle_side[castled_at[1]] += 1
            castle_tally[castled_at[0]].add(outcome, game_accuracy)
        else:
            castle_phase["none"] += 1
            castle_tally["none"].add(outcome, game_accuracy)

    return {
        "reviewed": reviewed,
        "accuracy": {
            "overall": _mean(overall),
            "win": _mean(by_outcome["win"]),
            "draw": _mean(by_outcome["draw"]),
            "loss": _mean(by_outcome["loss"]),
        },
        # Trim the long tail: past move ~60 the sample is a handful of games
        # and the line turns to noise.
        "accuracy_by_move": [
            {"move": n, "accuracy": _mean(v), "moves": len(v)}
            for n, v in sorted(by_move_number.items())
            if n <= 60 and len(v) >= 3
        ],
        "phases": {
            "ended_in": dict(ended_in),
            "accuracy": {k: _mean(v) for k, v in phase_acc.items()},
            "results": {k: v.as_dict() for k, v in phase_tally.items()},
        },
        "shapes": {k: v.as_dict() for k, v in shape_tally.items()},
        "pieces": [
            {"piece": p, "moves": piece_moves[p], "accuracy": _mean(piece_acc[p])}
            for p in ("pawn", "knight", "bishop", "rook", "queen", "king")
            if piece_moves[p]
        ],
        "castling": {
            "phase": dict(castle_phase),
            "side": dict(castle_side),
            "results": {k: v.as_dict() for k, v in castle_tally.items()},
        },
        "quality_by_month": {
            m: dict(counts) for m, counts in sorted(quality_by_month.items())
        },
        "time_pressure": dict(clock_quality),
    }


def _counter() -> defaultdict:
    return defaultdict(int)


# ----------------------------------------------------------------------------
# Assembly
# ----------------------------------------------------------------------------

def _openings_payload(rows: list) -> dict:
    """
    Fold the raw (name, code) groups into one row per opening, per colour.

    Games that arrived without a name are labelled from their ECO code, so a
    Chess.com library reads as "Italian Game" and "Caro-Kann Defense" instead
    of collapsing into a single "Unknown opening" row.
    """
    buckets: dict[str, dict[str, dict]] = {"w": {}, "b": {}}
    for color, name, eco, games, wins, draws in rows:
        if color not in buckets:
            continue
        label = opening_label(name, eco)
        row = buckets[color].setdefault(
            label,
            {"name": label, "codes": Counter(), "games": 0, "wins": 0, "draws": 0},
        )
        code = normalize_eco(eco)
        if code:
            row["codes"][code] += games
        row["games"] += games
        row["wins"] += wins
        row["draws"] += draws

    def ranked(color: str) -> list[dict]:
        # One game is an anecdote, not a pattern, and the page says as much.
        kept = [r for r in buckets[color].values() if r["games"] >= MIN_OPENING_GAMES]
        kept.sort(key=lambda r: (-r["games"], r["name"]))
        return [
            {
                "name": r["name"],
                # The code most of the row is made of. A named opening can
                # span several; showing the commonest beats showing none.
                "eco": r["codes"].most_common(1)[0][0] if r["codes"] else None,
                "games": r["games"],
                "wins": r["wins"],
                "draws": r["draws"],
                "losses": r["games"] - r["wins"] - r["draws"],
            }
            for r in kept[:MAX_OPENING_ROWS]
        ]

    return {"white": ranked("w"), "black": ranked("b")}


async def build_insights(db: AsyncSession, user: User, filters: Filters) -> dict:
    agg = await _sql_aggregates(db, user.id, filters)
    replay = await _replay_pass(db, user.id, filters)

    games, wins, draws, losses = agg["totals"]
    quality_total = sum(r[1] for r in agg["quality"]) or 1

    return {
        "filters": filters.as_dict(),
        "games": games,
        "reviewed": replay.get("reviewed", 0),
        "unattributed": agg["unattributed"],
        "practice_games": [
            {
                "id": r[0], "white": r[1], "black": r[2],
                "opening": r[3],
                "played_on": r[4].isoformat() if r[4] else None,
                "critical_moves": r[5],
            }
            for r in agg["practice_games"]
        ],
        "replay_limit": REPLAY_LIMIT,
        "overview": {
            "played": games,
            "wins": wins,
            "draws": draws,
            "losses": losses,
            "by_month": [{"label": r[0], "games": r[1]} for r in agg["by_month"]],
            "accuracy": replay.get("accuracy", {}),
            "accuracy_by_move": replay.get("accuracy_by_move", []),
            "by_opponent_rating": [
                {
                    "bucket": int(r[0]), "games": r[1], "wins": r[2],
                    "draws": r[3], "losses": r[1] - r[2] - r[3],
                }
                for r in agg["opponents"] if r[0] is not None
            ],
        },
        "results": _results_payload(agg["terminations"]),
        "phases": replay.get("phases", {}),
        "shapes": replay.get("shapes", {}),
        "openings": _openings_payload(agg["openings"]),
        "moves": {
            "quality": [
                {"cls": cls, "moves": n, "pct": round(100 * n / quality_total, 1)}
                for cls, n in sorted(
                    ((r[0], r[1]) for r in agg["quality"]),
                    key=lambda kv: CLASSIFICATIONS.index(kv[0])
                    if kv[0] in CLASSIFICATIONS else 99,
                )
            ],
            "quality_by_month": replay.get("quality_by_month", {}),
            "time_pressure": replay.get("time_pressure", {}),
            "pieces": replay.get("pieces", []),
            "castling": replay.get("castling", {}),
        },
        "calendar": {
            "time_of_day": [
                {
                    "slot": r[0], "games": r[1], "wins": r[2], "draws": r[3],
                    "losses": r[1] - r[2] - r[3],
                }
                for r in agg["time_of_day"]
            ],
            "day_of_week": [
                {
                    "day": DAY_LABELS[r[0]], "games": r[1], "wins": r[2],
                    "draws": r[3], "losses": r[1] - r[2] - r[3],
                }
                for r in agg["day_of_week"]
            ],
        },
    }


def _results_payload(rows: list) -> dict:
    out: dict[str, list[dict]] = {"win": [], "draw": [], "loss": []}
    for outcome, reason, games in rows:
        out[outcome].append({"reason": reason, "games": games})
    return {"won_by": out["win"], "drew_by": out["draw"], "lost_by": out["loss"]}


async def cached_insights(
    db: AsyncSession, user: User, filters: Filters, redis
) -> dict:
    """Insights is read-only and expensive; a short TTL absorbs page reloads."""
    key = filters.cache_key(user.id)
    try:
        hit = await redis.get(key)
        if hit:
            return json.loads(hit)
    except Exception:  # a cache outage must never take the page down
        log.warning("insights cache read failed", exc_info=True)

    payload = await build_insights(db, user, filters)

    try:
        await redis.setex(key, CACHE_TTL, json.dumps(payload))
    except Exception:
        log.warning("insights cache write failed", exc_info=True)
    return payload
