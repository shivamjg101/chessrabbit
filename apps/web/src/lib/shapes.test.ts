import { describe, expect, it } from "vitest";
import { Shape, brushFor, joinComment, splitComment, toggleShape } from "@/lib/shapes";

const green = (from: string, to?: string): Shape => ({ from, to, brush: "green" });

describe("reading", () => {
  it("pulls arrows and circles out of the prose around them", () => {
    const { text, shapes } = splitComment("the plan [%csl Gd4][%cal Gd2d4,Rf6e4]");

    expect(text).toBe("the plan");
    expect(shapes).toEqual([
      { from: "d4", to: undefined, brush: "green" },
      { from: "d2", to: "d4", brush: "green" },
      { from: "f6", to: "e4", brush: "red" },
    ]);
  });

  it("comes back empty for a comment that has none", () => {
    expect(splitComment("just words")).toEqual({ text: "just words", shapes: [], commands: [] });
    expect(splitComment(undefined)).toEqual({ text: "", shapes: [], commands: [] });
  });

  // Every Chess.com game, and Lichess games exported with clocks, carry one of
  // these on each move. They are not prose, and showing them as comments
  // buried the move list in timestamps.
  it("hides clock and other commands from the prose but keeps them", () => {
    const { text, shapes, commands } = splitComment("good move [%clk 0:02:59.4] [%eval 0.25] [%cal Ge2e4]");
    expect(text).toBe("good move");
    expect(shapes).toEqual([{ from: "e2", to: "e4", brush: "green" }]);
    expect(commands).toEqual(["[%clk 0:02:59.4]", "[%eval 0.25]"]);
    expect(splitComment("[%clk 0:09:58.5]").text).toBe("");
  });

  it("puts the other commands back when a comment is rewritten", () => {
    const { shapes, commands } = splitComment("[%clk 0:02:59.4] [%cal Ge2e4]");
    expect(joinComment("new note", shapes, commands)).toBe("new note [%cal Ge2e4] [%clk 0:02:59.4]");
    expect(joinComment("", [], commands)).toBe("[%clk 0:02:59.4]");
  });

  it("leaves no blank comment behind when the shapes were all of it", () => {
    expect(splitComment("[%cal Ge2e4]").text).toBe("");
  });

  it("keeps the prose on both sides of a command", () => {
    expect(splitComment("before [%cal Ge2e4] after").text).toBe("before after");
  });

  // Somebody else's file, or ours after a bad edit: one broken item should
  // cost that item and nothing else.
  it("drops malformed items and keeps the rest", () => {
    const { shapes } = splitComment("[%cal Ge2e4,Xz9z9,Rd2d4,Ge2e2,Gabc]");
    expect(shapes).toEqual([
      { from: "e2", to: "e4", brush: "green" },
      { from: "d2", to: "d4", brush: "red" },
    ]);
  });

  it("reads a square command as a circle, not a zero-length arrow", () => {
    const { shapes } = splitComment("[%csl Ye4]");
    expect(shapes).toEqual([{ from: "e4", to: undefined, brush: "yellow" }]);
  });
});

describe("writing", () => {
  it("writes circles and arrows in their own commands", () => {
    const out = joinComment("watch d5", [green("d5"), { from: "c4", to: "d5", brush: "blue" }]);
    expect(out).toBe("watch d5 [%csl Gd5] [%cal Bc4d5]");
  });

  it("is undefined when there is nothing to say and nothing to draw", () => {
    expect(joinComment("", [])).toBeUndefined();
    expect(joinComment("   ", [])).toBeUndefined();
  });

  it("writes shapes with no prose", () => {
    expect(joinComment("", [green("e2", "e4")])).toBe("[%cal Ge2e4]");
  });

  it("round-trips", () => {
    const shapes: Shape[] = [
      { from: "e4", to: undefined, brush: "yellow" },
      { from: "g1", to: "f3", brush: "green" },
      { from: "d8", to: "h4", brush: "red" },
    ];
    const back = splitComment(joinComment("a note", shapes));
    expect(back.text).toBe("a note");
    expect(back.shapes).toEqual(shapes);
  });
});

describe("drawing", () => {
  it("adds a shape that is not there", () => {
    expect(toggleShape([], green("e2", "e4"))).toEqual([green("e2", "e4")]);
  });

  it("removes the one already drawn in that colour", () => {
    expect(toggleShape([green("e2", "e4")], green("e2", "e4"))).toEqual([]);
  });

  it("recolours rather than stacking a second arrow on the same squares", () => {
    const out = toggleShape([green("e2", "e4")], { from: "e2", to: "e4", brush: "red" });
    expect(out).toEqual([{ from: "e2", to: "e4", brush: "red" }]);
  });

  // A ring around e4 and an arrow leaving e4 are different marks about the
  // same square, and drawing one must not erase the other.
  it("treats a circle and an arrow from the same square as separate", () => {
    const out = toggleShape([green("e4")], green("e4", "e5"));
    expect(out).toEqual([green("e4"), green("e4", "e5")]);
  });

  it("picks a brush from the modifier held", () => {
    const mods = (o: Partial<Record<"shiftKey" | "altKey" | "ctrlKey", boolean>>) =>
      brushFor({ shiftKey: false, altKey: false, ctrlKey: false, ...o });

    expect(mods({})).toBe("green");
    expect(mods({ shiftKey: true })).toBe("red");
    expect(mods({ altKey: true })).toBe("blue");
    expect(mods({ ctrlKey: true })).toBe("yellow");
  });
});
