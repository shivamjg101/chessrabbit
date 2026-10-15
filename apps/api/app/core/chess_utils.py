"""Chess helpers shared by API routers. Mirrors logic in services/engine."""

from __future__ import annotations

import io
import re

import chess
import chess.pgn
import chess.polyglot

from app.core.openings import MAX_NAME, name_from_eco_url

MAX_INDEXED_PLY = 40  # BLUEPRINT 7.4: cap position index size


def zobrist_of(fen: str) -> int:
    """Polyglot zobrist as a SIGNED 64-bit int (Postgres BIGINT compatible)."""
    board = chess.Board(fen)
    unsigned = chess.polyglot.zobrist_hash(board)
    return unsigned - (1 << 64) if unsigned >= (1 << 63) else unsigned


def validate_fen(fen: str) -> chess.Board:
    """Raise ValueError if the FEN is malformed or the position is illegal."""
    board = chess.Board(fen)  # raises ValueError on bad FEN
    if not board.is_valid():
        raise ValueError("Position is not legal")
    return board


def _normalize_headers(pgn_text: str) -> str:
    """Repair PGNs pasted from web pages where header tags lost their
    newlines: [White "A"] [Black "B"] -> one tag per line, per the spec.
    The pattern only matches directly-adjacent tag brackets, so movetext
    comments like {[%clk 0:03]} are untouched."""
    return re.sub(r'\]\s*\[', ']\n[', pgn_text)


def opening_of(headers) -> str | None:
    """
    The opening name a PGN claims, from wherever it put it.

    Lichess sets `Opening`. Chess.com sets `ECOUrl` and no name at all, so
    reading only the header left every Chess.com game nameless. We store just
    what the PGN asserts - a name guessed from the ECO code alone belongs at
    display time (`app.core.openings.opening_label`), not in the games table.
    """
    name = (headers.get("Opening") or "").strip()
    if name and name != "?":
        return name[:MAX_NAME]
    return name_from_eco_url(headers.get("ECOUrl"))


def classify_time_control(tc: str | None) -> str:
    """
    Bucket a PGN TimeControl into the class players actually think in.

    Uses the standard base + 40 x increment estimate of a game's length, and
    the same cutoffs Lichess and Chess.com use, so a "blitz" game here is the
    same game they would call blitz.
    """
    if not tc or tc in ("-", "?"):
        return "unknown"
    if "/" in tc:  # "1/86400" - moves per day, i.e. correspondence
        return "correspondence"
    try:
        base, _, inc = tc.partition("+")
        estimate = int(float(base)) + 40 * int(float(inc or 0))
    except ValueError:
        return "unknown"
    if estimate < 179:
        return "bullet"
    if estimate < 479:
        return "blitz"
    if estimate < 1499:
        return "rapid"
    return "classical"


# Substring -> normalised reason. Ordered: the first match wins, so the more
# specific phrases have to come before the words they contain.
_TERMINATION_PATTERNS: tuple[tuple[str, str], ...] = (
    ("checkmate", "checkmate"),
    ("won on time", "timeout"),
    ("time forfeit", "timeout"),
    ("timeout", "timeout"),
    ("resign", "resignation"),
    ("abandon", "abandoned"),
    ("agreement", "agreement"),
    ("agreed", "agreement"),
    ("stalemate", "stalemate"),
    ("repetition", "repetition"),
    ("insufficient", "insufficient"),
    ("50-move", "fifty_move"),
    ("fifty", "fifty_move"),
)


def classify_termination(raw: str | None, result: str) -> str | None:
    """
    Normalise the free-text Termination header into a fixed vocabulary.

    Platforms phrase this differently ("Normal", "hikaru won by resignation",
    "Time forfeit"), so we match on substrings. "Normal" carries no reason at
    all - a decisive Normal game is a resignation in practice, a drawn one an
    agreement, which is how both platforms use the tag.
    """
    if not raw:
        return None
    text = raw.lower()
    for needle, reason in _TERMINATION_PATTERNS:
        if needle in text:
            return reason
    if "normal" in text:
        return "agreement" if result == "1/2-1/2" else "resignation"
    return "other"


