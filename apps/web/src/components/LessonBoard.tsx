"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import BoardShapes from "@/components/BoardShapes";
import { useClickToMove } from "@/hooks/useClickToMove";
import { useSquareSize } from "@/hooks/useSquareSize";
import { BOARD_FRAME, useBoardTheme } from "@/lib/boardTheme";
import {
  Side,
  expected,
  judge,
  movesFound,
  movesToFind,
  prose,
  sideToMove,
} from "@/lib/lesson";
import { NodeId, nodeAt } from "@/lib/moveTree";
import { parsePgn } from "@/lib/pgn";
import { splitComment } from "@/lib/shapes";

/**
 * A chapter played as an interactive lesson. See lib/lesson.ts for the rules.
 *
 * Deliberately its own board rather than a mode of the analysis board: the
 * analysis board's whole contract is that every move you play is kept, and a
 * lesson's is the opposite - a wrong answer is taken back, and nothing you do
 * here is written anywhere.
 */

const FRAME = 2 * BOARD_FRAME;
/** How long the other side "thinks" before replying - long enough to see your move land. */
const REPLY_MS = 550;

const HINT_FROM: CSSProperties = { background: "rgba(214, 160, 92, 0.55)" };
const HINT_TO: CSSProperties = { background: "rgba(241, 203, 139, 0.7)" };
const WRONG: CSSProperties = { background: "rgba(230, 98, 80, 0.5)" };

type Feedback =
  | { tone: "prompt"; text: string }
  | { tone: "good"; text: string }
  | { tone: "bad"; text: string }
  | { tone: "done"; text: string };

interface Props {
  name: string;
  description?: string | null;
  pgn: string;
  startFen: string;
  orientation: "white" | "black";
  onNext?: () => void;
  /** Leave the lesson for the analysis board - for an author checking their work. */
  onAnalyse?: () => void;
}

