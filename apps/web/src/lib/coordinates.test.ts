import { describe, expect, it } from "vitest";
import { SQUARES, nextTarget } from "@/lib/coordinates";

describe("coordinates drill", () => {
  it("covers the whole board once", () => {
    expect(SQUARES).toHaveLength(64);
    expect(new Set(SQUARES).size).toBe(64);
    expect(SQUARES).toContain("a1");
    expect(SQUARES).toContain("h8");
  });

  it("never asks for the same square twice in a row", () => {
    // A random source that always lands on the first square in the pool.
    expect(nextTarget("a1", () => 0)).not.toBe("a1");
    expect(nextTarget(null, () => 0)).toBe("a1");
    for (let i = 0; i < 200; i++) {
      const previous = SQUARES[i % 64];
      expect(nextTarget(previous)).not.toBe(previous);
    }
  });

  it("stays on the board for a random value at the top of the range", () => {
    expect(SQUARES).toContain(nextTarget("h8", () => 0.9999999));
  });
});
