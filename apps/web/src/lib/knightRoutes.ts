/**
 * The knight routes drill: a knight and a target square, and you hop it there
 * in the fewest moves. Seeing a knight's path without moving pieces is the
 * same skill as seeing forks and outposts two moves ahead.
 */

import { SQUARES } from "@/lib/coordinates";

/** Seconds in one round. */
export const KNIGHT_ROUND_SECONDS = 60;

/** Where the best score is kept, per browser. */
export const KNIGHT_BEST_KEY = "cr_knight_best";

const JUMPS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

/** Every square a knight on `square` can reach in one move. */
export function knightMoves(square: string): string[] {
  const f = square.charCodeAt(0) - 97;
  const r = Number(square[1]) - 1;
  return JUMPS.map(([df, dr]) => [f + df, r + dr])
    .filter(([x, y]) => x >= 0 && x < 8 && y >= 0 && y < 8)
    .map(([x, y]) => String.fromCharCode(97 + x) + (y + 1));
}

/** The fewest knight moves from `from` to `to` (breadth-first; the board is 64 squares). */
export function knightDistance(from: string, to: string): number {
  const seen = new Map([[from, 0]]);
  const queue = [from];
  for (const sq of queue) {
    if (sq === to) return seen.get(sq)!;
    for (const next of knightMoves(sq)) {
      if (!seen.has(next)) {
        seen.set(next, seen.get(sq)! + 1);
        queue.push(next);
      }
    }
  }
  return -1; // unreachable on a full board; kept so the type is honest
}

export interface KnightRoute {
  from: string;
  to: string;
  moves: number;
}

/** A route two to four moves long: one is too easy to train anything, five is rare. */
export function nextRoute(random: () => number = Math.random): KnightRoute {
  const pick = () => SQUARES[Math.min(63, Math.floor(random() * 64))];
  for (;;) {
    const from = pick();
    const to = pick();
    const moves = knightDistance(from, to);
    if (moves >= 2 && moves <= 4) return { from, to, moves };
  }
}
