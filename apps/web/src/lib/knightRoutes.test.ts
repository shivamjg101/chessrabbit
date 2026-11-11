import { describe, expect, it } from "vitest";
import { knightDistance, knightMoves, nextRoute } from "@/lib/knightRoutes";

describe("knight routes", () => {
  it("knows where a knight can jump", () => {
    expect(knightMoves("a1").sort()).toEqual(["b3", "c2"]);
    expect(knightMoves("d4")).toHaveLength(8);
    expect(knightMoves("h8").sort()).toEqual(["f7", "g6"]);
  });

  it("finds the shortest route", () => {
    expect(knightDistance("e4", "e4")).toBe(0);
    expect(knightDistance("g1", "f3")).toBe(1);
    expect(knightDistance("a1", "b2")).toBe(4);
    expect(knightDistance("a1", "h8")).toBe(6);
    expect(knightDistance("b1", "d2")).toBe(1);
    expect(knightDistance("e4", "e5")).toBe(3);
  });

  it("deals routes of two to four moves that are exact", () => {
    for (let i = 0; i < 200; i++) {
      const r = nextRoute();
      expect(r.moves).toBeGreaterThanOrEqual(2);
      expect(r.moves).toBeLessThanOrEqual(4);
      expect(knightDistance(r.from, r.to)).toBe(r.moves);
    }
  });
});
