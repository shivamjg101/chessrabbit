"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useEngine } from "@/hooks/useEngine";
import { useClickToMove } from "@/hooks/useClickToMove";
import { useMoveTree } from "@/hooks/useMoveTree";
import { usePositionEvals } from "@/hooks/usePositionEvals";
import { useShapeDrawing } from "@/hooks/useShapeDrawing";
import { useSquareSize } from "@/hooks/useSquareSize";
import Link from "next/link";
import { Annotation, api, ApiError, ExplorerMove, ExplorerScope, ReviewSummary } from "@/lib/api";
import { CLASS_META, headline } from "@/lib/classification";
import { bestSanAt, explainMove, formatCp, liveVerdicts, sanLine } from "@/lib/liveEval";
import { endOfLine, lineTo, nodeAt } from "@/lib/moveTree";
import { Shape } from "@/lib/shapes";
import { BOARD_FRAME, useBoardTheme } from "@/lib/boardTheme";
import { settleExplorerRequest } from "@/lib/explorerRequest";
import { updateSettings, useSettings } from "@/lib/settings";
import ReviewPanel from "@/components/ReviewPanel";
import VerdictPlate from "@/components/VerdictPlate";
import BlunderIndex from "@/components/BlunderIndex";
import BoardShapes from "@/components/BoardShapes";
import NotesPane from "@/components/NotesPane";
import EvalBar from "@/components/EvalBar";
import PlayerPlate, { GamePlayers, scoreOf } from "@/components/PlayerPlate";
import MoveList from "@/components/MoveList";
import EnginePane from "@/components/EnginePane";
import ExplorerPane from "@/components/ExplorerPane";

/** Both rails of the wooden surround the board is seated in. */
const FRAME = 2 * BOARD_FRAME;

/** Eval bar width + the gap between it and the board, plus the frame. */
const BOARD_GUTTER = 28 + FRAME;

/**
 * Height the two player plates take out of the board's square: two 32px rows
 * plus the 6px gap each keeps from the frame, plus the frame's own two rails.
 * Reserved rather than measured, so the board is sized once instead of settling
 * in a second pass.
 */
const PLATE_STACK = 2 * 32 + 2 * 6 + FRAME;

/**
 * The Clipboard API wants a secure context and a live user gesture, and
 * refuses outright in an iframe without permission - so the deprecated path
 * stays as a fallback, and the caller is told when both refuse rather than
 * being left to wonder why the button did nothing.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the old way */
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(box);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Holding an arrow key walks the game faster than any of this can answer.
 * Waiting for the cursor to settle turns a 40-request burst into one request,
 * and spares the engine 40 abandoned searches.
 */
const SETTLE_MS = 220;

/** Positions keep coming back to the same openings; remembering them makes
    stepping backwards through a game instant. */
const EXPLORER_CACHE_MAX = 300;

/**
 * How many unevaluated positions one line may pull from the engine.
 *
 * A line you tried is worth scoring in full - that is the whole point of
 * trying it. A cap still matters: without one, standing in a forty-move
 * exploration would quietly queue a full game review's worth of search.
 */
const SWEEP_MAX = 40;

/** Fixed, so the board is not handed a new style object on every render. */
const NOTATION_STYLE = { fontSize: "10px", fontWeight: "600" };

/**
 * Engine arrows. Teal rather than the green used for primary actions: an arrow
 * is drawn over wooden squares, and it must not be mistaken for the board's
 * own last-move highlight. Matches `accent2` in the Tailwind palette.
 */
const ARROW_COLOR = "#8B7BE8";

type Tab = "report" | "moves" | "engine" | "book" | "notes";

const TABS: { id: Tab; label: string }[] = [
  { id: "report", label: "Report" },
  { id: "moves", label: "Moves" },
  { id: "engine", label: "Engine" },
  { id: "book", label: "Book" },
];

/**
 * A study has no game review to show — nothing was played and nothing was
 * scored — so Notes takes the slot, which is what the tab is for there anyway.
 */
const STUDY_TABS: { id: Tab; label: string }[] = [
  { id: "notes", label: "Notes" },
  ...TABS.filter((t) => t.id !== "report"),
];

/**
 * Authoring a study chapter rather than reading back a game.
 *
 * Three things change. The main line stops being immutable — a chapter has no
 * game behind it, so its main line is whatever its author is still deciding it
 * is. The tree is written to the server instead of to localStorage. And Notes
 * joins the tabs, because in a study the point is what you write, not what the
 * engine says.
 */
export interface StudyMode {
  /** The chapter's own start position, which its PGN body does not carry. */
  startFen?: string;
  orientation?: "white" | "black";
  /** Somebody else's study, opened from a share link. */
  readOnly?: boolean;
  /** Debounced, with the chapter's movetext, whenever the tree changes. */
  onPersist?: (movetext: string) => void;
  /** What the panel header says about the last save. */
  status?: string | null;
}

