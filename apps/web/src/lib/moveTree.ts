import { Chess } from "chess.js";

/**
 * The move tree: the game, plus every line you tried instead of it.
 *
 * A flat move list has to delete the future to let you explore the past.
 * This does not — playing a move anywhere except the end of a line hangs a
 * new branch off that point and leaves everything else standing.
 *
 * One invariant holds the whole design together:
 *
 *   THE MAIN LINE IS THE GAME. The path of children[0] edges from the root
 *   is exactly the move list the server parsed, in the same order, at the
 *   same ply numbers, for the entire life of a loaded game.
 *
 * The review depends on it. Annotations are keyed by ply against the
 * server's parse, and each row is checked against the move the board holds
 * at that ply before it is allowed to be shown. Renumber the main line and
 * every one of those checks starts comparing against the wrong move — which
 * is the bug that made a review announce "d4 is a blunder" directly above
 * "Best was d4". So a loaded game is `locked`, and nothing you explore can
 * ever become part of it.
 */

export type NodeId = number;

/** Where a branch came from. Only "game" moves may sit on a locked main line. */
export type MoveSource = "game" | "user" | "engine" | "book";

export interface MoveNode {
  id: NodeId;
  parent: NodeId | null; // null only for the root
  children: NodeId[]; // children[0] is the continuation shown inline
  san: string; // "Nf3" - for display
  uci: string; // "g1f3" - for matching against the server's annotations
  fen: string; // the position AFTER this move
  ply: number; // 0-based; the root is -1
  mainline: boolean; // every ancestor edge was children[0]
  depth: number; // 0 on the main line, 1 in a variation, 2 nested inside one
  source: MoveSource;
  evalCp?: number | null; // the engine's score when the branch was made
  comment?: string;
  /** The move assessment: !, ?, !!, ??, !?, ?!, □ or ⨀. See lib/nags.ts. */
  nag?: number;
  /** Position assessments and observations: ±, ∞, N, ↑, → and the rest. */
  nags?: number[];
}

export interface MoveTree {
  root: NodeId;
  nodes: Map<NodeId, MoveNode>;
  nextId: number;
  /** True once a real game is loaded: its main line is then immutable. */
  locked: boolean;
}

export const ROOT: NodeId = 0;

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

/**
 * A tree standing on `startFen` - the opening array unless a study chapter or
 * a `[FEN]` header says otherwise.
 *
 * The position is put through chess.js before it is kept, for two reasons.
 * `addMove` builds a board from its parent's FEN outside any try block, so an
 * unparseable root would not fail here, it would throw on the first move
 * played from it. And a position written by hand ("...w KQkq -") is legal
 * shorthand that every later string comparison against a full FEN would miss.
 */
export function createTree(startFen: string = START_FEN): MoveTree {
  let fen = START_FEN;
  try {
    fen = new Chess(startFen).fen();
  } catch {
    /* not a position: stand on the initial array rather than on nothing */
  }

  const root: MoveNode = {
    id: ROOT,
    parent: null,
    children: [],
    san: "",
    uci: "",
    fen,
    ply: -1,
    mainline: true,
    depth: 0,
    source: "game",
  };
  return { root: ROOT, nodes: new Map([[ROOT, root]]), nextId: ROOT + 1, locked: false };
}

/**
 * Build a tree from a PGN's main line and lock it.
 *
 * Only the main line: chess.js reads the moves and discards `( )` blocks
 * entirely, so a PGN with variations arrives here already flattened. That is
 * fine for a played game, which has none. Repertoire PGNs do, and reading
 * those needs a movetext parser of our own - see docs/MOVE_TREE.md §7.
 */
export function fromPgn(pgn: string): MoveTree {
  const g = new Chess();
  try {
    g.loadPgn(pgn);
  } catch {
    return createTree();
  }
  return fromMoves(g.history());
}

