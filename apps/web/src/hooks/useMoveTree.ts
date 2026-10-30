"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import {
  MoveNode,
  MoveSource,
  MoveTree,
  NodeId,
  ROOT,
  addLine,
  addMove,
  annotate,
  canPromoteToMainline,
  createTree,
  deleteSubtree,
  endOfLine,
  lineTo,
  mainlinePath,
  mergeTree,
  nearestMainline,
  nodeAt,
  promoteSibling,
  promoteToMainline,
  siblingBy,
  startOfLine,
  stripAnnotations,
  truncateAfter,
} from "@/lib/moveTree";
import { Row, renderTree } from "@/lib/moveTreeRender";
import { toggleGlyph as toggleGlyphOn } from "@/lib/nags";
import { parsePgn, toMovetext, toPgn } from "@/lib/pgn";
import { Shape, joinComment, splitComment } from "@/lib/shapes";
import { loadTree, saveTree } from "@/lib/treeStorage";

/**
 * The move tree as the workspace uses it: state, navigation, and the handful
 * of derived values the rest of the board still wants in the old shape.
 *
 * `history` and `cursorPly` are the bridge. The review was built against a
 * flat list of the game's moves keyed by ply, and it stays that way - the main
 * line IS that list, so `ReviewPanel`, the annotation alignment check and the
 * eval curve keep receiving exactly what they received before the tree
 * existed, and none of them need to know it does.
 */
export interface MoveTreeApi {
  tree: MoveTree;
  rows: Row[];
  cursorId: NodeId;
  node: MoveNode;
  fen: string;

  /** The game's moves, in order. What the review is keyed against. */
  history: string[];
  /** Each main-line move's UCI, indexed by ply - for checking review rows. */
  mainUci: string[];
  /** True when the cursor is on the game rather than off in a side line. */
  onMainline: boolean;
  /** The old cursor: 0 at the start, N after N moves. -1 when off the game. */
  cursorPly: number;
  /** The move that led to the current position. */
  lastMove?: { from: Square; to: Square };
  /** Alternatives to the current move, the current one among them. */
  alternatives: NodeId[];
  /** The PGN's own tag pairs - who played it, the result, the event. */
  headers: Record<string, string>;

  /** What was written about the move under the cursor, shapes stripped out. */
  comment: string;
  /** Arrows and circles drawn on the position under the cursor. */
  shapes: Shape[];
  /** True when this line may be made the main line - never on a played game. */
  canPromote: boolean;

  seek: (id: NodeId) => void;
  seekPly: (ply: number) => void;
  play: (from: string, to: string) => boolean;
  /** Play a line on from here - what an engine PV for this position is. */
  playLine: (sans: string[], opts?: { source?: MoveSource; evalCp?: number | null }) => void;
  /** Play a line *instead of* the move you are looking at. What "best was X" means. */
  playInstead: (sans: string[], opts?: { source?: MoveSource; evalCp?: number | null }) => void;

  back: () => void;
  next: () => void;
  toStart: () => void;
  toEnd: () => void;
  nextAlternative: (step: number) => void;
  backToGame: () => void;
  removeLine: () => void;
  raiseLine: () => void;
  /** Make the line under the cursor the main one. No-op on a played game. */
  promoteLine: () => void;

  /** Write about a move. Whatever is drawn on it is left alone. */
  setComment: (id: NodeId, text: string) => void;
  /** Redraw a position. Whatever was written about it is left alone. */
  setShapes: (id: NodeId, shapes: Shape[]) => void;
  /** !, ?, !! and the rest. `undefined` takes the mark off. */
  setNag: (id: NodeId, nag: number | undefined) => void;
  /**
   * Put a glyph on a move or take it off, with the palette's rules: one move
   * mark, one position assessment, any number of observations. lib/nags.ts.
   */
  toggleGlyph: (id: NodeId, nag: number) => void;

  /** Drop every move played after the current position. */
  truncate: () => void;
  /** Take every comment, glyph and drawing off the whole tree. */
  clearAnnotations: () => void;
  /**
   * Replace the board with a pasted position or game. A FEN sets up an empty
   * board on that position; anything else is read as PGN. False when the text
   * is neither, and the board is left as it was.
   */
  load: (text: string) => boolean;
  /** Pour other games in as variations. Returns how many were merged. */
  merge: (pgns: string[]) => number;