def _safe_datetime(day: str | None, clock: str | None):
    """Combine PGN date + time headers into an aware UTC datetime, or None."""
    if not day or not clock:
        return None
    from datetime import datetime, timezone

    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            return datetime.strptime(f"{day} {clock}", fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_pgn(pgn_text: str) -> list[dict]:
    """
    Parse one or more games from PGN text into dicts ready for insertion.
    Returns [] rather than raising on unparseable input.
    """
    games: list[dict] = []
    stream = io.StringIO(_normalize_headers(pgn_text))

    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception:
            break
        if game is None:
            break

        headers = game.headers
        board = game.board()
        if game.errors or type(board) is not chess.Board or not board.is_valid():
            continue  # unsupported variants and malformed move lists
        variant = "chess960" if board.chess960 else "standard"
        moves = list(game.mainline_moves())

        # python-chess yields an empty Game object for junk input rather than
        # None. A real game has at least one move; anything else is not a game.
        if not moves:
            continue

        exporter = chess.pgn.StringExporter(headers=False, variations=True, comments=True)
        movetext = game.accept(exporter).strip()

        result = _safe_result(headers.get("Result", "*"))
        time_control = headers.get("TimeControl") or None

        # Lichess tags the true kickoff as UTCDate/UTCTime; Chess.com uses
        # UTCDate + StartTime. Fall back to the local Date/Time pair.
        played_at = _safe_datetime(
            headers.get("UTCDate") or headers.get("Date"),
            headers.get("UTCTime") or headers.get("StartTime") or headers.get("Time"),
        )

        games.append(
            {
                "white": headers.get("White", "")[:200],
                "black": headers.get("Black", "")[:200],
                "white_elo": _safe_int(headers.get("WhiteElo")),
                "black_elo": _safe_int(headers.get("BlackElo")),
                "result": result,
                "event": headers.get("Event", "")[:300],
                "site": headers.get("Site", "")[:300],
                "played_on": _safe_date(headers.get("UTCDate") or headers.get("Date")),
                "played_at": played_at,
                "eco": (headers.get("ECO") or None),
                "opening": opening_of(headers),
                "time_control": time_control[:40] if time_control else None,
                "time_class": classify_time_control(time_control),
                "termination": classify_termination(headers.get("Termination"), result),
                "ply_count": len(moves),
                "movetext": movetext,
                "variant": variant,
                "start_fen": board.fen(shredder=True) if variant == "chess960"
                else (board.fen() if board.fen() != chess.STARTING_FEN else None),
            }
        )

    return games


def game_from_movetext(
    movetext: str, variant: str = "standard", start_fen: str | None = None,
) -> chess.pgn.Game:
    headers = []
    if variant == "chess960":
        headers.append('[Variant "Chess960"]')
    if start_fen:
        headers.extend(['[SetUp "1"]', f'[FEN "{start_fen}"]'])
    text = "\n".join(headers) + "\n\n" + movetext if headers else movetext
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None or game.errors:
        raise ValueError("Invalid stored game moves")
    return game


def positions_of_game(
    movetext: str, max_ply: int = MAX_INDEXED_PLY,
    variant: str = "standard", start_fen: str | None = None,
) -> list[tuple[int, int, str]]:
    """
    Replay a game and return (ply, zobrist, move_uci) for the position index.
    The zobrist is of the position BEFORE the move is played.
    """
    if variant == "chess960":
        return []  # Polyglot/opening indexes assume standard castling rights.
    out: list[tuple[int, int, str]] = []
    game = game_from_movetext(movetext, variant, start_fen)

    board = game.board()
    for ply, move in enumerate(game.mainline_moves()):
        if ply >= max_ply:
            break
        out.append((ply, zobrist_of(board.fen()), move.uci()))
        board.push(move)
    return out


def extract_repertoire(pgn_text: str, color: str) -> list[dict]:
    """
    Walk a PGN (variations included) and produce training cards for one color.

    Semantics of a repertoire:
    - At OUR turn, the FIRST variation is the repertoire move -> one card.
      Sidelines for our own color are ignored (a repertoire is one choice).
    - At the OPPONENT's turn, EVERY variation is a reply we must be ready
      for, so all branches are expanded.
    - Transpositions dedupe on zobrist: one card per position.

    Returns [{fen, zobrist, expected_uci, expected_san}, ...]
    """
    want_white = color == "white"
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        return []

    cards: dict[int, dict] = {}

    def walk(node: chess.pgn.GameNode, board: chess.Board) -> None:
        our_turn = board.turn == (chess.WHITE if want_white else chess.BLACK)
        variations = node.variations
        if not variations:
            return

        if our_turn:
            child = variations[0]  # the repertoire's chosen move
            key = zobrist_of(board.fen())
            if key not in cards:
                cards[key] = {
                    "fen": board.fen(),
                    "zobrist": key,
                    "expected_uci": child.move.uci(),
                    "expected_san": board.san(child.move),
                }
            board.push(child.move)
            walk(child, board)
            board.pop()
        else:
            for child in variations:  # every opponent reply we cover
                board.push(child.move)
                walk(child, board)
                board.pop()

    walk(game, game.board())
    return list(cards.values())


def _safe_int(value) -> int | None:
    try:
        n = int(value)
        return n if 0 < n < 4000 else None
    except (TypeError, ValueError):
        return None


def _safe_result(value: str) -> str:
    return value if value in {"1-0", "0-1", "1/2-1/2", "*"} else "*"


def _safe_date(value):
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return None
    try:
        y, m, d = (int(p) for p in parts)
        if y < 1475 or not (1 <= m <= 12) or not (1 <= d <= 31):
            return None
        from datetime import date
        return date(y, m, d)
    except ValueError:
        return None
