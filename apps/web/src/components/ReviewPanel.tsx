"use client";

/**
 * Game Review: the coach's verdict on the move you are looking at, an accuracy
 * summary, a clickable evaluation curve, and per-side verdict counts.
 *
 * The summary, the curve and the counts are the server's review of the game
 * that was played, and only ever that. The callout at the top is the one part
 * that also speaks for a move the server never saw: step into a line you tried
 * and it explains that move instead, from the live engine, saying so plainly.
 * A move you invented deserves the same sentence as a move you played - it is
 * the sentence, not the badge, that teaches you anything.
 */

import { useMemo, useRef } from "react";
import Link from "next/link";
import { Annotation, Classification, ReviewSummary } from "@/lib/api";
import { CLASS_META, CLASS_ORDER } from "@/lib/classification";

/**
 * Only the three verdicts worth interrupting the eval curve for get a dot.
 * The fills come from CLASS_META so the dot on the curve, the badge on the
 * board, and the move in the list are never three different yellows.
 */
const DOTTED: Classification[] = ["inaccuracy", "mistake", "blunder"];
const DOT_FILL: Partial<Record<Classification, string>> = Object.fromEntries(
  DOTTED.map((c) => [c, CLASS_META[c].bg])
);

/** Same logistic centipawn -> win% mapping the server uses. */
function winPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function evalText(cp: number | null): string {
  if (cp == null) return "";
  if (cp >= 9000) return "+M";
  if (cp <= -9000) return "-M";
  const p = cp / 100;
  return (p >= 0 ? "+" : "") + p.toFixed(1);
}

/** The engine's verdict on the move under the cursor, when no review covers it. */
export interface LiveCallout {
  san: string;
  cls: Classification;
  /** White-positive centipawns after the move. */
  cp: number;
  why: string;
  bestSan: string | null;
}

interface Props {
  gameId?: number;
  history: string[];
  annotations: Annotation[];
  summary: ReviewSummary | null;
  cursor: number;
  onSeek: (ply: number) => void;
  reviewing: boolean;
  onRun: () => void;
  canRun: boolean;
}

