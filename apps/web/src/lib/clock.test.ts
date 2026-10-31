import { describe, expect, it } from "vitest";
import {
  clockOf,
  clocksAt,
  formatClock,
  formatSpent,
  lowClockMark,
  moveTimes,
  parseTimeControl,
  sideClocks,
  sideOf,
  timeControlLabel,
} from "@/lib/clock";

describe("reading a clock", () => {
  it("reads Lichess and Chess.com clock commands", () => {
    expect(clockOf("[%clk 0:02:59]")).toBe(179);
    expect(clockOf("[%clk 0:09:58.5]")).toBe(598.5);
    expect(clockOf("nice [%clk 1:00:00] [%eval 0.3]")).toBe(3600);
  });

  it("is null without a reading", () => {
    expect(clockOf(undefined)).toBeNull();
    expect(clockOf("just a comment")).toBeNull();
    expect(clockOf("[%emt 0:00:03]")).toBeNull();
  });
});

describe("time controls", () => {
  it("parses base and increment", () => {
    expect(parseTimeControl("180+2")).toEqual({ base: 180, increment: 2 });
    expect(parseTimeControl("600")).toEqual({ base: 600, increment: 0 });
    expect(parseTimeControl(" 60+0 ")).toEqual({ base: 60, increment: 0 });
  });

  it("has nothing for untimed, unknown or correspondence games", () => {
    expect(parseTimeControl("-")).toBeNull();
    expect(parseTimeControl("?")).toBeNull();
    expect(parseTimeControl("1/259200")).toBeNull();
    expect(parseTimeControl(null)).toBeNull();
    expect(parseTimeControl("0")).toBeNull();
  });

  it("labels them the way players say them", () => {
    expect(timeControlLabel({ base: 180, increment: 2 })).toBe("3+2");
    expect(timeControlLabel({ base: 600, increment: 0 })).toBe("10 min");
    expect(timeControlLabel({ base: 30, increment: 1 })).toBe("1/2+1");
  });
});

describe("move times", () => {
  const tc = { base: 180, increment: 2 };

  it("measures each move from the same player's previous reading", () => {
    // White: 180 -> 177 (took 5s with +2), Black: 180 -> 180 (took 2s), then
    // White 177 -> 160 (took 19s), Black 180 -> 150 (took 32s).
    expect(moveTimes([177, 180, 160, 150], tc)).toEqual([5, 2, 19, 32]);
  });

  it("cannot measure first moves without the starting time", () => {
    expect(moveTimes([177, 180, 160, 150], null)).toEqual([null, null, 17, 30]);
  });

  it("skips moves next to a missing reading and never goes negative", () => {
    expect(moveTimes([177, null, 160, 150], tc)).toEqual([5, null, 19, null]);
    expect(moveTimes([182, 182], tc)).toEqual([0, 0]);
  });
});

describe("per-side summary", () => {
  it("totals each side, finds the longest think and the first low clock", () => {
    const tc = { base: 180, increment: 0 };
    const clocks = [170, 175, 100, 170, 15, 160, 12, 150];
    const times = moveTimes(clocks, tc);
    const sides = sideClocks(clocks, times, tc);
    expect(sides.white.measured).toBe(4);
    expect(sides.white.total).toBe(168);
    expect(sides.white.longest).toEqual({ index: 4, seconds: 85 });
    expect(sides.white.lowFrom).toBe(4);
    // 5, 5, 10, 10: the first of two equal thinks counts.
    expect(sides.black.longest).toEqual({ index: 5, seconds: 10 });
    expect(sides.black.lowFrom).toBeNull();
  });

  it("starts with Black in a position set up for Black to move", () => {
    expect(sideOf(0, "black")).toBe("black");
    expect(sideOf(1, "black")).toBe("white");
  });

  it("calls a tenth of the starting time low, but never under ten seconds", () => {
    expect(lowClockMark({ base: 600, increment: 0 })).toBe(60);
    expect(lowClockMark({ base: 60, increment: 1 })).toBe(10);
    expect(lowClockMark(null)).toBe(30);
  });
});

describe("clocks at a position", () => {
  const tc = { base: 180, increment: 0 };
  const clocks = [170, 175, 100, 170];

  it("shows each side's latest reading", () => {
    expect(clocksAt(clocks, 3, tc)).toEqual({ white: 100, black: 175 });
    expect(clocksAt(clocks, 4, tc)).toEqual({ white: 100, black: 170 });
  });

  it("shows the starting time before a side has moved", () => {
    expect(clocksAt(clocks, 0, tc)).toEqual({ white: 180, black: 180 });
    expect(clocksAt(clocks, 1, tc)).toEqual({ white: 170, black: 180 });
    expect(clocksAt(clocks, 1, null)).toEqual({ white: 170, black: null });
  });
});

describe("formatting", () => {
  it("formats a clock face", () => {
    expect(formatClock(179)).toBe("2:59");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(7.44)).toBe("0:07.4");
    expect(formatClock(-3)).toBe("0:00.0");
  });

  it("formats a move's duration", () => {
    expect(formatSpent(0.4)).toBe("0.4s");
    expect(formatSpent(12.3)).toBe("12s");
    expect(formatSpent(102)).toBe("1:42");
  });
});
