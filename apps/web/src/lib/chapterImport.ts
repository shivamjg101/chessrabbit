import type { ChapterDraft, ChapterMode } from "@/lib/api";
import { START_FEN, createTree, mergeTree, nodeAt } from "@/lib/moveTree";
import { parsePgn, splitPgnGames, toMovetext } from "@/lib/pgn";

/**
 * Turning PGN into study chapters.
 *
 * A study is a multi-game PGN file with a name on it - that is how ChessBase
 * and Lichess both export one - so importing a file is reading each game into
 * a chapter: its tags become the chapter's tags, its start position the
 * chapter's start, and its movetext (variations, comments, glyphs and drawn
 * shapes included) is re-written by `toMovetext` so what the server stores is
 * exactly what this app writes and reads back.
 */

/** Tags the chapter row already says for itself, so never stored twice. */
const DERIVED = new Set(["FEN", "SetUp", "Orientation", "ChapterMode"]);

const MODES: ChapterMode[] = ["normal", "lesson", "conceal"];

/** Same placement, side, castling and en passant - the move counters aside. */
function sameStart(a: string, b: string): boolean {
  return a.split(" ").slice(0, 4).join(" ") === b.split(" ").slice(0, 4).join(" ");
}

/** A PGN tag value that means "nobody filled this in". */
function blank(value: string | undefined): boolean {
  return !value || value === "?" || /^\?{4}\.\?{2}\.\?{2}$/.test(value);
}

export interface ImportDefaults {
  mode?: ChapterMode;
  orientation?: "white" | "black";
  hide_engine?: boolean;
}

/** The name a game goes by in a chapter list. */
export function chapterName(headers: Record<string, string>, index: number): string {
  const white = headers.White;
  const black = headers.Black;
  let name: string;
  if (!blank(white) && !blank(black)) name = `${white} – ${black}`;
  else if (!blank(headers.Event)) name = headers.Event;
  else name = `Chapter ${index + 1}`;
  return name.slice(0, 120);
}

/** The tags worth keeping on a chapter: filled in, well-formed, not derived. */
export function chapterTags(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (DERIVED.has(key) || blank(value) || !/^\w{1,40}$/.test(key)) continue;
    out[key] = value.slice(0, 255);
  }
  return out;
}

/**
 * One draft chapter per game in `text`. Games with neither moves nor a set-up
 * position are skipped: an empty tag section is not a chapter anybody wanted.
 */
export function chaptersFromPgn(text: string, defaults: ImportDefaults = {}): ChapterDraft[] {
  const drafts: ChapterDraft[] = [];
  for (const game of splitPgnGames(text)) {
    const { tree, headers } = parsePgn(game);
    const root = nodeAt(tree, tree.root)!;
    const fromDiagram = root.fen !== START_FEN;
    if (tree.nodes.size < 2 && !fromDiagram && !root.comment) continue;

    const mode = MODES.includes(headers.ChapterMode as ChapterMode)
      ? (headers.ChapterMode as ChapterMode)
      : defaults.mode ?? "normal";

    drafts.push({
      name: chapterName(headers, drafts.length),
      pgn: toMovetext(tree),
      starting_fen: fromDiagram ? root.fen : undefined,
      orientation:
        headers.Orientation === "black" || headers.Orientation === "white"
          ? headers.Orientation
          : defaults.orientation ?? "white",
      mode,
      hide_engine: defaults.hide_engine ?? false,
      tags: chapterTags(headers),
    });
  }
  return drafts;
}

/**
 * Many games poured into one chapter: every move any of them played, shared
 * moves once, the rest as variations - an opening tree built from games.
 *
 * Games that start somewhere other than the first game's start are left out,
 * and counted, because a line from another position is not a line of this
 * tree.
 */
export function mergedChapter(
  pgns: string[],
  name: string,
  defaults: ImportDefaults = {}
): { draft: ChapterDraft | null; merged: number; skipped: number } {
  let tree = null as ReturnType<typeof createTree> | null;
  let merged = 0;
  let skipped = 0;

  for (const pgn of pgns.flatMap((p) => splitPgnGames(p))) {
    const parsed = parsePgn(pgn).tree;
    if (parsed.nodes.size < 2) continue;
    if (!tree) {
      tree = { ...parsed, locked: false };
      merged++;
      continue;
    }
    if (!sameStart(nodeAt(parsed, parsed.root)!.fen, nodeAt(tree, tree.root)!.fen)) {
      skipped++;
      continue;
    }
    tree = mergeTree(tree, parsed);
    merged++;
  }

  if (!tree) return { draft: null, merged: 0, skipped };
  const rootFen = nodeAt(tree, tree.root)!.fen;
  return {
    draft: {
      name: name.slice(0, 120),
      pgn: toMovetext(tree),
      starting_fen: rootFen !== START_FEN ? rootFen : undefined,
      orientation: defaults.orientation ?? "white",
      mode: defaults.mode ?? "normal",
      hide_engine: defaults.hide_engine ?? false,
      tags: {},
    },
    merged,
    skipped,
  };
}
