/**
 * Numeric Annotation Glyphs: the marks a chess annotator puts beside a move.
 *
 * PGN stores them as `$n`. The six move marks also have suffix spellings
 * (`e4!?`), which is all this app used to keep - one mark per move, and a
 * position assessment like `±` or an observation like "with the initiative"
 * was dropped on the way in. ChessBase and Lichess both annotate with the
 * three families below, and a move routinely carries one of each: `Nf5! ±`
 * with the initiative.
 *
 * The families, and the numbers in them, follow Lichess's glyph set, which is
 * itself the commonly used subset of the PGN standard's table. Numbers outside
 * it are still kept and written back out - an annotation from another program
 * survives a round trip here even when this app has no button for it.
 */

export type GlyphFamily = "move" | "position" | "observation";

export interface Glyph {
  nag: number;
  symbol: string;
  name: string;
  family: GlyphFamily;
}

export const GLYPHS: Glyph[] = [
  { nag: 1, symbol: "!", name: "Good move", family: "move" },
  { nag: 2, symbol: "?", name: "Mistake", family: "move" },
  { nag: 3, symbol: "!!", name: "Brilliant move", family: "move" },
  { nag: 4, symbol: "??", name: "Blunder", family: "move" },
  { nag: 5, symbol: "!?", name: "Interesting move", family: "move" },
  { nag: 6, symbol: "?!", name: "Dubious move", family: "move" },
  { nag: 7, symbol: "□", name: "Only move", family: "move" },
  { nag: 22, symbol: "⨀", name: "Zugzwang", family: "move" },

  { nag: 10, symbol: "=", name: "Equal position", family: "position" },
  { nag: 13, symbol: "∞", name: "Unclear position", family: "position" },
  { nag: 14, symbol: "⩲", name: "White is slightly better", family: "position" },
  { nag: 15, symbol: "⩱", name: "Black is slightly better", family: "position" },
  { nag: 16, symbol: "±", name: "White is better", family: "position" },
  { nag: 17, symbol: "∓", name: "Black is better", family: "position" },
  { nag: 18, symbol: "+−", name: "White is winning", family: "position" },
  { nag: 19, symbol: "−+", name: "Black is winning", family: "position" },

  { nag: 146, symbol: "N", name: "Novelty", family: "observation" },
  { nag: 32, symbol: "↑↑", name: "Development", family: "observation" },
  { nag: 36, symbol: "↑", name: "Initiative", family: "observation" },
  { nag: 40, symbol: "→", name: "Attack", family: "observation" },
  { nag: 132, symbol: "⇆", name: "Counterplay", family: "observation" },
  { nag: 138, symbol: "⊕", name: "Time trouble", family: "observation" },
  { nag: 44, symbol: "=∞", name: "With compensation", family: "observation" },
  { nag: 140, symbol: "∆", name: "With the idea", family: "observation" },
];

const BY_NAG = new Map(GLYPHS.map((g) => [g.nag, g]));

export function glyphOf(nag: number): Glyph | undefined {
  return BY_NAG.get(nag);
}

/** What to print for a NAG: its symbol, or `$n` for one with no symbol here. */
export function glyphSymbol(nag: number): string {
  return BY_NAG.get(nag)?.symbol ?? `$${nag}`;
}

/**
 * A move assessment - the one mark a move gets about the move itself.
 *
 * Kept in `MoveNode.nag`, which is where it always lived, so everything that
 * already read the move's quality from there still does. Position and
 * observation glyphs go in `MoveNode.nags`.
 */
export function isMoveNag(nag: number): boolean {
  return BY_NAG.get(nag)?.family === "move";
}

/** The suffix spelling a reader expects for the six classic marks. */
export const SUFFIX_FOR_NAG: Record<number, string> = {
  1: "!",
  2: "?",
  3: "!!",
  4: "??",
  5: "!?",
  6: "?!",
};

export const NAG_FOR_SUFFIX: Record<string, number> = {
  "!": 1,
  "?": 2,
  "!!": 3,
  "??": 4,
  "!?": 5,
  "?!": 6,
};

/**
 * Toggle one glyph on a move's marks, the way an annotation palette behaves.
 *
 * Within the move and position families a glyph replaces whichever one of
 * its family was there - a move is not both "!" and "?", a position not both
 * "=" and "±". Observations stack. Choosing the glyph a move already has
 * takes it off, which is the only way back to an unmarked move.
 */
export function toggleGlyph(
  marks: { nag?: number; nags?: number[] },
  nag: number
): { nag?: number; nags?: number[] } {
  const family = BY_NAG.get(nag)?.family;
  const extra = marks.nags ?? [];

  if (family === "move") {
    return { nag: marks.nag === nag ? undefined : nag, nags: marks.nags };
  }

  let next: number[];
  if (extra.includes(nag)) {
    next = extra.filter((n) => n !== nag);
  } else if (family === "position") {
    next = [...extra.filter((n) => BY_NAG.get(n)?.family !== "position"), nag];
  } else {
    next = [...extra, nag];
  }
  // Position first, then observations, then anything unknown - the order a
  // reader expects them in after the move.
  next.sort((a, b) => rank(a) - rank(b));
  return { nag: marks.nag, nags: next.length ? next : undefined };
}

function rank(nag: number): number {
  const family = BY_NAG.get(nag)?.family;
  return family === "position" ? 0 : family === "observation" ? 1 : 2;
}

/** Every mark on a move, as the symbols printed after it. */
export function glyphText(marks: { nag?: number; nags?: number[] }): string {
  const parts: string[] = [];
  if (marks.nag != null) parts.push(glyphSymbol(marks.nag));
  for (const n of marks.nags ?? []) parts.push(glyphSymbol(n));
  return parts.join(" ");
}