export default function ReviewPanel({
  gameId,
  history,
  annotations,
  summary,
  cursor,
  onSeek,
  reviewing,
  onRun,
  canRun,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const byPly = useMemo(() => {
    const m = new Map<number, Annotation>();
    for (const a of annotations) if (a.classification) m.set(a.ply, a);
    return m;
  }, [annotations]);

  const hasReview = byPly.size > 0;
  const N = history.length;

  // Counts survive a reload even without the job result: derive from annotations.
  const counts = useMemo(() => {
    if (summary) return summary.classifications;
    const out: ReviewSummary["classifications"] = { white: {}, black: {} };
    for (const a of byPly.values()) {
      if (!a.classification) continue;
      const side = a.ply % 2 === 0 ? "white" : "black";
      out[side][a.classification] = (out[side][a.classification] ?? 0) + 1;
    }
    return out;
  }, [summary, byPly]);

  // Eval curve: x scaled into a fixed 300x80 viewBox, y = White's win share.
  const W = 300;
  const H = 80;
  const graph = useMemo(() => {
    if (!hasReview || N === 0) return null;
    const pts: [number, number][] = [[0, H / 2]];
    for (let i = 0; i < N; i++) {
      const a = byPly.get(i);
      if (!a || a.eval_cp == null) continue;
      const x = ((i + 1) / N) * W;
      const y = H * (1 - winPct(a.eval_cp) / 100);
      pts.push([x, y]);
    }
    const path =
      `M0,${H} L` +
      pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L") +
      ` L${W},${pts[pts.length - 1][1].toFixed(1)} L${W},${H} Z`;
    const dots = [...byPly.values()]
      .filter((a) => a.classification && DOT_FILL[a.classification])
      .map((a) => ({
        x: ((a.ply + 1) / N) * W,
        y: H * (1 - winPct(a.eval_cp ?? 0) / 100),
        fill: DOT_FILL[a.classification!]!,
        ply: a.ply,
      }));
    return { path, dots };
  }, [hasReview, N, byPly]);

  const seekFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || N === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(N, Math.round(frac * N))));
  };

  // The move the cursor just played (annotation of ply cursor-1)
  const current = cursor > 0 ? byPly.get(cursor - 1) : undefined;

  return (
    <div className="space-y-3">
      {/* The per-move verdict used to open this panel. It is a fixed plate
          above the tab strip now (components/VerdictPlate.tsx), because it is
          the screen's job rather than one of four views of the game. What is
          left here is the GAME-level report: how accurate each side was, where
          the evaluation moved, and how many of each verdict there were. */}
      {canRun && (
        <button
          className={`w-full text-sm ${hasReview ? "btn" : "btn-primary"}`}
          onClick={onRun}
          disabled={reviewing}
        >
          {reviewing ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />
              Reviewing…
            </span>
          ) : hasReview ? (
            "Re-run review"
          ) : (
            "Review this game"
          )}
        </button>
      )}
      {gameId != null && hasReview && (
        <Link className="btn-primary block w-full text-center text-sm" href={`/train/review?game=${gameId}`}>
          Test yourself on this game
        </Link>
      )}

      {/* ---------- Accuracy ---------- */}
      {summary && hasReview && (
        <div className="grid grid-cols-2 gap-2">
          {(["white", "black"] as const).map((side) => (
            <div
              key={side}
              className="card-tight flex items-center gap-2 px-2.5 py-2"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-[3px] ring-1 ring-ivory/30 ${
                  side === "white" ? "bg-ivory" : "bg-ebony"
                }`}
              />
              <div className="min-w-0">
                <div className="font-display text-lg leading-none">
                  {summary.accuracy[side].toFixed(1)}
                  <span className="text-xs text-muted">%</span>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  {side} accuracy
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- Eval curve ---------- */}
      {graph && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-20 w-full cursor-crosshair rounded-xl bg-ebony ring-1 ring-ivory/[0.08]"
          onPointerDown={seekFromPointer}
          onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e)}
          role="img"
          aria-label="Evaluation over the course of the game — click to jump to a move"
        >
          <defs>
            {/* The filled area is White's territory, so it is the ivory of the
                white pieces rather than a chart colour — but pulled back from
                the near-white it used to be. On the ink ground that read as a
                blown-out cloud that outshone the verdict dots sitting on it,
                which are the only part of this chart you are meant to click. */}
            <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#EFEBE0" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#B9B3A4" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d={graph.path} fill="url(#evalFill)" />
          <line
            x1={0}
            y1={H / 2}
            x2={W}
            y2={H / 2}
            stroke="#3FBFA3"
            strokeWidth={0.6}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          {graph.dots.map((d) => (
            <circle
              key={d.ply}
              cx={d.x}
              cy={d.y}
              r={3}
              fill={d.fill}
              stroke="#16202F"
              strokeWidth={1}
            />
          ))}
          {cursor > 0 && (
            <line
              x1={(cursor / N) * W}
              y1={0}
              x2={(cursor / N) * W}
              y2={H}
              stroke="#8B7BE8"
              strokeWidth={1.5}
            />
          )}
        </svg>
      )}

      {/* ---------- Verdict counts ---------- */}
      {hasReview && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="pb-1 text-left font-normal">Move quality</th>
              <th className="w-12 pb-1 text-right font-normal">White</th>
              <th className="w-12 pb-1 text-right font-normal">Black</th>
            </tr>
          </thead>
          <tbody>
            {CLASS_ORDER.map((cls) => {
              const w = counts.white[cls] ?? 0;
              const b = counts.black[cls] ?? 0;
              if (w === 0 && b === 0) return null;
              const meta = CLASS_META[cls];
              return (
                <tr key={cls} className="hover:bg-ivory/[0.04]">
                  <td className="py-0.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
                        style={{ background: meta.bg }}
                      >
                        {meta.glyph}
                      </span>
                      <span className={meta.color}>{meta.label}</span>
                    </span>
                  </td>
                  <td className="text-right font-mono">{w}</td>
                  <td className="text-right font-mono">{b}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