  /** The game and every line off it, as PGN anything else can read. */
  exportPgn: (headers?: Record<string, string>) => string;
  /** The same moves with no tag pairs - what a study chapter stores. */
  exportMovetext: () => string;
  /** Only the line from the start to the current move, as movetext. */
  lineMovetext: () => string;
}

export interface MoveTreeOptions {
  /**
   * Let the main line be extended and reordered.
   *
   * A played game is locked: its main line IS the game, and the review is
   * keyed against it (see the invariant at the top of moveTree.ts). A study
   * chapter has no review and no game behind it - the main line is whatever
   * its author decided it is, and they are still deciding.
   */
  unlocked?: boolean;
  /** The position the tree stands on, when the caller knows better than the PGN. */
  startFen?: string;
  /**
   * Called on a debounce with the movetext, whenever the tree has changed.
   * Never on hydration, and never for a cursor move - neither writes anything
   * a reader of the saved chapter would see.
   */
  onPersist?: (movetext: string) => void;
}

/** Long enough that walking a line does not write once per move. */
const SAVE_AFTER_MS = 600;

export function useMoveTree(
  initialPgn?: string,
  storageKey?: string,
  options: MoveTreeOptions = {}
): MoveTreeApi {
  const { unlocked, startFen, onPersist } = options;

  const [tree, setTree] = useState<MoveTree>(() => parsePgn(initialPgn ?? "", startFen).tree);
  const [cursorId, setCursorId] = useState<NodeId>(ROOT);
  const [headers, setHeaders] = useState<Record<string, string>>({});
  // Nothing may be written back before the saved lines have had their chance
  // to load, or the first render would overwrite them with the bare game.
  const hydrated = useRef(false);

  // The tree as the server last saw it, by identity. Every edit produces a new
  // object and every navigation reuses the old one, so this distinguishes the
  // two without diffing - and skips the save that hydration would otherwise
  // fire immediately, writing the chapter back over itself on every open.
  const persisted = useRef<MoveTree | null>(null);

  // Held in a ref so a caller that rebuilds the callback each render does not
  // restart the debounce on every render and never reach the timeout.
  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;

  useEffect(() => {
    const parsed = parsePgn(initialPgn ?? "", startFen);
    const saved = storageKey
      ? loadTree(storageKey, mainlinePath(parsed.tree).map((n) => n.san))
      : null;

    const next = saved?.tree ?? parsed.tree;
    const adopted = unlocked ? { ...next, locked: false } : next;

    setHeaders(parsed.headers);
    setTree(adopted);
    setCursorId(saved?.cursorId ?? ROOT);
    persisted.current = adopted;
    hydrated.current = true;
  }, [initialPgn, storageKey, startFen, unlocked]);

  useEffect(() => {
    if (!storageKey || !hydrated.current) return;
    const timer = setTimeout(() => saveTree(storageKey, tree, cursorId), SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [storageKey, tree, cursorId]);

  useEffect(() => {
    if (!hydrated.current || persisted.current === tree) return;
    const timer = setTimeout(() => {
      persisted.current = tree;
      persistRef.current?.(toMovetext(tree));
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [tree]);

  const main = useMemo(() => mainlinePath(tree), [tree]);
  const rows = useMemo(() => renderTree(tree), [tree]);
  const history = useMemo(() => main.map((n) => n.san), [main]);
  const mainUci = useMemo(() => main.map((n) => n.uci), [main]);

  /**
   * The node an id names, or the root when it names nothing. A cursor can
   * outlive the node it points at - a restored one whose line no longer
   * replays, a deleted subtree - and the board draws the root in that case, so
   * walking has to start from the same place the board is showing.
   */
  const at = useCallback(
    (id: NodeId) => nodeAt(tree, id) ?? nodeAt(tree, tree.root)!,
    [tree]
  );

  const node = at(cursorId);
  const onMainline = node.mainline;

  const lastMove = useMemo(
    () =>
      node.uci
        ? { from: node.uci.slice(0, 2) as Square, to: node.uci.slice(2, 4) as Square }
        : undefined,
    [node]
  );

  const alternatives = useMemo(() => {
    if (node.parent === null) return [];
    return nodeAt(tree, node.parent)?.children ?? [];
  }, [tree, node]);

  const seek = useCallback((id: NodeId) => setCursorId(id), []);

  /** Ply 0 is the start position; ply k is after the game's kth move. */
  const seekPly = useCallback(
    (ply: number) => setCursorId(ply <= 0 ? ROOT : (main[ply - 1]?.id ?? ROOT)),
    [main]
  );

  const play = useCallback(
    (from: string, to: string) => {
      const g = new Chess(node.fen);
      let mv;
      try {
        mv = g.move({ from, to, promotion: "q" });
      } catch {
        return false;
      }
      if (!mv) return false;
      const r = addMove(tree, node.id, mv.san, { source: "user" });
      setTree(r.tree);
      setCursorId(r.id);
      return true;
    },
    [tree, node]
  );

  const playLine = useCallback(
    (sans: string[], opts: { source?: MoveSource; evalCp?: number | null } = {}) => {
      const r = addLine(tree, node.id, sans, { source: "engine", ...opts });
      setTree(r.tree);
      setCursorId(r.id);
    },
    [tree, node]
  );

  // The move the engine wanted is a rival to the move you played, so it hangs
  // off the position *before* it - alongside what actually happened, not after.
  const playInstead = useCallback(
    (sans: string[], opts: { source?: MoveSource; evalCp?: number | null } = {}) => {
      const r = addLine(tree, node.parent ?? ROOT, sans, { source: "engine", ...opts });
      setTree(r.tree);
      setCursorId(r.id);
    },
    [tree, node]
  );

  /*
   * Walking the tree only ever moves the cursor, so each of these asks for the
   * next id from the one React is holding rather than from one read during a
   * render. Two things fall out of that, and both matter when an arrow key is
   * held down - which is how anyone reads through a game.
   *
   * A step that cannot be taken returns the id it was given, so React drops the
   * update instead of committing a render that changes nothing. Forward at the
   * end of a line is then free, however long you lean on the key.
   *
   * And because they close over the tree alone, they keep their identity while
   * the cursor moves. `AnalysisBoard` hangs them off a window listener; being
   * rebuilt on every step had that listener torn down and re-added between key
   * repeats, and the renders that piled up behind it are what eventually
   * tripped React's nested-update limit.
   */
  const back = useCallback(() => setCursorId((id) => at(id).parent ?? ROOT), [at]);

  // Forward continues the line you are standing in, not the game. Inside a
  // variation that is the only thing that makes it walkable.
  const next = useCallback(() => setCursorId((id) => at(id).children[0] ?? id), [at]);

  const toStart = useCallback(
    () =>
      setCursorId((id) => {
        // From within a side line, the first stop is that line's own beginning.
        const head = startOfLine(tree, id);
        return head === id || id === ROOT ? ROOT : head;
      }),
    [tree]
  );

  const toEnd = useCallback(() => setCursorId((id) => endOfLine(tree, id)), [tree]);

  const nextAlternative = useCallback(
    (step: number) => setCursorId((id) => siblingBy(tree, id, step)),
    [tree]
  );

  const backToGame = useCallback(
    () => setCursorId((id) => nearestMainline(tree, id)),
    [tree]
  );

  const removeLine = useCallback(() => {
    const r = deleteSubtree(tree, cursorId);
    setTree(r.tree);
    setCursorId(r.id);
  }, [tree, cursorId]);

  const raiseLine = useCallback(() => setTree(promoteSibling(tree, cursorId)), [tree, cursorId]);

  const promoteLine = useCallback(
    () => setTree((t) => promoteToMainline(t, cursorId)),
    [cursorId]
  );

  /*
   * Prose and shapes share one field.
   *
   * PGN keeps both in the move's comment - `{the plan [%cal Gd2d4]}` - and so
   * do we, because that is what makes a chapter open in Lichess with its
   * arrows on. The cost is that writing either one has to preserve the other,
   * which is what these two do: each reads the comment apart, replaces its own
   * half, and puts it back together.
   */
  const setComment = useCallback((id: NodeId, text: string) => {
    setTree((t) => {
      const n = nodeAt(t, id);
      if (!n) return t;
      const { shapes } = splitComment(n.comment);
      return annotate(t, id, { comment: joinComment(text, shapes) });
    });
  }, []);

  const setShapes = useCallback((id: NodeId, shapes: Shape[]) => {
    setTree((t) => {
      const n = nodeAt(t, id);
      if (!n) return t;
      const { text } = splitComment(n.comment);
      return annotate(t, id, { comment: joinComment(text, shapes) });
    });
  }, []);

  const setNag = useCallback((id: NodeId, nag: number | undefined) => {
    setTree((t) => (nodeAt(t, id) ? annotate(t, id, { nag }) : t));
  }, []);

  const toggleGlyph = useCallback((id: NodeId, nag: number) => {
    setTree((t) => {
      const n = nodeAt(t, id);
      return n ? annotate(t, id, toggleGlyphOn(n, nag)) : t;
    });
  }, []);

  const truncate = useCallback(() => setTree((t) => truncateAfter(t, cursorId)), [cursorId]);

  const clearAnnotations = useCallback(() => setTree((t) => stripAnnotations(t)), []);

  const load = useCallback(
    (text: string) => {
      const pasted = text.trim();
      if (!pasted) return false;

      // A FEN is one line of six fields with seven slashes in the first. Tried
      // first, because a FEN is also valid-looking garbage to the PGN reader,
      // which would come back with an empty tree and call that a success.
      const fields = pasted.split(/\s+/);
      if (!pasted.includes("[") && fields[0]?.split("/").length === 8) {
        try {
          const fen = new Chess(pasted).fen();
          setTree(createTree(fen));
          setHeaders({});
          setCursorId(ROOT);
          return true;
        } catch {
          return false;
        }
      }

      const parsed = parsePgn(pasted);
      if (parsed.tree.nodes.size < 2 && !parsed.headers.FEN) return false;
      setTree(unlocked ? { ...parsed.tree, locked: false } : parsed.tree);
      setHeaders(parsed.headers);
      setCursorId(ROOT);
      return true;
    },
    [unlocked]
  );

  const merge = useCallback(
    (pgns: string[]) => {
      let merged = 0;
      let next = tree;
      const startFen = nodeAt(tree, tree.root)?.fen;
      for (const pgn of pgns) {
        const other = parsePgn(pgn, startFen).tree;
        if (other.nodes.size < 2) continue;
        const out = mergeTree(next, other);
        if (out !== next) merged++;
        next = out;
      }
      setTree(next);
      return merged;
    },
    [tree]
  );

  const written = useMemo(() => splitComment(node.comment), [node.comment]);

  const exportPgn = useCallback(
    (extra: Record<string, string> = {}) => toPgn(tree, { ...headers, ...extra }),
    [tree, headers]
  );

  const exportMovetext = useCallback(() => toMovetext(tree), [tree]);

  const lineMovetext = useCallback(() => {
    const root = nodeAt(tree, tree.root)!;
    const line = addLine(createTree(root.fen), ROOT, lineTo(tree, cursorId).map((n) => n.san));
    return toMovetext(line.tree);
  }, [tree, cursorId]);

  // Handed out as one value that only changes when something in it did. The
  // board keeps this in effect dependencies - a fresh object per render meant
  // those effects re-ran on every engine message and every panel update, none
  // of which move the cursor.
  return useMemo(
    () => ({
      tree,
      rows,
      cursorId,
      node,
      fen: node.fen,
      history,
      mainUci,
      onMainline,
      cursorPly: onMainline ? node.ply + 1 : -1,
      lastMove,
      alternatives,
      headers,
      comment: written.text,
      shapes: written.shapes,
      canPromote: canPromoteToMainline(tree, cursorId),
      seek,
      seekPly,
      play,
      playLine,
      playInstead,
      back,
      next,
      toStart,
      toEnd,
      nextAlternative,
      backToGame,
      removeLine,
      raiseLine,
      promoteLine,
      setComment,
      setShapes,
      setNag,
      toggleGlyph,
      truncate,
      clearAnnotations,
      load,
      merge,
      exportPgn,
      exportMovetext,
      lineMovetext,
    }),
    [
      tree,
      rows,
      cursorId,
      node,
      history,
      mainUci,
      onMainline,
      lastMove,
      alternatives,
      headers,
      written,
      seek,
      seekPly,
      play,
      playLine,
      playInstead,
      back,
      next,
      toStart,
      toEnd,
      nextAlternative,
      backToGame,
      removeLine,
      raiseLine,
      promoteLine,
      setComment,
      setShapes,
      setNag,
      toggleGlyph,
      truncate,
      clearAnnotations,
      load,
      merge,
      exportPgn,
      exportMovetext,
      lineMovetext,
    ]
  );
}
