"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, TablebaseMove, TablebaseResult } from "@/lib/api";

/**
 * The tablebase verdict on an endgame, and on every move from it.
 *
 * Shown in place of the opening book once seven pieces or fewer are left,
 * which is where Lichess puts it too: by then nobody needs to know what
 * masters played, they need to know which moves still win.
 *
 * A move's category arrives from the point of view of whoever moves *after*
 * it - a move into "loss" is a winning move. Everything here is turned round
 * to read from the side making the move, which is the question being asked.
 */

/** Seven or fewer: the most any tablebase covers. */
export const TABLEBASE_PIECES = 7;

export function pieceCount(fen: string): number {
  return (fen.split(" ")[0].match(/[pnbrqk]/gi) ?? []).length;
}

const FLIP: Record<string, string> = {
  win: "loss",
  loss: "win",
  "cursed-win": "blessed-loss",
  "blessed-loss": "cursed-win",
  "maybe-win": "maybe-loss",
  "maybe-loss": "maybe-win",
  "syzygy-win": "syzygy-loss",
  "syzygy-loss": "syzygy-win",
  draw: "draw",
  unknown: "unknown",
};

const LABEL: Record<string, string> = {
  win: "Win",
  "syzygy-win": "Win",
  "maybe-win": "Win (likely)",
  "cursed-win": "Win, but drawn by the 50-move rule",
  draw: "Draw",
  "blessed-loss": "Loss, but saved by the 50-move rule",
  "maybe-loss": "Loss (likely)",
  "syzygy-loss": "Loss",
  loss: "Loss",
  unknown: "Unknown",
};

/** Verdigris for winning, coral for losing, ink for the rest - the palette's rule. */
function tone(category: string): string {
  if (category === "win" || category === "syzygy-win" || category === "maybe-win") return "text-accent";
  if (category === "loss" || category === "syzygy-loss" || category === "maybe-loss") return "text-bad";
  return "text-ink/80";
}

const ORDER = ["win", "syzygy-win", "maybe-win", "cursed-win", "draw", "unknown", "blessed-loss", "maybe-loss", "syzygy-loss", "loss"];

function moverView(m: TablebaseMove): string {
  if (m.checkmate) return "win";
  return FLIP[m.category] ?? "unknown";
}

function distance(m: TablebaseMove): string {
  if (m.checkmate) return "Checkmate";
  if (m.stalemate) return "Stalemate";
  // A draw is a draw at any distance; a zero DTZ beside it reads as a clue.
  if (m.category === "draw") return m.zeroing ? "Zeroing" : "";
  const bits: string[] = [];
  if (m.dtm != null) bits.push(`DTM ${Math.abs(m.dtm)}`);
  if (m.dtz != null) bits.push(m.zeroing ? "Zeroing" : `DTZ ${Math.abs(m.dtz)}`);
  return bits.join(" · ");
}

interface Props {
  fen: string;
  onPlay: (uci: string) => void;
}

export default function TablebasePane({ fen, onPlay }: Props) {
  const [result, setResult] = useState<TablebaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, TablebaseResult>());

  useEffect(() => {
    const hit = cache.current.get(fen);
    if (hit) {
      setResult(hit);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    // Settled like the explorer: holding an arrow key through an endgame
    // must not fire a request per position stepped over.
    const timer = setTimeout(() => {
      api
        .tablebase(fen, ctrl.signal)
        .then((res) => {
          cache.current.set(fen, res);
          setResult(res);
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setResult(null);
          setError(err instanceof ApiError ? err.message : "The tablebase could not be reached.");
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [fen]);

  const side = fen.split(" ")[1] === "b" ? "Black" : "White";

  if (error) {
    return (
      <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs leading-relaxed">
        {error}
      </div>
    );
  }
  if (!result) {
    return <p className="text-xs text-muted">{loading ? "Asking the tablebase…" : ""}</p>;
  }

  const moves = [...result.moves].sort((a, b) => {
    const ca = ORDER.indexOf(moverView(a));
    const cb = ORDER.indexOf(moverView(b));
    if (ca !== cb) return ca - cb;
    // Winning: fastest first. Losing: longest resistance first.
    const winning = ca <= 2;
    const da = Math.abs(a.dtm ?? a.dtz ?? 0);
    const db = Math.abs(b.dtm ?? b.dtz ?? 0);
    return winning ? da - db : db - da;
  });

  const verdict = result.checkmate
    ? `${side} is checkmated`
    : result.stalemate
      ? "Stalemate"
      : result.insufficient_material
        ? "Draw — insufficient material"
        : `${side} to move: ${LABEL[result.category] ?? result.category}`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <p className={`text-sm font-medium ${tone(result.category)}`}>{verdict}</p>
        {result.dtm != null && !result.checkmate && (
          <span className="font-mono text-[11px] text-muted">
            {result.dtm > 0 ? "mates in" : "mated in"} {Math.ceil(Math.abs(result.dtm) / 2)}
          </span>
        )}
      </div>

      {moves.length > 0 && (
        <ul className="divide-y divide-ivory/[0.05] rounded-xl border border-ivory/[0.06]">
          {moves.map((m) => {
            const view = moverView(m);
            return (
              <li key={m.uci}>
                <button
                  onClick={() => onPlay(m.uci)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-ivory/[0.06]"
                >
                  <span className="w-14 font-mono text-[13px] font-semibold">{m.san}</span>
                  <span className={`flex-1 ${tone(view)}`}>{LABEL[view] ?? view}</span>
                  <span className="font-mono text-[10px] text-muted">{distance(m)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] leading-relaxed text-muted">
        {result.source === "syzygy"
          ? "Syzygy tablebases on this computer."
          : result.source === "rules"
            ? "Decided by the rules — no tablebase needed."
            : "Lichess tablebase (online). Only this position was sent. Install Syzygy files and set SYZYGY_PATH to answer offline."}{" "}
        DTZ counts moves to the next capture or pawn move; DTM, where known, to mate.
      </p>
    </div>
  );
}