/** Build a locked tree from a list of SAN moves. */
export function fromMoves(sans: string[]): MoveTree {
  let tree = createTree();
  let at = ROOT;
  for (const san of sans) {
    const r = addMove(tree, at, san, { source: "game" });
    if (r.id === at) break; // illegal move: keep what parsed
    tree = r.tree;
    at = r.id;
  }
  return { ...tree, locked: true };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function nodeAt(tree: MoveTree, id: NodeId): MoveNode | undefined {
  return tree.nodes.get(id);
}

/** The game: root's children[0] chain, for as long as it stays main line. */
export function mainlinePath(tree: MoveTree): MoveNode[] {
  const out: MoveNode[] = [];
  let cur = tree.nodes.get(tree.root);
  while (cur) {
    const next = cur.children.length ? tree.nodes.get(cur.children[0]) : undefined;
    if (!next || !next.mainline) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** Every move from the root down to `id`, in order. Excludes the root. */
export function lineTo(tree: MoveTree, id: NodeId): MoveNode[] {
  const out: MoveNode[] = [];
  for (let n = tree.nodes.get(id); n && n.parent !== null; n = tree.nodes.get(n.parent)) {
    out.unshift(n);
  }
  return out;
}

/** Follow children[0] from `id` to the end of the line it sits in. */
export function endOfLine(tree: MoveTree, id: NodeId): NodeId {
  let cur = tree.nodes.get(id);
  while (cur?.children.length) {
    const next = tree.nodes.get(cur.children[0]);
    if (!next) break;
    cur = next;
  }
  return cur?.id ?? id;
}

/** The first move of the line `id` belongs to - i.e. where it branched off. */
export function startOfLine(tree: MoveTree, id: NodeId): NodeId {
  let cur = tree.nodes.get(id);
  while (cur && cur.parent !== null) {
    const parent = tree.nodes.get(cur.parent);
    if (!parent || parent.children[0] !== cur.id) return cur.id;
    cur = parent;
  }
  return cur?.id ?? ROOT;
}

/**
 * The nearest ancestor that is still part of the game. What Escape jumps to:
 * four moves into a side line, getting back is otherwise a hunt.
 */
export function nearestMainline(tree: MoveTree, id: NodeId): NodeId {
  for (let n = tree.nodes.get(id); n; n = n.parent === null ? undefined : tree.nodes.get(n.parent)) {
    if (n.mainline || n.parent === null) return n.id;
  }
  return ROOT;
}

/** The alternatives available at this point, `id` among them. */
export function siblings(tree: MoveTree, id: NodeId): NodeId[] {
  const n = tree.nodes.get(id);
  if (!n || n.parent === null) return [];
  return tree.nodes.get(n.parent)?.children ?? [];
}

/** The sibling `step` places away, wrapping. Alt+Up / Alt+Down. */
export function siblingBy(tree: MoveTree, id: NodeId, step: number): NodeId {
  const sibs = siblings(tree, id);
  if (sibs.length < 2) return id;
  const i = sibs.indexOf(id);
  if (i < 0) return id;
  return sibs[(i + step + sibs.length) % sibs.length];
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

function replace(tree: MoveTree, edits: MoveNode[]): MoveTree {
  const nodes = new Map(tree.nodes);
  for (const n of edits) nodes.set(n.id, n);
  return { ...tree, nodes };
}

/**
 * Play `san` from `parentId`.
 *
 * Three rules, in order:
 *
 *  1. Illegal moves change nothing and return where you already were.
 *  2. A move that is already a child of this position IS that child. Walking
 *     forward through the game after exploring re-enters the line you know
 *     rather than forking a duplicate of it, and clicking the same engine
 *     suggestion twice is idempotent.
 *  3. Otherwise the move extends the line if it is the first continuation of
 *     a live main line, and branches if it is not. That one expression is the
 *     whole behaviour: at the end of a free board you are still building a
 *     game; anywhere else - and anywhere at all in a loaded game - you are
 *     asking a question about it.
 */
export function addMove(
  tree: MoveTree,
  parentId: NodeId,
  san: string,
  opts: { source?: MoveSource; evalCp?: number | null } = {}
): { tree: MoveTree; id: NodeId } {
  const parent = tree.nodes.get(parentId);
  if (!parent) return { tree, id: tree.root };

  const g = new Chess(parent.fen);
  let mv;
  try {
    mv = g.move(san);
  } catch {
    return { tree, id: parentId };
  }
  if (!mv) return { tree, id: parentId };

  for (const cid of parent.children) {
    if (tree.nodes.get(cid)?.san === mv.san) return { tree, id: cid };
  }

  const id = tree.nextId;
  const idx = parent.children.length;
  const child: MoveNode = {
    id,
    parent: parentId,
    children: [],
    san: mv.san,
    uci: mv.from + mv.to + (mv.promotion ?? ""),
    fen: g.fen(),
    ply: parent.ply + 1,
    ...rank(tree.locked, parent, idx, opts.source ?? "user"),
    source: opts.source ?? "user",
    evalCp: opts.evalCp ?? null,
  };

  const nextTree = replace({ ...tree, nextId: id + 1 }, [
    { ...parent, children: [...parent.children, id] },
    child,
  ]);
  return { tree: nextTree, id };
}

/** Attach a comment or a NAG to a move. */
export function annotate(
  tree: MoveTree,
  id: NodeId,
  fields: { comment?: string; nag?: number; nags?: number[] }
): MoveTree {
  const n = tree.nodes.get(id);
  if (!n) return tree;
  return replace(tree, [{ ...n, ...fields }]);
}

/** Play a whole line from `parentId`, returning its first move. */
export function addLine(
  tree: MoveTree,
  parentId: NodeId,
  sans: string[],
  opts: { source?: MoveSource; evalCp?: number | null } = {}
): { tree: MoveTree; id: NodeId } {
  let cur = tree;
  let at = parentId;
  let first: NodeId | null = null;
  for (const san of sans) {
    // Only the head of the line carries the score that motivated it.
    const r = addMove(cur, at, san, first === null ? opts : { source: opts.source });
    if (r.id === at) break;
    cur = r.tree;
    at = r.id;
    if (first === null) first = r.id;
  }
  return { tree: cur, id: first ?? parentId };
}

/**
 * Where a node sits: on the game, or how far off it.
 *
 * A locked tree can only ever extend its main line with moves that came from
 * the PGN, which is what stops "resume from here" quietly appending itself to
 * a game that is already over.
 */
function rank(
  locked: boolean,
  parent: MoveNode,
  idx: number,
  source: MoveSource
): { mainline: boolean; depth: number } {
  const mainline = parent.mainline && idx === 0 && (!locked || source === "game");
  if (mainline) return { mainline, depth: parent.depth };
  // Continuing a side line keeps its depth; starting a new one nests.
  const forking = idx > 0 || parent.mainline;
  return { mainline: false, depth: forking ? parent.depth + 1 : parent.depth };
}

/**
 * Recompute mainline/depth for the whole tree from the current child order.
 *
 * Reordering one branch can change the standing of everything beneath it, so
 * after any reorder this walks the tree rather than trying to patch the edge
 * that moved. A few hundred nodes make that free, and it is the only version
 * of this that is obviously correct.
 */
function reindex(tree: MoveTree): MoveTree {
  const nodes = new Map(tree.nodes);
  const walk = (id: NodeId) => {
    // Read the parent back out of `nodes`: its own flags must already be
    // current before its children can be ranked against them.
    const n = nodes.get(id);
    if (!n) return;
    n.children.forEach((cid, idx) => {
      const c = nodes.get(cid);
      if (!c) return;
      const r = rank(tree.locked, n, idx, c.source);
      if (c.mainline !== r.mainline || c.depth !== r.depth) nodes.set(cid, { ...c, ...r });
      walk(cid);
    });
  };
  walk(tree.root);
  return { ...tree, nodes };
}

/** Drop a node and everything under it. Refuses on a locked main line. */
export function deleteSubtree(
  tree: MoveTree,
  id: NodeId
): { tree: MoveTree; id: NodeId } {
  const n = tree.nodes.get(id);
  if (!n || n.parent === null) return { tree, id };
  if (n.mainline && tree.locked) return { tree, id };

  const nodes = new Map(tree.nodes);
  const drop = (nid: NodeId) => {
    const x = nodes.get(nid);
    if (!x) return;
    x.children.forEach(drop);
    nodes.delete(nid);
  };
  drop(id);

  const parent = nodes.get(n.parent)!;
  nodes.set(parent.id, { ...parent, children: parent.children.filter((c) => c !== id) });
  return { tree: reindex({ ...tree, nodes }), id: n.parent };
}

/** Drop every alternative at this point, keeping only the continuation. */
export function clearVariations(tree: MoveTree, id: NodeId): MoveTree {
  const n = tree.nodes.get(id);
  if (!n || n.children.length < 2) return tree;
  let cur = tree;
  for (const cid of n.children.slice(1)) cur = deleteSubtree(cur, cid).tree;
  return cur;
}

/**
 * Move a variation up past the one before it.
 *
 * Never into slot 0 while a main line occupies it - that slot is the game,
 * and this is the reordering a reviewed game is allowed to have.
 */
export function promoteSibling(tree: MoveTree, id: NodeId): MoveTree {
  const n = tree.nodes.get(id);
  if (!n || n.parent === null) return tree;
  const parent = tree.nodes.get(n.parent)!;
  const i = parent.children.indexOf(id);
  if (i < 1) return tree;
  if (i === 1 && tree.nodes.get(parent.children[0])?.mainline) return tree;

  const children = [...parent.children];
  [children[i - 1], children[i]] = [children[i], children[i - 1]];
  return reindex(replace(tree, [{ ...parent, children }]));
}

/**
 * Make this line the main line. Only on a tree with no server review to
 * invalidate - see the invariant at the top of this file.
 */
export function promoteToMainline(tree: MoveTree, id: NodeId): MoveTree {
  if (tree.locked) return tree;
  const edits = new Map<NodeId, MoveNode>();
  // Walk to the root, moving each step of the path into its parent's slot 0.
  for (let cur = tree.nodes.get(id); cur; ) {
    const parentId = cur.parent;
    if (parentId === null) break;
    const child = cur;
    const parent = edits.get(parentId) ?? tree.nodes.get(parentId);
    if (!parent) break;
    if (parent.children[0] !== child.id) {
      edits.set(parent.id, {
        ...parent,
        children: [child.id, ...parent.children.filter((c) => c !== child.id)],
      });
    }
    cur = tree.nodes.get(parent.id);
  }
  return edits.size ? reindex(replace(tree, [...edits.values()])) : tree;
}

export function canPromoteToMainline(tree: MoveTree, id: NodeId): boolean {
  const n = tree.nodes.get(id);
  return !tree.locked && !!n && n.parent !== null && !n.mainline;
}

/** Drop everything played after this position, keeping the position itself. */
export function truncateAfter(tree: MoveTree, id: NodeId): MoveTree {
  const n = tree.nodes.get(id);
  if (!n) return tree;
  let cur = tree;
  // Back to front, so deleting one child never shifts the next one's slot.
  for (const cid of [...n.children].reverse()) cur = deleteSubtree(cur, cid).tree;
  return cur;
}

/**
 * Every comment, mark and drawing taken off, the moves left alone.
 *
 * What "remove annotations" does in a database program before a game is
 * shared as bare moves, or re-annotated from scratch.
 */
export function stripAnnotations(tree: MoveTree): MoveTree {
  const nodes = new Map(tree.nodes);
  for (const [id, n] of nodes) {
    if (n.comment || n.nag != null || n.nags?.length) {
      nodes.set(id, { ...n, comment: undefined, nag: undefined, nags: undefined });
    }
  }
  return { ...tree, nodes };
}

/**
 * Pour `other` into `tree`: every line of it played from the same start, the
 * moves `tree` already has reused, the ones it lacks added as variations.
 *
 * This is how a pile of games becomes one opening tree - ChessBase calls it
 * merging games. Annotations travel with the moves, but never overwrite one
 * already there: the tree being merged into is the one whose author you are.
 *
 * Both must stand on the same position; a game from another start is not a
 * line of this tree, and is refused by returning `tree` unchanged.
 */
export function mergeTree(tree: MoveTree, other: MoveTree): MoveTree {
  const ownRoot = tree.nodes.get(tree.root);
  const theirRoot = other.nodes.get(other.root);
  if (!ownRoot || !theirRoot) return tree;
  if (ownRoot.fen.split(" ").slice(0, 4).join(" ") !== theirRoot.fen.split(" ").slice(0, 4).join(" ")) {
    return tree;
  }

  let out = tree;
  // Pairs of (their node, our node standing on the same position).
  const stack: [NodeId, NodeId][] = [[other.root, tree.root]];
  while (stack.length) {
    const [theirs, ours] = stack.pop()!;
    const from = other.nodes.get(theirs);
    if (!from) continue;
    for (const cid of from.children) {
      const child = other.nodes.get(cid);
      if (!child) continue;
      const r = addMove(out, ours, child.san, { source: "user" });
      if (r.id === ours) continue; // not a legal move here after all
      out = r.tree;
      const landed = out.nodes.get(r.id)!;
      const fields: { comment?: string; nag?: number; nags?: number[] } = {};
      if (!landed.comment && child.comment) fields.comment = child.comment;
      if (landed.nag == null && child.nag != null) fields.nag = child.nag;
      if (!landed.nags?.length && child.nags?.length) fields.nags = child.nags;
      if (Object.keys(fields).length) out = annotate(out, r.id, fields);
      stack.push([cid, r.id]);
    }
  }
  return out;
}
