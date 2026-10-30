import {
  MoveSource,
  MoveTree,
  NodeId,
  ROOT,
  addMove,
  annotate,
  START_FEN,
  createTree,
  mainlinePath,
} from "@/lib/moveTree";

/**
 * Keeping the lines you explored across a reload.
 *
 * The tree is rebuilt from the PGN on every mount, so without this a refresh
 * throws away exactly what the tree was built to stop throwing away - the same
 * loss, moved from the move list to the page lifecycle.
 *
 * Two things make the stored form small and safe:
 *
 * Nothing derived is written. A node's FEN is sixty bytes of a position that
 * can be replayed from its parent in microseconds, and ply, depth and main-line
 * standing all fall out of where the move sits. Only the parent, the move, and
 * what a person added to it are worth keeping.
 *
 * A saved tree is adopted only if its main line still matches the game being
 * opened. Re-import a corrected PGN and the old variations would otherwise be
 * grafted onto moves they were never about - the same failure the review's
 * per-ply alignment check exists to prevent, arriving by a different route.
 */

const PREFIX = "chessrabbit.tree.";
const INDEX = `${PREFIX}index`;

/** How many games keep their analysis before the oldest starts falling off. */
const MAX_TREES = 30;

interface StoredMove {
  p: number; // parent, in this file's own numbering
  s: string; // SAN
  k?: MoveSource;
  e?: number | null;
  c?: string;
  n?: number;
  g?: number[]; // position and observation glyphs
}

interface StoredTree {
  v: 1;
  moves: StoredMove[];
  cursor: number;
  locked: boolean;
  /**
   * What was written about the starting position - including any shapes drawn
   * on it, which live in the same comment. It has no move to hang off, so it
   * cannot travel in `moves` the way every other annotation does.
   */
  r?: string;
  /**
   * The position the tree stands on, when it is not the opening array - a
   * board set up from a FEN. Without it the moves would be replayed from the
   * wrong start, and any that happened to be legal there would come back as
   * a different game.
   */
  f?: string;
}

/**
 * In id order, which is creation order.
 *
 * A node is always created after its parent, so replaying the list start to
 * finish never references a move that does not exist yet, and siblings keep the
 * order they were tried in. Deleting a line leaves holes in the sequence, so
 * ids are renumbered on the way out and the cursor is remapped with them - the
 * ids a reload hands back are its own, and nothing outside this file should
 * hold one across a reload.
 */
export function serializeTree(tree: MoveTree, cursorId: NodeId): StoredTree {
  const renumbered = new Map<NodeId, number>([[tree.root, 0]]);
  const moves = [...tree.nodes.values()]
    .filter((n) => n.parent !== null)
    .sort((a, b) => a.id - b.id)
    .map((n, i) => {
      renumbered.set(n.id, i + 1);
      const m: StoredMove = { p: renumbered.get(n.parent!) ?? 0, s: n.san };
      if (n.source !== "user") m.k = n.source;
      if (n.evalCp != null) m.e = n.evalCp;
      if (n.comment) m.c = n.comment;
      if (n.nag != null) m.n = n.nag;
      if (n.nags?.length) m.g = n.nags;
      return m;
    });

  const out: StoredTree = {
    v: 1,
    moves,
    cursor: renumbered.get(cursorId) ?? 0,
    locked: tree.locked,
  };
  const rootComment = tree.nodes.get(tree.root)?.comment;
  if (rootComment) out.r = rootComment;
  const rootFen = tree.nodes.get(tree.root)?.fen;
  if (rootFen && rootFen !== START_FEN) out.f = rootFen;
  return out;
}

export function deserializeTree(data: StoredTree): { tree: MoveTree; cursorId: NodeId } {
  let tree = createTree(data.f);
  if (data.r) tree = annotate(tree, ROOT, { comment: data.r });
  for (const m of data.moves) {
    const r = addMove(tree, m.p, m.s, { source: m.k ?? "user", evalCp: m.e ?? null });
    if (r.id === m.p) break; // the list stopped describing a legal game
    tree = r.tree;
    if (m.c || m.n != null || m.g?.length) {
      tree = annotate(tree, r.id, { comment: m.c, nag: m.n, nags: m.g });
    }
  }
  return { tree: { ...tree, locked: data.locked }, cursorId: data.cursor };
}

/**
 * A tree worth keeping is one that holds something the PGN does not.
 *
 * Extra moves are the obvious case, but not the only one: a game where you
 * only wrote on the moves that were played, or drew arrows over them, holds
 * exactly as much work and no extra nodes at all. Counting nodes alone threw
 * all of it away on reload.
 */
function worthKeeping(tree: MoveTree): boolean {
  if (tree.nodes.size - 1 > mainlinePath(tree).length) return true;
  for (const n of tree.nodes.values()) {
    if (n.comment || n.nag != null || n.nags?.length) return true;
  }
  return false;
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // private mode, or storage disabled outright
  }
}

function readIndex(ls: Storage): string[] {
  try {
    const raw = ls.getItem(INDEX);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Most recently written first, so eviction takes from the tail. */
function touch(ls: Storage, key: string): void {
  const next = [key, ...readIndex(ls).filter((k) => k !== key)];
  for (const stale of next.slice(MAX_TREES)) ls.removeItem(PREFIX + stale);
  ls.setItem(INDEX, JSON.stringify(next.slice(0, MAX_TREES)));
}

function forget(ls: Storage, key: string): void {
  ls.removeItem(PREFIX + key);
  const index = readIndex(ls);
  // Nothing to rewrite if it was never listed - a game with no lines in it
  // should leave no trace at all, not an index recording that it had none.
  if (index.includes(key)) ls.setItem(INDEX, JSON.stringify(index.filter((k) => k !== key)));
}

export function saveTree(key: string, tree: MoveTree, cursorId: NodeId): void {
  const ls = store();
  if (!ls) return;

  // Explore, change your mind, delete the lot: the entry goes too, rather than
  // sitting there shadowing the game with an empty tree.
  if (!worthKeeping(tree)) {
    forget(ls, key);
    return;
  }

  const payload = JSON.stringify(serializeTree(tree, cursorId));
  try {
    ls.setItem(PREFIX + key, payload);
    touch(ls, key);
  } catch {
    // Out of room. Drop the oldest half and take one more run at it; if that
    // fails too, the analysis is worth less than crashing the board over.
    const index = readIndex(ls);
    for (const stale of index.slice(Math.ceil(index.length / 2))) forget(ls, stale);
    try {
      ls.setItem(PREFIX + key, payload);
      touch(ls, key);
    } catch {
      /* give up quietly */
    }
  }
}

/**
 * The saved tree for this game, if it still describes this game.
 * `expectMain` is the main line of the PGN just loaded.
 */
export function loadTree(
  key: string,
  expectMain: string[]
): { tree: MoveTree; cursorId: NodeId } | null {
  const ls = store();
  if (!ls) return null;

  let data: StoredTree;
  try {
    const raw = ls.getItem(PREFIX + key);
    if (!raw) return null;
    data = JSON.parse(raw) as StoredTree;
    if (data.v !== 1 || !Array.isArray(data.moves)) throw new Error("shape");
  } catch {
    forget(ls, key);
    return null;
  }

  const restored = deserializeTree(data);
  const main = mainlinePath(restored.tree).map((n) => n.san);
  if (main.length !== expectMain.length || main.some((san, i) => san !== expectMain[i])) {
    forget(ls, key);
    return null;
  }

  touch(ls, key);
  return restored;
}
