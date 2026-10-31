/**
 * Clock readings in a game's comments, and what they say about time use.
 *
 * Lichess and Chess.com write the mover's remaining time after every move as a
 * `[%clk 0:02:59.4]` command inside that move's comment. That is everything a
 * PGN knows about time: how long a move took is worked out from two readings
 * of the same player's clock and the increment added between them.
 */

const CLK = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;

/** Seconds left on the mover's clock after this move, or null without a reading. */
export function clockOf(comment?: string): number | null {
  const m = comment?.match(CLK);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export interface TimeControl {
  /** Starting time, in seconds. */
  base: number;
  /** Seconds added after each move. */
  increment: number;
}

/**
 * A PGN TimeControl tag such as "180+2" or "600". Correspondence ("1/259200"),
 * untimed ("-") and unknown ("?") games have no clock worth analysing.
 */
export function parseTimeControl(tag?: string | null): TimeControl | null {
  const m = tag?.trim().match(/^(\d+)(?:\+(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const base = Number(m[1]);
  return base > 0 ? { base, increment: Number(m[2] ?? 0) } : null;
}

/** "3+2" for 180+2, "10 min" for 600, "1/2+1" for 30+1. */
export function timeControlLabel(tc: TimeControl): string {
  const minutes = tc.base / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes === 0.5 ? "1/2" : minutes.toFixed(1);
  return tc.increment ? `${base}+${tc.increment}` : `${base} min`;
}

/**
 * Seconds each move took, indexed like the main line, or null where a reading
 * is missing.
 *
 * `clocks[i]` is the mover's clock after move i, increment already added. The
 * same player's previous reading is two moves earlier; their first move is
 * measured from the starting time, which only the time control knows.
 */
export function moveTimes(clocks: (number | null)[], tc: TimeControl | null): (number | null)[] {
  const increment = tc?.increment ?? 0;
  return clocks.map((now, i) => {
    const before = i >= 2 ? clocks[i - 2] : tc ? tc.base : null;
    if (now == null || before == null) return null;
    // A premove on a clock that adds its increment can come out a fraction
    // below zero after rounding; a move never takes negative time.
    return Math.max(0, before - now + increment);
  });
}

/**
 * Below this many seconds a player is short of time: a tenth of the starting
 * time, but never under ten seconds. Without a time control, thirty seconds.
 */
export function lowClockMark(tc: TimeControl | null): number {
  return tc ? Math.max(10, tc.base / 10) : 30;
}

export interface SideClock {
  /** Moves this side made with a measurable duration. */
  measured: number;
  /** Seconds spent across those moves. */
  total: number;
  /** The slowest move, by main-line index. */
  longest: { index: number; seconds: number } | null;
  /** The first move this side made with less than `lowClockMark` left. */
  lowFrom: number | null;
}

/**
 * Per-side totals. Index parity decides the side: `firstMover` made move 0,
 * which is Black for a game set up with Black to move.
 */
export function sideClocks(
  clocks: (number | null)[],
  times: (number | null)[],
  tc: TimeControl | null,
  firstMover: "white" | "black" = "white"
): Record<"white" | "black", SideClock> {
  const low = lowClockMark(tc);
  const out = {
    white: { measured: 0, total: 0, longest: null, lowFrom: null } as SideClock,
    black: { measured: 0, total: 0, longest: null, lowFrom: null } as SideClock,
  };
  clocks.forEach((clock, i) => {
    const side = sideOf(i, firstMover);
    const s = out[side];
    const spent = times[i];
    if (spent != null) {
      s.measured += 1;
      s.total += spent;
      if (!s.longest || spent > s.longest.seconds) s.longest = { index: i, seconds: spent };
    }
    if (clock != null && clock < low && s.lowFrom == null) s.lowFrom = i;
  });
  return out;
}

/** Which side made main-line move `index`. */
export function sideOf(index: number, firstMover: "white" | "black" = "white"): "white" | "black" {
  const firstIsWhite = firstMover === "white";
  return (index % 2 === 0) === firstIsWhite ? "white" : "black";
}

/**
 * Each side's clock in the position after `ply` moves: their latest reading at
 * or before it, or the starting time before they have moved. Null when there
 * is nothing to show.
 */
export function clocksAt(
  clocks: (number | null)[],
  ply: number,
  tc: TimeControl | null,
  firstMover: "white" | "black" = "white"
): Record<"white" | "black", number | null> {
  const out: Record<"white" | "black", number | null> = { white: null, black: null };
  for (let i = Math.min(ply, clocks.length) - 1; i >= 0; i--) {
    const side = sideOf(i, firstMover);
    if (out[side] == null && clocks[i] != null) out[side] = clocks[i];
    if (out.white != null && out.black != null) break;
  }
  if (tc) {
    out.white ??= tc.base;
    out.black ??= tc.base;
  }
  return out;
}

/** A clock face: "2:59", "1:02:03", and tenths under ten seconds ("0:07.4"). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const sec = s < 10 ? rest.toFixed(1).padStart(4, "0") : String(Math.floor(rest)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** How long a move took: "0.4s", "12s", "1:42". */
export function formatSpent(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatClock(Math.round(seconds));
}
