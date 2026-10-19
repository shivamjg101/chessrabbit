import { describe, expect, it } from "vitest";
import { parsePgn } from "@/lib/pgn";
import { mainlinePath } from "@/lib/moveTree";
import { parseStudyImport } from "@/lib/studyImport";

describe("study PGN import", () => {
  it("splits a Lichess-style export while keeping variations, comments and FEN", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 41";
    const chapters = parseStudyImport(
      `[Event "Opening plans"]\n[StudyName "Opening plans"]\n` +
      `[ChapterName "King's pawn"]\n[Orientation "black"]\n\n` +
      `1. e4 {claim the center} (1. d4 d5) e5 *\n\n` +
      `[Event "Opening plans: Endgame"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n` +
      `{a useful position} 41. e4 Kd7 *`
    );

    expect(chapters).toHaveLength(2);
    expect(chapters[0].name).toBe("King's pawn");
    expect(chapters[0].orientation).toBe("black");
    expect(chapters[0].pgn).toContain("(1. d4 d5)");
    expect(chapters[0].pgn).toContain("{claim the center}");
    expect(mainlinePath(parsePgn(chapters[0].pgn, chapters[0].starting_fen).tree)
      .map((node) => node.san)).toEqual(["e4", "e5"]);
    expect(chapters[1].starting_fen).toBe(fen);
    expect(chapters[1].pgn).toContain("{a useful position}");
  });

  it("accepts a single movetext and ignores tag-shaped lines inside comments", () => {
    expect(parseStudyImport("1. d4 d5 *")[0].name).toBe("Chapter 1");
    const chapters = parseStudyImport(
      `[Event "First"]\n\n{a note\n[Event "still a note"]\n} 1. e4 *\n` +
      `[Event "Second"]\n\n1. d4 *`
    );
    expect(chapters.map((chapter) => chapter.name)).toEqual(["First", "Second"]);
  });

  it("rejects an empty import", () => {
    expect(() => parseStudyImport(" \n ")).toThrow("Paste a PGN");
    expect(() => parseStudyImport('[Variant "Atomic"]\n\n1. e4 *'))
      .toThrow("Atomic variant");
  });
});
