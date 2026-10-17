from app.core.chess_utils import extract_repertoire
from app.routers.training import _repertoire_from_games


def test_own_games_become_one_move_and_common_opponent_branches():
    pgn = _repertoire_from_games([
        "1. e4 e5 2. Nf3 Nc6 *",
        "1. e4 c5 2. Nc3 d6 *",
        "1. e4 e5 2. Bc4 Nc6 *",
    ], "white")
    cards = extract_repertoire(pgn, "white")
    assert {card["expected_san"] for card in cards} == {"e4", "Nf3", "Nc3"}
    assert len(cards) == 3
