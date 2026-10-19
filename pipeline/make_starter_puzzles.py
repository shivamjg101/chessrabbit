"""Create the small desktop starter set from a local Lichess puzzle .csv.zst.

Install chess and zstandard first, then run:
    python pipeline/make_starter_puzzles.py lichess_db_puzzle.csv.zst

The source may be a prefix of the export if it contains enough eligible rows.
"""

from __future__ import annotations

import csv
import gzip
import io
import sys
from pathlib import Path

import chess
import zstandard

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "apps/desktop/assets/starter-puzzles.csv.gz"
FIELDS = (
    "PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity",
    "NbPlays", "Themes", "GameUrl", "OpeningTags",
)
PER_BAND = 200


def valid_line(fen: str, moves: str) -> bool:
    try:
        board = chess.Board(fen)
        line = moves.split()
        if len(line) < 2:
            return False
        for text in line:
            move = chess.Move.from_uci(text)
            if move not in board.legal_moves:
                return False
            board.push(move)
        return True
    except ValueError:
        return False


def main(source: Path) -> None:
    counts = [0] * 6
    selected = []
    seen_ids = set()
    with source.open("rb") as compressed:
        with zstandard.ZstdDecompressor().stream_reader(compressed) as reader:
            rows = csv.DictReader(io.TextIOWrapper(reader, encoding="utf-8"))
            for row in rows:
                rating = int(row["Rating"])
                if not 600 <= rating <= 2400:
                    continue
                band = min(5, (rating - 600) // 300)
                if not (0 <= band < 6) or counts[band] == PER_BAND:
                    continue
                if int(row["Popularity"]) < 70 or int(row["NbPlays"]) < 30:
                    continue
                if row["PuzzleId"] in seen_ids:
                    continue
                if not valid_line(row["FEN"], row["Moves"]):
                    continue
                selected.append({field: row[field] for field in FIELDS})
                seen_ids.add(row["PuzzleId"])
                counts[band] += 1
                if all(count == PER_BAND for count in counts):
                    break

    if any(count != PER_BAND for count in counts):
        raise RuntimeError(f"Not enough valid puzzles: {counts}")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(selected)
    TARGET.write_bytes(gzip.compress(output.getvalue().encode("utf-8"), compresslevel=9, mtime=0))
    print(f"Wrote {len(selected)} puzzles to {TARGET}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Pass the Lichess puzzle .csv.zst file")
    main(Path(sys.argv[1]))