interface Props {
  initialPgn?: string;
  gameLabel?: string;
  gameId?: number;
  initialAnnotations?: Annotation[];
  /** Ply count from the server's parse — the fallback alignment check. */
  expectedPlies?: number;
  /** Who played it, for the plates above and below the board. */
  players?: GamePlayers;
  /** Set when the board is a study chapter. Absent for a game or free play. */
  study?: StudyMode;
}

export default function AnalysisBoard({
  initialPgn,
  gameLabel,
  gameId,
  initialAnnotations,
  expectedPlies,
  players,
  study,
}: Props) {
  // The tree is the authoritative position: the game, plus every line tried
  // instead of it. Its main line is the game, which is what lets the review
  // below go on keying itself by ply.
  //
  // Lines are kept per game, so reopening one from the rail brings back what
  // you found in it. A pasted PGN with no game behind it has no stable name to
  // file them under, so it gets none; the empty board is its own scratch pad.
  //
  // A study chapter is stored on the server, so it takes no key here: two
  // stores for one chapter is one store too many, and the local copy would be
  // the one that wins on the machine that had it.
  const editable = !!study && !study.readOnly;
  const storageKey = study
    ? undefined
    : gameId != null
      ? `game:${gameId}`
      : initialPgn
        ? undefined
        : "scratch";

  // A fresh object each render is fine: the hook reads the primitives out of
  // it and holds the callback in a ref, so nothing here restarts its effects.
  const mt = useMoveTree(initialPgn, storageKey, {
    unlocked: editable,
    startFen: study?.startFen,
    onPersist: editable ? study?.onPersist : undefined,
  });
  const { history, fen, cursorId, onMainline } = mt;

  const [copied, setCopied] = useState<"done" | "failed" | null>(null);

  const [orientation, setOrientation] = useState<"white" | "black">(
    study?.orientation ?? "white"
  );
  const [explorer, setExplorer] = useState<ExplorerMove[]>([]);
  const [explorerTotal, setExplorerTotal] = useState(0);
  const [explorerScope, setExplorerScope] = useState<ExplorerScope>("reference");
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerRefresh, setExplorerRefresh] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  // Review is about a game the engine went through. A study has neither, so it
  // opens on the moves — which is the thing a chapter actually is.
  const [tab, setTab] = useState<Tab>(study ? "moves" : "report");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const explorerCache = useRef(new Map<string, { moves: ExplorerMove[]; total: number }>());
  const explorerAbort = useRef<AbortController | null>(null);

  const engine = useEngine();
  const settings = useSettings();
  const { evalAt, record: recordEval } = usePositionEvals(settings.engine);
  const skin = useBoardTheme();
  const autoAnalyse = settings.autoAnalyse;

  // The board is sized to the space it is given, so it fills the viewport
  // height on a desktop instead of sitting in a fixed-width box. The plates
  // stacked above and below it are part of that space.
  const [stageRef, boardSize] = useSquareSize(BOARD_GUTTER, PLATE_STACK);

  /**
   * Arrows and circles drawn on the position, kept on the move itself.
   *
   * Available on any board you can write to, not only inside a study: they
   * ride in the move's comment, which the tree already persists and exports
   * everywhere it goes. Only a study opened read-only refuses them.
   */
  const boardReadOnly = study?.readOnly ?? false;
  const setShapes = mt.setShapes;
  const onShapes = useCallback(
    (next: Shape[]) => setShapes(cursorId, next),
    [setShapes, cursorId]
  );
  const drawing = useShapeDrawing({
    orientation,
    shapes: mt.shapes,
    onChange: onShapes,
    disabled: boardReadOnly,
  });

  // A chapter states which way round it is meant to be read. Following it here
  // rather than only at mount means switching chapters actually turns the
  // board, instead of leaving you looking at the wrong side of the position.
  const chapterOrientation = study?.orientation;
  useEffect(() => {
    if (chapterOrientation) setOrientation(chapterOrientation);
  }, [chapterOrientation, initialPgn]);

  // Adopt annotations (and stop any stale poll) when a different game loads
  useEffect(() => {
    setAnnotations(initialAnnotations ?? []);
    setReviewSummary(null);
    setReviewing(false);
    if (pollRef.current) clearInterval(pollRef.current);
  }, [gameId, initialAnnotations]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const runReview = useCallback(async () => {
    if (!gameId || reviewing) return;
    setReviewing(true);
    setReviewNotice(null);
    try {
      const { job_id } = await api.analyseGame(gameId, settings.engine, settings.depth);
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.getJob(job_id);
          if (job.status === "done" || job.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setReviewing(false);
            if (job.status === "done" && job.result) {
              setReviewSummary(job.result as ReviewSummary);
              const detail = await api.getGame(gameId);
              setAnnotations(detail.annotations);
            }
          }
        } catch {
          /* transient poll error - keep polling */
        }
      }, 2000);
    } catch (err) {
      setReviewNotice(err instanceof ApiError ? err.message : "Review could not start");
      setReviewing(false);
    }
  }, [gameId, reviewing, settings.engine, settings.depth]);


  /**
   * Keep only the annotations that provably describe the move we hold.
   *
   * Annotations are keyed by ply index against a move list the browser
   * re-derives by parsing the PGN, while the server keyed them against its own
   * parse. If the two disagree by even one move, every badge, headline and
   * arrow after that point silently describes a different move — which is how
   * a review once announced "d4 is a blunder" directly above "Best was d4".
   *
   * Each row now carries the move it reviews, so alignment is checked per ply
   * rather than assumed. Rows predating migration 011 have no move recorded;
   * for those we fall back to comparing the whole-game ply count, which catches
   * a diverged parse without being able to pinpoint it.
   *
   * The check runs against the tree's main line, never against a variation:
   * the main line is the game the server reviewed, and a line you invented
   * has no review to be aligned with in the first place.
   */
  const { annByPly, mismatched } = useMemo(() => {
    const m = new Map<number, Annotation>();
    let bad = 0;

    // Only meaningful once the PGN has been read into the main line.
    const countAgrees =
      expectedPlies == null || history.length === 0 || history.length === expectedPlies;

    for (const a of annotations) {
      if (!a.classification) continue;
      const played = mt.mainUci[a.ply];

      if (a.move_uci) {
        // No move at this ply means the row describes a game we do not have.
        // from+to is enough: a promotion suffix cannot change which move it is.
        if (!played || a.move_uci.slice(0, 4) !== played.slice(0, 4)) {
          bad++;
          continue;
        }
      } else if (!countAgrees) {
        bad++;
        continue;
      }
      m.set(a.ply, a);
    }
    return { annByPly: m, mismatched: bad };
  }, [annotations, mt.mainUci, expectedPlies, history.length]);

  const hasReview = annByPly.size > 0;

  /**
   * Write down what the engine finds, position by position.
   *
   * Nothing here asks the engine for extra work: these are the same searches
   * the board already runs as the cursor moves. Keeping the answers is the
   * whole trick - it turns walking a line into an evaluation of every position
   * in it, which is what a line you invented needs to earn a verdict.
   *
   * Keyed off `engine.fen`, never off the board: for a moment after a move the
   * lines still describe where you just were, and filing them against the new
   * position would score every move with its predecessor's evaluation.
   */
  useEffect(() => {
    if (engine.fen && engine.engineId === settings.engine) recordEval(engine.fen, engine.lines[0]);
  }, [engine.fen, engine.engineId, engine.lines, settings.engine, recordEval]);

  /** A verdict for every move we hold the score on both sides of. */
  const liveByNode = useMemo(() => liveVerdicts(mt.tree, evalAt), [mt.tree, evalAt]);

  /**
   * The engine's own account of the move under the cursor.
   *
   * Written for one move rather than all of them: the prose costs a couple of
   * board replays to name the piece and read the reply, which is nothing once
   * and wasteful across a whole tree that nobody is looking at.
   */
  const liveCallout = useMemo(() => {
    const node = mt.node;
    if (node.parent === null) return null;
    const verdict = liveByNode.get(node.id);
    const parent = nodeAt(mt.tree, node.parent);
    if (!verdict || !parent) return null;

    const before = evalAt(parent.fen);
    const after = evalAt(node.fen);
    if (!before || !after) return null;

    return {
      san: node.san,
      cls: verdict.cls,
      cp: verdict.cp,
      why: explainMove({
        cls: verdict.cls,
        before,
        after,
        beforeFen: parent.fen,
        afterFen: node.fen,
        playedUci: node.uci,
        // Ply 0 is White's first move, so even plies are White's throughout.
        whiteMoved: node.ply % 2 === 0,
      }),
      bestSan: bestSanAt(parent.fen, before),
    };
  }, [mt.node, mt.tree, liveByNode, evalAt]);

  /**
   * The positions in the line you are standing in that nobody has scored yet.
   *
   * A verdict needs the score on both sides of a move, so a line that arrives
   * all at once - an engine PV put on the board, a "best was X" - starts with
   * a badge on its first move and nothing after it. Walking it would fill it
   * in eventually; sweeping it does the same thing without making you walk.
   *
   * Only moves off the game are swept. The main line already has a review, or
   * can be given one for the price of a button, and quietly analysing all
   * ninety plies of it because the cursor is sitting there is not something
   * anybody asked for.
   */
  const sweepQueue = useMemo(() => {
    const path = lineTo(mt.tree, endOfLine(mt.tree, cursorId));
    const out: string[] = [];
    let entered = false;

    for (const n of path) {
      if (n.mainline) continue;
      if (!entered) {
        entered = true;
        // The position the line branched from is what its first move is
        // measured against, so it has to be scored too.
        const parent = n.parent === null ? null : nodeAt(mt.tree, n.parent);
        if (parent && !evalAt(parent.fen)) out.push(parent.fen);
      }
      if (!evalAt(n.fen)) out.push(n.fen);
      if (out.length >= SWEEP_MAX) break;
    }
    return out;
  }, [mt.tree, cursorId, evalAt]);

  // A position the engine has already been asked about is never asked again,
  // even if it came back with nothing - otherwise one unanswerable position
  // would have the sweep retrying it for as long as you stood there.
  const swept = useRef(new Set<string>());
  const engineAnalyse = engine.analyse;

  useEffect(() => {
    if (!autoAnalyse || !engine.connected || engine.thinking) return;
    // The position you are actually looking at is answered first, always.
    if (!evalAt(fen)) return;

    const next = sweepQueue.find((f) => !swept.current.has(f));
    if (!next) return;

    swept.current.add(next);
    // One line is all a score needs, and it is the cheapest thing to ask for.
    engineAnalyse(next, settings.depth, 1, settings.engine);
  }, [
    sweepQueue,
    autoAnalyse,
    engine.connected,
    engine.thinking,
    fen,
    evalAt,
    settings.depth,
    settings.engine,
    engineAnalyse,
  ]);

  /** Moves that exist only because you went looking - the root is not one. */
  const exploredMoves = mt.tree.nodes.size - 1 - history.length;

  // The move that led here is highlighted wherever it was played; only a move
  // of the game itself carries a verdict.
  const reviewedMove = mt.lastMove;
  const currentAnn = onMainline && mt.cursorPly > 0 ? annByPly.get(mt.node.ply) : undefined;
  const reviewedClass = currentAnn?.classification;

  /**
   * What to say about the move under the cursor, whoever judged it. The
   * server's review wins wherever it has one; the live engine fills silences -
   * an unreviewed game, or any move in a line you tried.
   */
  const currentWhy = currentAnn?.classification
    ? {
        cls: currentAnn.classification,
        san: currentAnn.move_san ?? mt.node.san,
        why: currentAnn.review,
        score: currentAnn.eval_cp != null ? formatCp(currentAnn.eval_cp) : null,
        live: false,
      }
    : liveCallout
      ? {
          cls: liveCallout.cls,
          san: liveCallout.san,
          why: liveCallout.why,
          score: formatCp(liveCallout.cp),
          live: true,
        }
      : null;

  /**
   * The move the engine wanted, as SAN, for the verdict plate's "show me".
   *
   * ReviewPanel worked this out for itself when the callout lived inside it.
   * The callout is a fixed plate now, so the derivation moves up here — one
   * copy, from the position BEFORE the move was played, which is the position
   * the recommendation was made in.
   */
  const currentBestSan = useMemo(() => {
    if (liveCallout) return liveCallout.bestSan;
    const uci = currentAnn?.best_uci;
    if (!uci || mt.cursorPly === 0) return null;
    const parent = nodeAt(mt.tree, mt.node.parent ?? mt.tree.root);
    if (!parent) return null;
    return sanLine(parent.fen, [uci], 1) || null;
  }, [liveCallout, currentAnn, mt.cursorPly, mt.tree, mt.node.parent]);

  const highlightStyles = useMemo(() => {
    if (!reviewedMove || !settings.highlightLastMove) return {};
    return {
      [reviewedMove.from]: skin.lastMoveFrom,
      [reviewedMove.to]: skin.lastMoveTo,
    };
  }, [reviewedMove, settings.highlightLastMove, skin.lastMoveFrom, skin.lastMoveTo]);

  // Show the move the engine wanted instead, right on the board.
  const arrows = useMemo(() => {
    const uci = currentAnn?.best_uci;
    if (!settings.showBestArrow) return [];
    if (!uci || reviewedClass === "best" || reviewedClass === "book") return [];
    return [[uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, ARROW_COLOR] as const];
  }, [currentAnn, reviewedClass, settings.showBestArrow]);

  // The board reads its props as "did anything change?". Building this inline
  // in the JSX answered yes on every render, which walks all sixty-four
  // squares for a set of arrows that never moved.
  const boardArrows = useMemo(
    () => arrows.map((a) => [...a] as [Square, Square, string]),
    [arrows]
  );

  // Square -> top-left percentage within the board, respecting orientation.
  const squarePct = useCallback(
    (sq: string) => {
      const file = sq.charCodeAt(0) - 97; // a=0..h=7
      const rank = parseInt(sq[1], 10); // 1..8
      const col = orientation === "white" ? file : 7 - file;
      const row = orientation === "white" ? 8 - rank : rank - 1;
      return { left: col * 12.5, top: row * 12.5 };
    },
    [orientation]
  );

  // Ask the engine + explorer once the position stops changing. A cached
  // explorer answer is applied immediately, so revisiting a position you have
  // already seen never flickers or waits.
  useEffect(() => {
    // Abort immediately on navigation, including when the next position is cached.
    explorerAbort.current?.abort();
    const key = `${explorerScope}:${fen}`;
    const hit = explorerCache.current.get(key);
    if (hit) {
      setExplorer(hit.moves);
      setExplorerTotal(hit.total);
      setExplorerError(null);
      setExplorerLoading(false);
    } else {
      setExplorer([]);
      setExplorerTotal(0);
      setExplorerError(null);
      setExplorerLoading(true);
    }

    const timer = setTimeout(() => {
      if (autoAnalyse && engine.connected) {
        engine.analyse(fen, settings.depth, settings.multipv, settings.engine);
      }
      if (hit) return;

      // Only the newest position's answer may land; an older in-flight reply
      // would otherwise overwrite the panel with the wrong position's book.
      explorerAbort.current?.abort();
      const ctrl = new AbortController();
      explorerAbort.current = ctrl;

      settleExplorerRequest(
        api.explorer(fen, explorerScope, ctrl.signal),
        ctrl.signal
      ).then((outcome) => {
        if (outcome.status === "aborted") return;

        setExplorerLoading(false);

        if (outcome.status === "error") {
          const err = outcome.error;
          setExplorer([]);
          setExplorerTotal(0);
          setExplorerError(
            err instanceof ApiError
              ? err.message
              : "Could not load explorer statistics. Please retry."
          );
          return;
        }

        const res = outcome.result;
        if (explorerCache.current.size >= EXPLORER_CACHE_MAX) {
          explorerCache.current.clear();
        }
        explorerCache.current.set(key, {
          moves: res.moves,
          total: res.total_games,
        });
        setExplorer(res.moves);
        setExplorerTotal(res.total_games);
        setExplorerError(null);
      });
    }, SETTLE_MS);

    return () => { clearTimeout(timer); explorerAbort.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, engine.connected, autoAnalyse, explorerScope, explorerRefresh, settings.depth, settings.multipv, settings.engine]);

  useEffect(() => () => explorerAbort.current?.abort(), []);

  // Playing a move branches off the position you are standing on. Nothing is
  // ever thrown away to make room for it.
  const onDrop = mt.play;

  const { onSquareClick, squareStyles } = useClickToMove(fen, onDrop);

  // Same reason as `boardArrows`: one object per set of styles, not per render.
  const boardSquareStyles = useMemo(
    () => ({ ...highlightStyles, ...squareStyles }),
    [highlightStyles, squareStyles]
  );

  const flip = useCallback(
    () => setOrientation((o) => (o === "white" ? "black" : "white")),
    []
  );

  // PGN writes variations natively, so the lines you found leave here in a
  // form ChessBase, Lichess and SCID all already understand.
  const copyPgn = useCallback(async () => {
    setCopied((await copyText(mt.exportPgn())) ? "done" : "failed");
    setTimeout(() => setCopied(null), 1800);
  }, [mt]);

  // The listener reads the tree through a ref rather than closing over it, so
  // it is bound once for the life of the board. Depending on `mt` had it
  // re-bound on every render, which under a held arrow key means rebuilding it
  // between repeats - each one landing in its own render pass.
  const mtRef = useRef(mt);
  mtRef.current = mt;

  // Keyboard navigation, like every serious chess GUI. Alt+Up/Down cycling the
  // alternatives at a point is the one that makes a tree walkable; Escape is
  // the way out once you are four moves deep in a line that never happened.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const tree = mtRef.current;
      if (e.key === "ArrowLeft") tree.back();
      if (e.key === "ArrowRight") tree.next();
      if (e.key === "ArrowUp") (e.altKey ? tree.nextAlternative(-1) : tree.toStart());
      if (e.key === "ArrowDown") (e.altKey ? tree.nextAlternative(1) : tree.toEnd());
      if (e.key === "Escape") tree.backToGame();
      if (e.key === "Delete" || e.key === "Backspace") tree.removeLine();
      if (e.key === "f") flip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip]);

  /**
   * The bar shows the position on the board, and reads it from the store
   * rather than off the socket. While a line is being swept the socket is
   * answering about some other position entirely, and the bar following it
   * would swing to a score for a move you are not looking at. This also means
   * the bar holds its last known value instead of dropping to 0.00 every time
   * the cursor moves.
   */
  const boardEval = evalAt(fen);
  const evalText = boardEval
    ? boardEval.mate != null
      ? `M${Math.abs(boardEval.mate)}`
      : formatCp(boardEval.cp)
    : "0.00";
  const whiteAdvantage = (boardEval?.cp ?? 0) >= 0;

  // Eval bar height: clamp centipawns to a readable range
  const barPct = useMemo(() => {
    if (!boardEval) return 50;
    if (boardEval.mate != null) return boardEval.mate > 0 ? 100 : 0;
    return Math.max(2, Math.min(98, 50 + boardEval.cp / 20));
  }, [boardEval]);

  const badge = Math.max(16, Math.min(30, boardSize * 0.062));

  /**
   * Who to name on each plate.
   *
   * The rail knows the players of the game it opened, so it wins. A PGN that
   * brought its own tag pairs answers for anything the rail did not open, with
   * "?" read as the absence the spec means it to be. Failing both, the plates
   * name the sides themselves - so they never appear and vanish under the board
   * as games load, which would resize it every time.
   */
  const seats = useMemo(() => {
    const h = mt.headers;
    const known = (v?: string) => (v && v !== "?" ? v : undefined);
    const rating = (v?: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const result = players?.result ?? known(h.Result);

    return {
      white: {
        name: players?.white || known(h.White) || "White",
        elo: players?.whiteElo ?? rating(h.WhiteElo),
        score: scoreOf(result, "white"),
      },
      black: {
        name: players?.black || known(h.Black) || "Black",
        elo: players?.blackElo ?? rating(h.BlackElo),
        score: scoreOf(result, "black"),
      },
    };
  }, [players, mt.headers]);

  // Top plate is whoever is playing away from you; the bottom one is the side
  // you are looking from. Both follow the flip.
  const topSide = orientation === "white" ? "black" : "white";
  const bottomSide = orientation;
  const sideToMove = fen.split(" ")[1] === "b" ? "black" : "white";

  return (
    <div className="flex flex-col lg:h-full lg:flex-row">
      {/* ---------- Board stage: fills the workspace, top to bottom ---------- */}
      {/* Outer box owns the padding so the measured inner box is the content
          box - on a desktop there is none, and the board meets both edges.
          Its height is always stated rather than left to the content: a phone
          gets a square board plus the two plates (the 76px is PLATE_STACK), a
          desktop gets the workspace row. Sizing it from the content instead
          would have the board's own height feed back into the measurement. */}
      <div
        className="w-full h-[calc(100vw_+_76px)] px-3 lg:h-full lg:min-h-0
                   lg:w-auto lg:min-w-0 lg:flex-1 lg:px-0"
      >
        <div
          ref={stageRef}
          className="relative flex h-full w-full items-center justify-center gap-2"
        >
          {settings.showEvalBar && (
            <EvalBar
              pct={barPct}
              text={evalText}
              whiteAhead={whiteAdvantage}
              flipped={orientation === "black"}
              height={boardSize}
            />
          )}

          {/* Board with a player on each side of it. The column is exactly as
              wide as the framed board, so the plates line up with the outer
              edge of the timber - and because the two are the same height, the
              eval bar beside them stays centred on the board rather than on
              the stack. */}
          <div
            className="flex flex-col gap-1.5"
            style={{ width: boardSize ? boardSize + FRAME : undefined }}
          >
            <PlayerPlate
              name={seats[topSide].name}
              elo={seats[topSide].elo}
              side={topSide}
              score={seats[topSide].score}
              toMove={sideToMove === topSide}
            />

            {/* The frame takes its size from the board it wraps, so the board
                keeps its exact measured square and the percentage maths the
                verdict badge does below stays relative to the squares. */}
            <div className="board-frame">
              {/* The drawing surface is this wrapper, not a layer over the
                  squares: an overlay that could take a click would make every
                  square it covers unplayable. Right-button presses are caught
                  here, everything else falls through to the pieces. */}
              <div
                ref={drawing.boardRef}
                {...drawing.handlers}
                className="relative"
                style={{ width: boardSize || undefined, height: boardSize || undefined }}
              >
                {boardSize > 0 && (
                  <Chessboard
                    position={fen}
                    boardWidth={boardSize}
                    onPieceDrop={onDrop}
                    onSquareClick={onSquareClick}
                    boardOrientation={orientation}
                    customArrows={boardArrows}
                    customArrowColor={ARROW_COLOR}
                    customNotationStyle={NOTATION_STYLE}
                    animationDuration={skin.animationMs}
                    // The board's own right-drag arrows are turned off: they
                    // are uncontrolled and single-coloured, and would fight
                    // the ones kept on the move.
                    areArrowsAllowed={false}
                    {...skin.props}
                    customSquareStyles={boardSquareStyles}
                  />
                )}

                <BoardShapes
                  shapes={mt.shapes}
                  pending={drawing.pending}
                  size={boardSize}
                  orientation={orientation}
                />

                {/* Verdict badge on the destination square */}
                {settings.showVerdictBadge && reviewedMove && reviewedClass && (
                  <div
                    className="pointer-events-none absolute z-10 animate-pop"
                    style={{
                      left: `${squarePct(reviewedMove.to).left + 12.5}%`,
                      top: `${squarePct(reviewedMove.to).top}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <span
                      className="flex items-center justify-center rounded-full font-bold text-white shadow-md ring-2 ring-black/30"
                      style={{
                        background: CLASS_META[reviewedClass].bg,
                        width: badge,
                        height: badge,
                        fontSize:
                          CLASS_META[reviewedClass].glyph.length > 1
                            ? badge * 0.45
                            : badge * 0.58,
                      }}
                    >
                      {CLASS_META[reviewedClass].glyph}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <PlayerPlate
              name={seats[bottomSide].name}
              elo={seats[bottomSide].elo}
              side={bottomSide}
              score={seats[bottomSide].score}
              toMove={sideToMove === bottomSide}
            />
          </div>
        </div>
      </div>

      {/* ---------- Analysis panel ---------- */}
      <aside
        className="flex w-full shrink-0 flex-col border-ivory/[0.07] bg-panel/60 backdrop-blur-xl
                   border-t lg:h-full lg:w-[352px] lg:border-l lg:border-t-0 xl:w-[400px]"
      >
        {/* Header: what you are looking at */}
        <div className="shrink-0 border-b border-ivory/[0.06] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="eyebrow">
              {study ? (study.readOnly ? "Shared study" : "Study") : "Game review"}
            </span>
            {/* Where the save state is said out loud. A chapter is written on
                a debounce, so without this the only evidence that anything was
                kept is reloading the page and hoping. */}
            {study?.status && (
              <span className="truncate text-[11px] text-muted">{study.status}</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
              {onMainline ? mt.cursorPly : "–"}/{history.length}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm font-medium" title={gameLabel}>
            {gameLabel ?? "Free analysis board"}
          </p>
        </div>

        {/* ---------- The verdict, and the index of verdicts ----------

            Fixed above the tab strip rather than inside it. Finding what went
            wrong is this screen's whole job, and a job does not belong in a
            tab set next to three optional views of the same game. */}
        {/* Capped and scrollable: this block is fixed above a flex-1 scroll
            area, so on a short viewport a long explanation plus a game with a
            dozen mistakes in it would otherwise squeeze the move list down to
            nothing. It gives up its own height first. */}
        {!study && (
          <div
            className="shrink-0 space-y-3 overflow-y-auto border-b border-ivory/[0.06]
                       px-3 py-3 lg:max-h-[42%]"
          >
            <VerdictPlate
              verdict={
                currentWhy
                  ? { ...currentWhy, bestSan: currentBestSan }
                  : null
              }
              onShowBest={(san) => {
                mt.playInstead([san]);
                setTab("moves");
              }}
              reviewing={reviewing}
              hasReview={hasReview}
              canRun={gameId != null}
            />
            <BlunderIndex
              annotations={[...annByPly.values()]}
              cursor={mt.cursorPly}
              onSeek={mt.seekPly}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="shrink-0 px-3 pt-2.5">
          <div className="seg w-full justify-between">
            {(study ? STUDY_TABS : TABS).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={`seg-item flex-1 text-center text-xs ${
                  tab === t.id ? "seg-item-on" : ""
                }`}
              >
                {t.label}
                {t.id === "moves" && history.length > 0 && (
                  <span className="ml-1 text-[10px] opacity-60">{history.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scrolling body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {mismatched > 0 && (
            <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs leading-relaxed">
              {mismatched} reviewed move{mismatched === 1 ? "" : "s"} in this game
              no longer match the board, so {mismatched === 1 ? "it is" : "they are"}{" "}
              hidden rather than labelled against the wrong move. Re-run the
              review to rebuild it.
            </div>
          )}

          {reviewNotice && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs">
              <span>⏳ {reviewNotice}</span>

            </div>
          )}

          {/* Off the game, there is no review to show and the coach says
              nothing - so say where you are instead, and offer the way back. */}
          {!onMainline && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
              <span>You&rsquo;re in a line that wasn&rsquo;t played.</span>
              <button
                onClick={mt.backToGame}
                className="ml-auto shrink-0 text-accent underline"
              >
                Back to the game
              </button>
            </div>
          )}

          {tab === "notes" && (
            <NotesPane
              san={mt.node.san}
              ply={mt.node.ply}
              comment={mt.comment}
              shapes={mt.shapes}
              nag={mt.node.nag}
              readOnly={boardReadOnly}
              onComment={(text) => mt.setComment(cursorId, text)}
              onNag={(nag) => mt.setNag(cursorId, nag)}
              onShapes={onShapes}
            />
          )}
          {tab === "report" && (
            <ReviewPanel
              history={history}
              annotations={[...annByPly.values()]}
              summary={reviewSummary}
              cursor={mt.cursorPly}
              onSeek={mt.seekPly}
              reviewing={reviewing}
              onRun={runReview}
              canRun={gameId != null}
            />
          )}
          {tab === "moves" && (
            <div className="space-y-2">
              {/* The verdict used to be repeated here, because it was otherwise
                  stuck behind the Review tab and this is the tab you are on
                  while you try things. It is a fixed plate above the tabs now,
                  visible from every one of them, so the copy is gone. */}
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span className="truncate">
                  {sweepQueue.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-accent2">
                      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent2" />
                      Scoring this line — {sweepQueue.length} to go
                    </span>
                  ) : exploredMoves > 0 ? (
                    `${exploredMoves} move${exploredMoves === 1 ? "" : "s"} in lines you tried`
                  ) : (
                    "Play a move anywhere to start a line"
                  )}
                </span>
                <button
                  onClick={copyPgn}
                  disabled={history.length === 0}
                  className={`ml-auto shrink-0 rounded border px-2 py-0.5 transition-colors
                             disabled:opacity-40 disabled:hover:bg-transparent ${
                               copied === "failed"
                                 ? "border-bad/40 text-bad"
                                 : "border-ivory/10 hover:bg-ivory/10 hover:text-ink"
                             }`}
                >
                  {copied === "done"
                    ? "Copied"
                    : copied === "failed"
                      ? "Copy blocked"
                      : "Copy PGN"}
                </button>
              </div>
              <MoveList
                tree={mt.tree}
                rows={mt.rows}
                annByPly={annByPly}
                liveByNode={liveByNode}
                cursorId={cursorId}
                onSeek={mt.seek}
              />
            </div>
          )}
          {tab === "engine" && (
            <EnginePane
              // Only the lines that belong to the position on the board. In
              // the moment after a move they still describe the previous one,
              // and reading that PV against this position renders the wrong
              // moves - and would put the wrong line on the board if clicked.
              lines={engine.fen === fen ? engine.lines : []}
              fen={fen}
              depth={engine.depth}
              connected={engine.connected}
              thinking={engine.thinking}
              error={engine.error}
              autoAnalyse={autoAnalyse}
              onToggleAuto={(autoAnalyse) => updateSettings({ autoAnalyse })}
              onPlayLine={(sans, evalCp) => mt.playLine(sans, { evalCp })}
            />
          )}
          {tab === "book" && (
            <ExplorerPane
              moves={explorer}
              total={explorerTotal}
              scope={explorerScope}
              onScope={setExplorerScope}
              error={explorerError}
              loading={explorerLoading}
              onRetry={() => { explorerCache.current.clear(); setExplorerRefresh((value) => value + 1); }}
              onPlay={(uci) => onDrop(uci.slice(0, 2), uci.slice(2, 4))}
              fen={fen}
            />
          )}
        </div>

        {/* Transport controls: pinned to the panel on a desktop, and stuck to
            the bottom of the viewport while scrolling on a phone. */}
        <div className="sticky bottom-0 shrink-0 border-t border-ivory/[0.06] bg-panel/90 p-2.5 backdrop-blur-xl lg:static lg:bg-transparent lg:backdrop-blur-none">
          {hasReview && onMainline && mt.node.children.length > 0 && (
            <button className="btn-go mb-2 w-full text-sm" onClick={mt.next}>
              Next move  →
            </button>
          )}
          {mt.alternatives.length > 1 && (
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="shrink-0">
                {mt.alternatives.indexOf(cursorId) + 1} of {mt.alternatives.length} tried here
              </span>
              <button
                onClick={() => mt.nextAlternative(-1)}
                title="Previous alternative (Alt+↑)"
                className="ml-auto rounded border border-ivory/10 px-1.5 py-0.5 hover:bg-ivory/10 hover:text-ink"
              >
                ↑
              </button>
              <button
                onClick={() => mt.nextAlternative(1)}
                title="Next alternative (Alt+↓)"
                className="rounded border border-ivory/10 px-1.5 py-0.5 hover:bg-ivory/10 hover:text-ink"
              >
                ↓
              </button>
              {/* Only where there is no review to invalidate — in a study,
                  which line is the main one is the author's decision and
                  changing it is half of what authoring one is. */}
              {mt.canPromote && (
                <button
                  onClick={mt.promoteLine}
                  title="Make this the main line"
                  className="rounded border border-ivory/10 px-1.5 py-0.5 hover:bg-accent/20 hover:text-accent"
                >
                  ★
                </button>
              )}
              {!onMainline && (
                <button
                  onClick={mt.removeLine}
                  title="Delete this line (Del)"
                  className="rounded border border-ivory/10 px-1.5 py-0.5 hover:bg-bad/20 hover:text-bad"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 divide-x divide-ivory/10 overflow-hidden rounded-lg border border-ivory/10 bg-ivory/[0.05]">
              {[
                { glyph: "«", title: "Start (↑)", go: mt.toStart },
                { glyph: "‹", title: "Back (←)", go: mt.back },
                { glyph: "›", title: "Forward (→)", go: mt.next },
                { glyph: "»", title: "End (↓)", go: mt.toEnd },
              ].map((b) => (
                <button
                  key={b.glyph}
                  onClick={b.go}
                  title={b.title}
                  aria-label={b.title}
                  className="flex-1 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-ivory/10 hover:text-ink"
                >
                  {b.glyph}
                </button>
              ))}
            </div>
            <button
              onClick={flip}
              title="Flip board (f)"
              aria-label="Flip board"
              className="rounded-lg border border-ivory/10 bg-ivory/[0.05] px-3 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-ivory/10 hover:text-ink"
            >
              ⟳
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
