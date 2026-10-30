import {
  MoveTree,
  NodeId,
  ROOT,
  START_FEN,
  addMove,
  annotate,
  createTree,
  mainlinePath,
} from "@/lib/moveTree";
import { NAG_FOR_SUFFIX, SUFFIX_FOR_NAG, isMoveNag } from "@/lib/nags";

/**
 * PGN movetext with variations, in both directions.
 *
 * chess.js is the only chess code allowed in the browser, and it reads and
 * writes the main line only - `( )` blocks are dropped silently on the way in
 * and never emitted on the way out, along with NAGs:
 *
 *   in   1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) 2... Nc6 {said so} 3. Bb5 $1 a6
 *   out  1. e4 e5 2. Nf3 Nc6 {said so} 3. Bb5 a6
 *
 * Which is exactly the half of the format a move tree is about. So the reading
 * and writing of branches lives here, over chess.js's move generation rather
 * than its parser. It is the same walk `prep.py` does server-side when it turns
 * a repertoire PGN into position cards, so the two agree on what a variation
 * means.
 */

/**
 * One movetext token: a comment, a NAG, a bracket, a move number, a result, or
 * a move. Move numbers and results are read and thrown away - the tree derives
 * numbering from ply, and the result belongs to the headers.
 */
const TOKEN =
  /\{[^}]*\}|;[^\r\n]*|\$\d+|[()]|\d+\.{1,3}|1-0|0-1|1\/2-1\/2|\*|[OKQRBNa-h][^\s(){}$;]*/g;

const HEADER = /^\s*\[\s*(\w+)\s*"([^"]*)"\s*\]\s*$/gm;

export interface ParsedPgn {
  tree: MoveTree;
  headers: Record<string, string>;
}

/**
 * `startFen` overrides the `[FEN]` header, for callers that hold the position
 * somewhere more authoritative than the text - a study chapter's own row. It
 * is not a default: passing it means the caller knows, and the header is a
 * claim the same string was pasted with.
 */
export function parsePgn(pgn: string, startFen?: string): ParsedPgn {
  const headers: Record<string, string> = {};
  for (const m of pgn.matchAll(HEADER)) headers[m[1]] = m[2];
  const movetext = pgn.replace(HEADER, "");

  // A chapter that starts from a diagram rather than the opening array says so
  // in its own headers, the way the format has always carried it.
  let tree = createTree(startFen ?? headers.FEN);
  let cur: NodeId = ROOT;
  // Where to come back to when each open bracket closes.
  const stack: NodeId[] = [];
  // A line whose moves stopped making sense: skipped until its bracket closes,
  // so one bad move costs that variation rather than the rest of the file.
  let deadAt: number | null = null;

  for (const match of movetext.matchAll(TOKEN)) {
    const tok = match[0];
    const head = tok[0];

    // A bracket opens a rival to the move just played, so it hangs off that
    // move's parent - which is also why an unplayed position cannot have one.
    if (head === "(") {
      stack.push(cur);
      if (deadAt === null) {
        const parent = tree.nodes.get(cur)?.parent;
        if (parent == null) deadAt = stack.length;
        else cur = parent;
      }
      continue;
    }
    if (head === ")") {
      const back = stack.pop();
      if (back !== undefined) cur = back;
      if (deadAt !== null && stack.length < deadAt) deadAt = null;
      continue;
    }
    if (deadAt !== null) continue;

    if (head === "{") {
      // A comment before the first move belongs to the starting position, and
      // is where a study chapter's own text and shapes live. Only at the top
      // level: inside a bracket the cursor sits on the root for a moment
      // between `(` and the variation's first move, and a comment written
      // there is about that line, not about the game.
      if (cur !== ROOT || stack.length === 0) {
        tree = annotate(tree, cur, { comment: tok.slice(1, -1).trim() });
      }
      continue;
    }
    if (head === "$") {
      if (cur !== ROOT) tree = addNag(tree, cur, parseInt(tok.slice(1), 10));
      continue;
    }
    // Move numbers, results and `;` remarks carry nothing the tree needs.
    if (head === ";" || head === "*" || (head >= "0" && head <= "9")) continue;

    const suffix = /[!?]{1,2}$/.exec(tok)?.[0];
    const san = suffix ? tok.slice(0, -suffix.length) : tok;

    // Inside a bracket is by definition not the game, whatever the file says.
    const r = addMove(tree, cur, san, { source: stack.length === 0 ? "game" : "user" });
    if (r.id === cur) {
      deadAt = stack.length;
      continue;
    }
    tree = r.tree;
    cur = r.id;
    if (suffix) tree = annotate(tree, cur, { nag: NAG_FOR_SUFFIX[suffix] });
  }

  // Only an actual game locks its main line. An empty PGN is a blank board,
  // and a blank board is something you are still allowed to build a game on.
  return { tree: { ...tree, locked: mainlinePath(tree).length > 0 }, headers };
}

/**
 * File a NAG on a move. A move assessment takes the move's one `nag` slot; a
 * position assessment or observation joins `nags`, once. See lib/nags.ts.
 */
function addNag(tree: MoveTree, id: NodeId, nag: number): MoveTree {
  if (!Number.isFinite(nag) || nag <= 0 || nag > 255) return tree;
  if (isMoveNag(nag)) return annotate(tree, id, { nag });
  const have = tree.nodes.get(id)?.nags ?? [];
  return have.includes(nag) ? tree : annotate(tree, id, { nags: [...have, nag] });
}

