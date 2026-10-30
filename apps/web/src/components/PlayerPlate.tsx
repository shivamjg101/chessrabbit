"use client";

/**
 * Who is sitting on each side of the board.
 *
 * The row every chess site puts above and below the board, and the first thing
 * you look for when a game opens: name, rating, and - once the game is over -
 * the point each player took from it. It follows the board's orientation, so
 * the player whose pieces are nearest the bottom is always the lower plate.
 */

/** Both players of the game on the board, as much as we know about them. */
export interface GamePlayers {
  white: string;
  black: string;
  whiteElo?: number | null;
  blackElo?: number | null;
  /** PGN result tag: "1-0", "0-1", "1/2-1/2", or "*" while undecided. */
  result?: string;
}

/**
 * What one side scored, or null while nobody has. Only the four results the
 * PGN spec defines mean anything; anything else is an unfinished game.
 */
export function scoreOf(result: string | undefined, side: "white" | "black"): number | null {
  if (result === "1/2-1/2") return 0.5;
  if (result === "1-0") return side === "white" ? 1 : 0;
  if (result === "0-1") return side === "white" ? 0 : 1;
  return null;
}

interface Props {
  name: string;
  elo?: number | null;
  side: "white" | "black";
  /** This player's score, from `scoreOf`. Null hides the chip. */
  score?: number | null;
  /** True when it is this player's turn in the position on the board. */
  toMove?: boolean;
}

export default function PlayerPlate({ name, elo, side, score, toMove }: Props) {
  // Codepoint-aware: a name starting with an emoji or an astral character
  // would otherwise be sliced into half a surrogate pair and render as junk.
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";

  return (
    <div
      className={`flex h-8 min-w-0 items-center gap-2 rounded-xl px-1.5 ring-1 transition-[background-color,box-shadow] ${
        toMove
          ? "bg-ivory/[0.1] shadow-edge ring-brass/45"
          : "bg-ivory/[0.04] ring-ivory/[0.08]"
      }`}
    >
      {/* The avatar doubles as the colour swatch: no photo to show, but which
          side this is should be readable without reading the board. */}
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${
          side === "white"
            ? "bg-gradient-to-b from-white to-ivory text-ebony"
            : "bg-ebony text-ink ring-1 ring-ivory/25"
        }`}
        aria-hidden
      >
        {initial}
      </span>

      <span className="min-w-0 truncate text-sm font-medium" title={name}>
        {name}
      </span>

      {elo != null && (
        <span className="shrink-0 font-mono text-[11px] text-muted">({elo})</span>
      )}

      {score != null && (
        <span
          className={`ml-auto shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
            score === 1 ? "bg-good/20 text-good" : "bg-ivory/[0.08] text-muted"
          }`}
          title={score === 1 ? "Won" : score === 0 ? "Lost" : "Drawn"}
        >
          {score === 1 ? "1" : score === 0 ? "0" : "½"}
        </span>
      )}
    </div>
  );
}
