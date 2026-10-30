import { describe, expect, it } from "vitest";
import { glyphSymbol, glyphText, isMoveNag, toggleGlyph } from "@/lib/nags";

describe("toggleGlyph", () => {
  it("keeps one move mark, and takes it off when chosen again", () => {
    let marks = toggleGlyph({}, 1);
    expect(marks.nag).toBe(1);
    marks = toggleGlyph(marks, 4);
    expect(marks.nag).toBe(4);
    marks = toggleGlyph(marks, 4);
    expect(marks.nag).toBeUndefined();
  });

  it("keeps one position assessment, replacing the last", () => {
    let marks = toggleGlyph({}, 16); // ±
    marks = toggleGlyph(marks, 10); // =
    expect(marks.nags).toEqual([10]);
  });

  it("stacks observations, ordered after the position glyph", () => {
    let marks = toggleGlyph({ nag: 1 }, 36); // initiative
    marks = toggleGlyph(marks, 40); // attack
    marks = toggleGlyph(marks, 14); // ⩲
    expect(marks.nag).toBe(1);
    expect(marks.nags).toEqual([14, 36, 40]);
    marks = toggleGlyph(marks, 36);
    expect(marks.nags).toEqual([14, 40]);
  });

  it("drops the list entirely once it is empty", () => {
    expect(toggleGlyph({ nags: [146] }, 146).nags).toBeUndefined();
  });
});

describe("symbols", () => {
  it("prints a known glyph by symbol and an unknown one as $n", () => {
    expect(glyphSymbol(16)).toBe("±");
    expect(glyphSymbol(142)).toBe("$142");
    expect(glyphText({ nag: 3, nags: [18] })).toBe("!! +−");
  });

  it("files only move assessments as move marks", () => {
    expect(isMoveNag(7)).toBe(true);
    expect(isMoveNag(22)).toBe(true);
    expect(isMoveNag(14)).toBe(false);
    expect(isMoveNag(146)).toBe(false);
  });
});