/**
 * Cut a file holding many games into one string per game.
 *
 * A game starts at a tag section that follows movetext - which is how every
 * multi-game file is laid out, ChessBase's and Lichess's exports included.
 * Brackets inside comments are skipped while scanning, so a comment that
 * happens to contain `[Event` does not split a game in half.
 */
export function splitPgnGames(text: string): string[] {
  const games: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let current: string[] = [];
  let sawMoves = false;
  let inComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isTag = !inComment && /^\[\s*\w+\s*"/.test(trimmed);
    if (isTag && sawMoves) {
      if (current.join("").trim()) games.push(current.join("\n").trim());
      current = [];
      sawMoves = false;
    }
    current.push(line);
    if (!isTag && trimmed) {
      sawMoves = true;
      // Track whether a brace comment is still open at the end of the line.
      for (const ch of trimmed) {
        if (ch === "{") inComment = true;
        else if (ch === "}") inComment = false;
      }
    }
  }
  if (current.join("").trim()) games.push(current.join("\n").trim());
  return games;
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const SEVEN_TAG: Record<string, string> = {
  Event: "?",
  Site: "?",
  Date: "????.??.??",
  Round: "?",
  White: "?",
  Black: "?",
  Result: "*",
};

/** How wide a movetext line gets before it wraps, as the spec suggests. */
const WRAP = 80;

/**
 * Where the root sits on the real board's clock.
 *
 * A node's `ply` counts from the tree's own root, so in a chapter that starts
 * from a diagram at move 23 every move would otherwise be numbered from 1.
 * The FEN states the move number and the side to move, which is exactly the
 * offset needed to put them back where they belong.
 */
function plyOffset(fen: string): number {
  const [, turn, , , , fullmove] = fen.split(" ");
  const no = parseInt(fullmove, 10);
  if (!Number.isFinite(no) || no < 1) return 0;
  return (no - 1) * 2 + (turn === "b" ? 1 : 0);
}

export function toPgn(tree: MoveTree, headers: Record<string, string> = {}): string {
  const root = tree.nodes.get(tree.root);
  const fromDiagram = !!root && root.fen !== START_FEN;

  // The tree is the authority on where it stands, not the headers it was
  // opened with: a `FEN` tag left over from a source PGN would otherwise
  // contradict the board the moves were actually played on.
  const tags: Record<string, string> = { ...SEVEN_TAG, ...headers };
  if (fromDiagram) {
    // The pair is required. SetUp is what tells a reader the FEN is the start
    // position rather than one reached partway through.
    tags.SetUp = "1";
    tags.FEN = root!.fen;
  } else {
    delete tags.SetUp;
    delete tags.FEN;
  }

  const head = Object.entries(tags)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join("\n");

  return `${head}\n\n${wrap([...movetextTokens(tree), tags.Result])}\n`;
}

/**
 * The moves alone, with no tag pairs around them.
 *
 * What a study chapter stores. The position it starts from, its name and its
 * prose are columns on the chapter's own row, so writing them into the
 * movetext as well would give the file two places to disagree with itself -
 * and the server's export, which builds the tag block, would emit two.
 */
export function toMovetext(tree: MoveTree): string {
  return wrap(movetextTokens(tree));
}

function movetextTokens(tree: MoveTree): string[] {
  const root = tree.nodes.get(tree.root);
  const offset = root && root.fen !== START_FEN ? plyOffset(root.fen) : 0;
  const first = root?.children[0];
  const body = first === undefined ? [] : lineText(tree, first, true, offset);
  // What was said about the starting position, before anything was played.
  const preface = root?.comment ? [`{${root.comment}}`] : [];
  return [...preface, ...body];
}

/**
 * One line of play, with each rival to a move written in brackets straight
 * after it - the placement the format requires and every reader assumes.
 */
function lineText(tree: MoveTree, first: NodeId, forced: boolean, offset: number): string[] {
  const out: string[] = [];
  let cur: NodeId | undefined = first;
  let needNum = forced;

  while (cur !== undefined) {
    const n = tree.nodes.get(cur);
    if (!n) break;
    const suffix = SUFFIX_FOR_NAG[n.nag ?? 0];
    out.push(number(n.ply + offset, needNum) + n.san + (suffix ?? ""));
    // A move mark with no suffix spelling (□, ⨀), then the position and
    // observation glyphs - each as `$n`, which every reader understands.
    if (n.nag != null && !suffix) out.push(`$${n.nag}`);
    for (const g of n.nags ?? []) out.push(`$${g}`);
    needNum = false;

    if (n.comment) {
      out.push(`{${n.comment}}`);
      needNum = true; // a comment breaks the reader's place; renumber after it
    }

    // Only the continuation carries its position's alternatives. A variation
    // head is written by whoever opened its bracket.
    const parent = n.parent === null ? undefined : tree.nodes.get(n.parent);
    if (parent && parent.children[0] === n.id) {
      for (const alt of parent.children.slice(1)) {
        out.push(`(${lineText(tree, alt, true, offset).join(" ")})`);
        needNum = true;
      }
    }
    cur = n.children[0];
  }
  return out;
}

function number(ply: number, forced: boolean): string {
  const no = Math.floor(ply / 2) + 1;
  if (ply % 2 === 0) return `${no}. `;
  return forced ? `${no}... ` : "";
}

function wrap(tokens: string[]): string {
  const lines: string[] = [];
  let line = "";
  for (const t of tokens) {
    if (line && line.length + t.length + 1 > WRAP) {
      lines.push(line);
      line = t;
    } else {
      line = line ? `${line} ${t}` : t;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
