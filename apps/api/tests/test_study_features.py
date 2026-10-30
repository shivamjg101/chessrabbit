"""Chapter tags and modes, the study export, game export and the tablebase route."""

from datetime import date

import chess
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models import Game, StudyChapter
from app.routers.games import SORTS, game_pgn
from app.routers.studies import START_FEN, chapter_pgn
from app.routers.tablebase import _local, piece_count, tablebase
from app.schemas import ChapterCreate, ChapterUpdate, GameUpdate, StudyUpdate
from app.services.tablebase import cache_key


# ---------- schemas ----------

def test_chapter_tags_drop_derived_and_refuse_malformed_names():
    c = ChapterCreate(name="x", tags={"White": "  Anna  Ushenina ", "FEN": "8/8", "SetUp": "1"})
    assert c.tags == {"White": "Anna Ushenina"}
    with pytest.raises(ValidationError):
        ChapterCreate(name="x", tags={"bad key": "v"})
    with pytest.raises(ValidationError):
        ChapterUpdate(tags={"Event": "e" * 300})


def test_chapter_mode_is_one_of_three():
    assert ChapterCreate(name="x").mode == "normal"
    assert ChapterUpdate(mode="lesson").mode == "lesson"
    with pytest.raises(ValidationError):
        ChapterCreate(name="x", mode="gamebook")


def test_topics_are_trimmed_and_deduplicated_case_insensitively():
    s = StudyUpdate(topics=["  Sicilian   Defense", "sicilian defense", "Endgames", ""])
    assert s.topics == ["Sicilian Defense", "Endgames"]
    with pytest.raises(ValidationError):
        StudyUpdate(topics=[f"t{i}" for i in range(13)])


def test_game_headers_are_validated():
    assert GameUpdate(result="1/2-1/2", eco="b90").eco == "b90"
    assert GameUpdate(eco="").eco == ""
    with pytest.raises(ValidationError):
        GameUpdate(result="2-0")
    with pytest.raises(ValidationError):
        GameUpdate(eco="Z99")


# ---------- study export ----------

def _chapter(**kw) -> StudyChapter:
    base = dict(
        name="Main line", description=None, pgn="1. e4 e5", starting_fen=START_FEN,
        orientation="white", mode="normal", hide_engine=False, tags={},
    )
    base.update(kw)
    return StudyChapter(**base)


def test_export_fills_the_roster_from_chapter_tags():
    out = chapter_pgn("Ruy", _chapter(tags={"White": "Carlsen", "Black": 'The "Hulk"', "Result": "1-0"}))
    assert '[White "Carlsen"]' in out
    assert '[Black "The \\"Hulk\\""]' in out
    assert '[Event "Ruy: Main line"]' in out
    # The movetext ends with the result its tags claim.
    assert out.rstrip().endswith("1. e4 e5 1-0")


def test_export_derives_position_orientation_and_mode_from_the_row():
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    out = chapter_pgn(
        "S",
        _chapter(
            starting_fen=fen, orientation="black", mode="lesson",
            tags={"FEN": "stale", "SetUp": "0"}, description="Find {the} plan",
        ),
    )
    assert f'[FEN "{fen}"]' in out and '[SetUp "1"]' in out
    assert "stale" not in out
    assert '[Orientation "black"]' in out
    assert '[ChapterMode "lesson"]' in out
    # Prose goes first as a comment, with braces it cannot contain softened.
    assert "{Find {the) plan}" in out


def test_export_keeps_a_result_already_in_the_movetext():
    out = chapter_pgn("S", _chapter(pgn="1. e4 e5 0-1"))
    assert out.rstrip().endswith("0-1")
    assert "0-1 *" not in out


# ---------- game export ----------

def test_game_pgn_escapes_tag_values():
    g = Game(
        white='O"Kelly', black="B", result="1-0", event="", site="", movetext="1. e4 e5",
        played_on=date(2024, 5, 1), white_elo=2700, black_elo=None, eco="C20",
        opening="King's Pawn", time_control=None,
    )
    out = game_pgn(g)
    assert '[White "O\\"Kelly"]' in out
    assert '[Date "2024.05.01"]' in out
    assert '[Opening "King\'s Pawn"]' in out
    assert out.rstrip().endswith("1-0")


def test_game_sorts_are_a_whitelist_of_columns():
    assert {"added", "date", "white", "black", "eco", "moves"} <= SORTS.keys()
    assert all(k.replace("_", "").isalpha() for k in SORTS)


# ---------- tablebase ----------

def test_tablebase_cache_key_keeps_the_halfmove_clock():
    a = cache_key("8/8/8/4k3/8/8/4P3/4K3 w - - 0 1")
    b = cache_key("8/8/8/4k3/8/8/4P3/4K3 w - - 80 1")
    c = cache_key("8/8/8/4k3/8/8/4P3/4K3 w - - 0 57")
    assert a != b and a == c


@pytest.mark.asyncio
async def test_tablebase_refuses_eight_pieces_and_answers_bare_kings_by_rule():
    with pytest.raises(HTTPException) as exc:
        await tablebase(fen=chess.STARTING_FEN, user=None)
    assert exc.value.status_code == 400
    res = await tablebase(fen="8/8/8/4k3/8/8/8/4K3 w - - 0 1", user=None)
    assert res.source == "rules" and res.category == "draw"


class _FakeTables:
    """The root is a win; after promoting it is lost for Black; anything else draws."""

    def probe_wdl(self, board):
        if not board.move_stack:
            return 2
        return -2 if board.peek().uci() == "e7e8q" else 0

    def probe_dtz(self, board):
        return 3


def test_local_tables_rate_every_legal_move():
    board = chess.Board("8/4P3/8/8/8/8/k7/4K3 w - - 0 1")
    out = _local(board, _FakeTables())
    assert out is not None and out.source == "syzygy" and out.category == "win"
    assert piece_count(board) == 3
    promo = next(m for m in out.moves if m.uci == "e7e8q")
    # Category is for the side to move after the move: a loss for them.
    assert promo.category == "loss" and promo.zeroing
    assert len(out.moves) == board.legal_moves.count()


def test_local_tables_missing_a_table_fall_through():
    class Missing:
        def probe_wdl(self, board):
            raise KeyError("no table")

        probe_dtz = probe_wdl

    assert _local(chess.Board("8/4P3/8/8/8/8/k7/4K3 w - - 0 1"), Missing()) is None


def test_public_listing_is_declared_before_the_slug_route():
    from app.routers.studies import router

    paths = [r.path for r in router.routes]
    assert paths.index("/studies/public") < paths.index("/studies/{ref}")


def test_clone_and_like_are_routed():
    from app.main import app

    paths = app.openapi()["paths"]
    assert "post" in paths["/studies/{ref}/clone"]
    assert {"post", "delete"} <= paths["/studies/{ref}/like"].keys()
    assert "post" in paths["/studies/{ref}/chapters/import"]