export default function LessonBoard({ name, description, pgn, startFen, orientation, onNext, onAnalyse }: Props) {
  const skin = useBoardTheme();
  const tree = useMemo(() => parsePgn(pgn, startFen).tree, [pgn, startFen]);
  const player: Side = orientation === "white" ? "w" : "b";

  const [cursor, setCursor] = useState<NodeId>(tree.root);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [hint, setHint] = useState<0 | 1 | 2>(0);
  const [hints, setHints] = useState(0);
  const [wrongSquare, setWrongSquare] = useState<string | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stageRef, boardSize] = useSquareSize(FRAME, FRAME);

  const node = nodeAt(tree, cursor) ?? nodeAt(tree, tree.root)!;
  const want = expected(tree, cursor);
  const yourTurn = sideToMove(node) === player;
  const finished = !want;
  const total = movesToFind(tree, player);
  const found = movesFound(tree, cursor, player);

  /**
   * Play the other side's main-line reply, if it is their move. Its comment is
   * the next prompt - "and now?" is what an author writes after a reply.
   */
  const reply = useCallback(
    (from: NodeId, said: string) => {
      const at = nodeAt(tree, from)!;
      const next = expected(tree, from);
      if (!next || sideToMove(at) === player) {
        if (!next) {
          setFeedback({
            tone: "done",
            text: said || "Lesson complete.",
          });
        }
        return;
      }
      replyTimer.current = setTimeout(() => {
        setCursor(next.id);
        const after = expected(tree, next.id);
        const prompt = prose(next);
        if (!after) {
          setFeedback({ tone: "done", text: [said, prompt].filter(Boolean).join(" ") || "Lesson complete." });
        } else {
          setFeedback(
            prompt
              ? { tone: "prompt", text: prompt }
              : said
                ? { tone: "good", text: said }
                : { tone: "prompt", text: "Your move." }
          );
        }
      }, REPLY_MS);
    },
    [tree, player]
  );

  const restart = useCallback(() => {
    if (replyTimer.current) clearTimeout(replyTimer.current);
    setCursor(tree.root);
    setMistakes(0);
    setHints(0);
    setHint(0);
    setWrongSquare(null);
    const root = nodeAt(tree, tree.root)!;
    const intro = prose(root);
    setFeedback(intro ? { tone: "prompt", text: intro } : null);
    // A lesson read from Black whose first move is White's starts with that
    // move already played - the reader's job begins at their own turn.
    if (sideToMove(root) !== player) reply(tree.root, intro);
  }, [tree, player, reply]);

  useEffect(() => {
    restart();
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, [restart]);

  // A hint and a wrong-square mark belong to the position they were given in.
  useEffect(() => {
    setHint(0);
  }, [cursor]);
  useEffect(() => {
    if (!wrongSquare) return;
    const t = setTimeout(() => setWrongSquare(null), 900);
    return () => clearTimeout(t);
  }, [wrongSquare]);

  const onMove = useCallback(
    (from: string, to: string): boolean => {
      if (!yourTurn || finished) return false;
      const g = new Chess(node.fen);
      let mv;
      try {
        mv = g.move({ from, to, promotion: "q" });
      } catch {
        return false;
      }
      if (!mv) return false;

      const verdict = judge(tree, cursor, mv.san);
      if (verdict.kind === "correct") {
        setCursor(verdict.node.id);
        setFeedback({ tone: "good", text: verdict.explanation || `${mv.san} — correct.` });
        reply(verdict.node.id, verdict.explanation);
        return true;
      }
      setMistakes((m) => m + 1);
      setWrongSquare(to);
      setFeedback({
        tone: "bad",
        text:
          verdict.kind === "refuted"
            ? verdict.explanation || `${mv.san} is not the move here. Try again.`
            : `${mv.san} is not the move the lesson is looking for. Try again.`,
      });
      // Taken back: returning false snaps the piece home.
      return false;
    },
    [yourTurn, finished, node.fen, tree, cursor, reply]
  );

  const { onSquareClick, squareStyles } = useClickToMove(node.fen, onMove, yourTurn && !finished);

  function showHint() {
    if (!want || !yourTurn) return;
    if (hint === 0) setHints((h) => h + 1);
    setHint((h) => (h === 0 ? 1 : 2));
  }

  /** Play the answer for the reader. Counted, so the summary stays honest. */
  function showSolution() {
    if (!want || !yourTurn) return;
    setMistakes((m) => m + 1);
    setCursor(want.id);
    const why = prose(want);
    setFeedback({ tone: "good", text: why ? `${want.san}: ${why}` : `The move was ${want.san}.` });
    reply(want.id, why);
  }

  const styles = useMemo(() => {
    const s: Record<string, CSSProperties> = {};
    if (node.uci) {
      s[node.uci.slice(0, 2)] = skin.lastMoveFrom;
      s[node.uci.slice(2, 4)] = skin.lastMoveTo;
    }
    if (want && hint >= 1) s[want.uci.slice(0, 2)] = HINT_FROM;
    if (want && hint === 2) s[want.uci.slice(2, 4)] = HINT_TO;
    if (wrongSquare) s[wrongSquare] = WRONG;
    return { ...s, ...squareStyles };
  }, [node.uci, skin.lastMoveFrom, skin.lastMoveTo, want, hint, wrongSquare, squareStyles]);

  const arrows = useMemo(
    () =>
      want && hint === 2
        ? ([[want.uci.slice(0, 2), want.uci.slice(2, 4), "#C98A3A"]] as [Square, Square, string][])
        : [],
    [want, hint]
  );

  // The author's drawings on the position the reader is looking at.
  const shapes = useMemo(() => splitComment(node.comment).shapes, [node.comment]);

  const tone =
    feedback?.tone === "good"
      ? "border-accent/40 bg-accent/10"
      : feedback?.tone === "bad"
        ? "border-bad/40 bg-bad/10"
        : feedback?.tone === "done"
          ? "border-brass/50 bg-brass/10"
          : "border-ivory/10 bg-ivory/[0.04]";

  return (
    <div className="flex flex-col lg:h-full lg:flex-row">
      <div className="h-[calc(100vw_+_8px)] w-full px-3 lg:h-full lg:min-h-0 lg:w-auto lg:min-w-0 lg:flex-1 lg:px-3">
        <div ref={stageRef} className="relative flex h-full w-full items-center justify-center">
          <div className="board-frame">
            <div className="relative" style={{ width: boardSize || undefined, height: boardSize || undefined }}>
              {boardSize > 0 && (
                <Chessboard
                  position={node.fen}
                  boardWidth={boardSize}
                  boardOrientation={orientation}
                  onPieceDrop={onMove}
                  onSquareClick={onSquareClick}
                  arePiecesDraggable={yourTurn && !finished}
                  customArrows={arrows}
                  areArrowsAllowed={false}
                  animationDuration={skin.animationMs}
                  {...skin.props}
                  customSquareStyles={styles}
                />
              )}
              <BoardShapes shapes={shapes} size={boardSize} orientation={orientation} />
            </div>
          </div>
        </div>
      </div>

      <aside className="glass mt-3 flex w-full shrink-0 flex-col gap-3 rounded-t-3xl p-3 lg:my-2 lg:mr-2 lg:mt-2 lg:h-[calc(100%-1rem)] lg:w-[352px] lg:overflow-y-auto lg:rounded-2xl xl:w-[400px]">
        <div>
          <span className="eyebrow">Interactive lesson</span>
          <p className="mt-0.5 text-sm font-medium">{name}</p>
          {description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">{description}</p>}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ivory/10">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${total ? (100 * found) / total : 100}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-muted">
            {found}/{total}
          </span>
        </div>

        <div className={`min-h-[72px] whitespace-pre-wrap rounded-xl border px-3 py-2.5 text-sm leading-relaxed ${tone}`}>
          {feedback?.text ??
            (finished
              ? "Lesson complete."
              : yourTurn
                ? `You play ${orientation === "white" ? "White" : "Black"}. Find the best move.`
                : "…")}
        </div>

        {!finished && (
          <div className="flex gap-2">
            <button className="btn flex-1 text-sm" disabled={!yourTurn} onClick={showHint}>
              {hint === 0 ? "Hint" : hint === 1 ? "Show the square" : "Hint shown"}
            </button>
            <button className="btn flex-1 text-sm" disabled={!yourTurn} onClick={showSolution}>
              Show me
            </button>
          </div>
        )}

        {finished && (
          <div className="rounded-xl border border-ivory/10 px-3 py-2 text-xs text-muted">
            {mistakes === 0 && hints === 0
              ? "Every move found, no hints. 🎉"
              : `${mistakes} wrong attempt${mistakes === 1 ? "" : "s"}, ${hints} hint${hints === 1 ? "" : "s"}.`}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-2">
          <button className="btn text-xs" onClick={restart}>
            ↺ Restart
          </button>
          {onAnalyse && (
            <button className="btn text-xs" onClick={onAnalyse}>
              Analyse this chapter
            </button>
          )}
          {onNext && (
            <button className={`${finished ? "btn-primary" : "btn"} ml-auto text-xs`} onClick={onNext}>
              Next chapter →
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
