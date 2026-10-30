"""
Reading a pasted PGN file into games: set-up positions, variants, broken
moves, and files whose games are not separated the way the spec asks.
"""

import io

import chess
import chess.pgn

from app.core.chess_utils import (
    ParseReport,
    mainline_uci,
    parse_pgn,
    positions_of_game,
    split_setup,
)
from app.routers.games import game_pgn
from app.routers.reports import performance

ENDGAME = """[Event "Study"]
[White "A"]
[Black "B"]
[Result "1-0"]
[SetUp "1"]
[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]

1. Kd2 Kd4 2. e3+ Ke4 3. Ke2 1-0
"""

CLUB = """[Event "Club"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
"""


class TestSetUpPositions:
    def test_the_start_position_travels_with_the_moves(self):
        (game,) = parse_pgn(ENDGAME)
        tags, moves = split_setup(game["movetext"])
        assert tags == ['[SetUp "1"]', '[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]']
        assert moves.startswith("1. Kd2")
        assert game["ply_count"] == 5

    def test_the_position_index_replays_from_that_position(self):
        (game,) = parse_pgn(ENDGAME)
        positions = positions_of_game(game["movetext"])
        assert [uci for _, _, uci in positions] == ["e1d2", "e5d4", "e2e3", "d4e4", "d2e2"]

    def test_an_export_is_one_tag_section_that_replays(self):
        (game,) = parse_pgn(ENDGAME)
        row = type("Row", (), {
            "event": "Study", "site": "", "played_on": None, "white": "A", "black": "B",
            "result": "1-0", "white_elo": None, "black_elo": None, "eco": None,
            "opening": None, "time_control": None, "movetext": game["movetext"],
        })()
        exported = chess.pgn.read_game(io.StringIO(game_pgn(row)))
        assert exported.headers["White"] == "A"
        assert exported.board().fen() == "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"
        assert len(list(exported.mainline_moves())) == 5
        assert not exported.errors

    def test_a_standard_game_carries_no_setup_tags(self):
        (game,) = parse_pgn(CLUB)
        assert split_setup(game["movetext"]) == ([], game["movetext"])


class TestRefusedAndDamagedGames:
    def test_a_variant_is_refused_and_said_so(self):
        report = ParseReport()
        games = parse_pgn(CLUB.replace('[Result', '[Variant "Atomic"]\n[Result'), report)
        assert games == []
        assert report.refused == 1
        assert "Atomic is not supported" in report.notes[0]

    def test_from_position_is_standard_chess(self):
        report = ParseReport()
        text = ENDGAME.replace("[SetUp", '[Variant "From Position"]\n[SetUp')
        assert len(parse_pgn(text, report)) == 1
        assert report.refused == 0

    def test_an_illegal_move_keeps_what_came_before_and_says_where(self):
        report = ParseReport()
        # Well-formed but illegal: the d7 pawn is in the queen's way.
        (game,) = parse_pgn(CLUB.replace("3. Bb5 a6", "3. Bb5 Qd5"), report)
        assert game["ply_count"] == 5
        assert report.notes == ["Game 1 (Alice – Bob): unreadable move at 3...; the moves before it were kept"]


class TestFilesWithoutBlankLines:
    def test_the_next_games_tags_are_not_read_as_moves(self):
        report = ParseReport()
        text = CLUB + CLUB.replace("Club", "Club2").replace("Alice", "Carol")
        assert "\n\n[Event" not in text  # the case under test
        games = parse_pgn(text, report)
        assert [g["white"] for g in games] == ["Alice", "Carol"]
        assert [g["event"] for g in games] == ["Club", "Club2"]
        assert report.notes == []

    def test_a_clock_comment_on_its_own_line_is_not_a_tag(self):
        text = CLUB.replace("1. e4 e5", "1. e4 {\n[%clk 0:03:00]} e5")
        (game,) = parse_pgn(text)
        assert game["ply_count"] == 6


class TestSameGame:
    def test_comments_do_not_make_a_different_game(self):
        (plain,) = parse_pgn(CLUB)
        (noted,) = parse_pgn(CLUB.replace("1. e4", "1. e4 {best by test}"))
        assert mainline_uci(plain["movetext"]) == mainline_uci(noted["movetext"])

    def test_a_different_start_is_a_different_game(self):
        (game,) = parse_pgn(ENDGAME)
        assert mainline_uci(game["movetext"])[0] == "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"


class TestPerformance:
    def test_an_even_score_is_the_average_rating(self):
        assert performance([2000, 2200], 1.0) == 2100

    def test_a_perfect_score_is_capped(self):
        assert performance([2000], 1.0) == 2800
        assert performance([2000], 0.0) == 1200

    def test_three_quarters_is_about_plus_191(self):
        assert performance([2000] * 4, 3.0) == 2191

    def test_no_rated_opponents_has_no_performance(self):
        assert performance([], 0.0) is None
