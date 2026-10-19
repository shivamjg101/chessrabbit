from pathlib import Path
import sys

import chess

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import _mistake_card_rows, _personal_puzzle_rows  # noqa: E402


def test_mistakes_become_legal_cards_and_repeat_positions_are_deduplicated():
    start = chess.Board().fen()
    rows = _mistake_card_rows([
        {"ply": 0, "classification": "mistake", "best_uci": "e2e4"},
        {"ply": 1, "classification": "blunder", "best_uci": "e2e4"},
        {"ply": 0, "classification": "mistake", "best_uci": "d2d4"},
        {"ply": 0, "classification": "inaccuracy", "best_uci": "g1f3"},
    ], [start, start])
    assert len(rows) == 1
    assert rows[0]["expected_san"] == "e4"
    assert rows[0]["color"] == "white"


def test_private_puzzle_requires_a_legal_three_ply_solution():
    board = chess.Board()
    first = chess.Move.from_uci("e2e4")
    board.push(first)
    rows = _personal_puzzle_rows(
        7, [{"ply": 0, "classification": "blunder"}], [first],
        [chess.Board().fen(), board.fen()],
        [{}, {"pv": ["e7e5", "g1f3", "b8c6"]}],
    )
    assert rows[0]["moves"] == "e2e4 e7e5 g1f3 b8c6"
    assert rows[0]["lichess_id"] == "personal-7-0"
    assert _personal_puzzle_rows(
        7, [{"ply": 0, "classification": "blunder"}], [first],
        [chess.Board().fen(), board.fen()], [{}, {"pv": ["e7e5", "g1f3"]}],
    ) == []
