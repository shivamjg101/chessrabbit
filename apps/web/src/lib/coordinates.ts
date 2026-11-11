/**
 * The coordinates drill: a square is named, you click it, against the clock.
 *
 * Knowing "f7" without counting files is what lets you read notation, follow
 * a commentary and calculate a line in your head; it is learned by repetition,
 * which is all this is.
 */

export const FILES = "abcdefgh";
export const SQUARES: string[] = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));

/** Seconds in one round. */
export const ROUND_SECONDS = 30;

export type DrillSide = "white" | "black" | "random";

/** A square to find, never the one just found: the same answer twice reads as a glitch. */
export function nextTarget(previous: string | null, random: () => number = Math.random): string {
  const pool = previous ? SQUARES.filter((s) => s !== previous) : SQUARES;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Where the best score for a side is kept, per browser. */
export function bestKey(side: DrillSide): string {
  return `cr_coords_best_${side}`;
}

export function readBest(side: DrillSide): number {
  return readScore(bestKey(side));
}

/** Remember `score` if it beats the stored best; returns the best after this round. */
export function saveBest(side: DrillSide, score: number): number {
  return saveScore(bestKey(side), score);
}

/** A drill's best score kept in this browser under `key`. */
export function readScore(key: string): number {
  try {
    return Number(window.localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/** Keep `score` under `key` if it beats what is there; returns the best after it. */
export function saveScore(key: string, score: number): number {
  const best = Math.max(readScore(key), score);
  try {
    window.localStorage.setItem(key, String(best));
  } catch {
    /* private mode: the round still counts, it just is not remembered */
  }
  return best;
}
