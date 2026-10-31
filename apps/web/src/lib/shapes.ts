/**
 * Arrows and circles drawn on the board, kept in the move's own comment.
 *
 * PGN has carried these since ChessBase put them there, as commands inside a
 * comment: `{the plan [%csl Gd4][%cal Gd2d4,Rf6e4]}`. Lichess reads and writes
 * the same thing, which is the reason to use it rather than a field of our own:
 * a chapter drawn here opens over there with its arrows intact, and a study
 * imported from there arrives with the author's.
 *
 * It also means shapes need no storage. `MoveNode.comment` already round-trips
 * through `pgn.ts`, `treeStorage.ts` and the server, so a shape written into it
 * is persisted, exported and synced by machinery that was already there and
 * does not have to learn what a shape is. This module is only the translation
 * between that string and something a renderer can use.
 */

/** The four brushes every reader agrees on, keyed by their PGN letter. */
export const BRUSHES = {
  G: "green",
  R: "red",
  Y: "yellow",
  B: "blue",
} as const;

export type BrushKey = keyof typeof BRUSHES;
export type Brush = (typeof BRUSHES)[BrushKey];

const KEY_FOR_BRUSH: Record<Brush, BrushKey> = {
  green: "G",
  red: "R",
  yellow: "Y",
  blue: "B",
};

/**
 * Drawn over wooden squares, so these are the saturated ends of each hue
 * rather than the UI's own palette - a shape has to read against both a light
 * and a dark square without being mistaken for the board's own highlights.
 */
export const BRUSH_COLOR: Record<Brush, string> = {
  green: "#2BAE66",
  red: "#D0473E",
  yellow: "#E0A22C",
  blue: "#3B82C4",
};

/** An arrow when `to` is set, a ring around `from` when it is not. */
export interface Shape {
  from: string;
  to?: string;
  brush: Brush;
}

const SQUARE = /^[a-h][1-8]$/;

/** `[%cal ...]` and `[%csl ...]`, with the command name and its payload. */
const COMMAND = /\[%(cal|csl)\s+([^\]]*)\]/g;

/**
 * Any embedded command: shapes, but also the clock (`[%clk 0:02:59]`), the
 * elapsed time and the eval that Lichess and Chess.com write after every move.
 * None of it is prose, and the ones that are not shapes are carried through an
 * edit untouched - rewriting a comment must not delete the clock beside it.
 */
const ANY_COMMAND = /\[%\w+[^\]]*\]/g;

function isSquare(s: string): boolean {
  return SQUARE.test(s);
}

/**
 * Read one `[%cal]` / `[%csl]` payload: comma-separated items, each a brush
 * letter followed by one square (a circle) or two (an arrow).
 *
 * Anything that is not exactly that is dropped rather than guessed at. A
 * malformed item in somebody else's file should cost that item, not the
 * comment it sits in.
 */
function parsePayload(kind: string, payload: string): Shape[] {
  const out: Shape[] = [];
  for (const raw of payload.split(",")) {
    const item = raw.trim();
    const brush = BRUSHES[item[0] as BrushKey];
    if (!brush) continue;

    const body = item.slice(1);
    if (kind === "csl" && body.length === 2 && isSquare(body)) {
      out.push({ from: body, brush });
    } else if (kind === "cal" && body.length === 4) {
      const [from, to] = [body.slice(0, 2), body.slice(2)];
      // A zero-length arrow is a circle drawn the wrong way; readers disagree
      // about what to do with it, so we decline to hold one at all.
      if (isSquare(from) && isSquare(to) && from !== to) out.push({ from, to, brush });
    }
  }
  return out;
}

/**
 * Split a comment into the prose a reader sees and the shapes a board draws.
 *
 * Both halves come back every time, so a caller never has to know whether the
 * comment had commands in it. `commands` holds every other command verbatim,
 * for `joinComment` to put back.
 */
export function splitComment(comment?: string): { text: string; shapes: Shape[]; commands: string[] } {
  if (!comment) return { text: "", shapes: [], commands: [] };

  const shapes: Shape[] = [];
  for (const m of comment.matchAll(COMMAND)) {
    shapes.push(...parsePayload(m[1], m[2]));
  }
  const commands = (comment.match(ANY_COMMAND) ?? []).filter((c) => !/^\[%(cal|csl)\s/.test(c));

  // Removing the commands leaves the gaps they occupied; collapse them so a
  // comment that was nothing but commands comes back as empty rather than blank.
  const text = comment.replace(ANY_COMMAND, " ").replace(/\s+/g, " ").trim();
  return { text, shapes, commands };
}

/**
 * The comment to store for this prose and these shapes, or undefined when
 * there is nothing to store - which is what tells the tree to drop the comment
 * rather than keep an empty one that every exporter would then write out.
 */
export function joinComment(text: string, shapes: Shape[], commands: string[] = []): string | undefined {
  const prose = text.trim();
  const circles = shapes.filter((s) => !s.to);
  const arrows = shapes.filter((s) => s.to);

  const parts: string[] = [];
  if (prose) parts.push(prose);
  if (circles.length) {
    parts.push(`[%csl ${circles.map((s) => KEY_FOR_BRUSH[s.brush] + s.from).join(",")}]`);
  }
  if (arrows.length) {
    parts.push(`[%cal ${arrows.map((s) => KEY_FOR_BRUSH[s.brush] + s.from + s.to).join(",")}]`);
  }
  parts.push(...commands);
  return parts.length ? parts.join(" ") : undefined;
}

/** Same square, same direction - a circle and an arrow from it are not one. */
function sameSpot(a: Shape, b: Shape): boolean {
  return a.from === b.from && a.to === b.to;
}

/**
 * Draw a shape, or undraw it.
 *
 * Drawing over a shape you already have in the same colour removes it, and in
 * a different colour recolours it - which is how every board that has these
 * behaves, and the only way to get rid of one without a separate eraser.
 */
export function toggleShape(shapes: Shape[], shape: Shape): Shape[] {
  const at = shapes.findIndex((s) => sameSpot(s, shape));
  if (at < 0) return [...shapes, shape];
  if (shapes[at].brush === shape.brush) return shapes.filter((_, i) => i !== at);
  return shapes.map((s, i) => (i === at ? shape : s));
}

/** Which brush a modifier key asks for, following the convention everywhere. */
export function brushFor(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): Brush {
  if (e.shiftKey) return "red";
  if (e.altKey) return "blue";
  if (e.ctrlKey) return "yellow";
  return "green";
}
