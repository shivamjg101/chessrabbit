"use client";

/**
 * Where the clock went: time spent on every move, both sides on one chart,
 * and the few numbers that say whether the time was spent well.
 *
 * Everything here comes from the `[%clk]` readings Lichess and Chess.com write
 * after each move - a game without them simply has no panel. Reviewed moves
 * keep their verdict colour on the chart, so a blunder played with seconds left
 * and one played after a long think look different at a glance.
 */

import { useMemo, useRef } from "react";
import { Annotation, Classification } from "@/lib/api";
import { CLASS_META } from "@/lib/classification";
import {
  TimeControl,
  formatSpent,
  lowClockMark,
  moveTimes,
  sideClocks,
  sideOf,
  timeControlLabel,
} from "@/lib/clock";

const W = 300;
const H = 84;
const MID = H / 2;

/** Verdicts that recolour a bar; the rest stay the side's own colour. */
const MARKED: Classification[] = ["inaccuracy", "mistake", "blunder"];
const ERRORS: Classification[] = ["mistake", "blunder"];

interface Props {
  history: string[];
  /** The mover's clock after each main-line move, or null without a reading. */
  clocks: (number | null)[];
  timeControl: TimeControl | null;
  /** Who made the game's first move: Black in a position set up for Black. */
  firstMover: "white" | "black";
  /** The full-move number of that first move. */
  firstMoveNumber: number;
  annotations: Annotation[];
  cursor: number;
  onSeek: (ply: number) => void;
}

export default function ClockPanel({
  history,
  clocks,
  timeControl,
  firstMover,
  firstMoveNumber,
  annotations,
  cursor,
  onSeek,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const N = history.length;

  const times = useMemo(() => moveTimes(clocks, timeControl), [clocks, timeControl]);
  const sides = useMemo(
    () => sideClocks(clocks, times, timeControl, firstMover),
    [clocks, times, timeControl, firstMover]
  );
  const verdict = useMemo(() => {
    const byPly = new Map<number, Classification>();
    for (const a of annotations) if (a.classification) byPly.set(a.ply, a.classification);
    return byPly;
  }, [annotations]);

  const readings = clocks.filter((c) => c != null).length;
  if (N === 0 || readings < 2) return null;

  const longest = Math.max(1, ...times.map((t) => t ?? 0));
  const lowMark = lowClockMark(timeControl);
  const reviewed = verdict.size > 0;

  /** The full-move number of main-line move `i`. */
  const moveNumber = (i: number) =>
    firstMoveNumber + Math.floor((i + (firstMover === "black" ? 1 : 0)) / 2);

  /** "17. Nf5" or "17… Nf5". */
  const moveName = (i: number) =>
    `${moveNumber(i)}${sideOf(i, firstMover) === "white" ? "." : "…"} ${history[i] ?? ""}`;

  /** Mistakes and blunders each side decided with the clock already short. */
  const errorsWhenShort = (side: "white" | "black") => {
    let short = 0;
    let all = 0;
    verdict.forEach((cls, i) => {
      if (!ERRORS.includes(cls) || sideOf(i, firstMover) !== side) return;
      all += 1;
      // The clock that mattered is the one the move was decided on.
      const before = i >= 2 ? clocks[i - 2] : timeControl?.base ?? null;
      if (before != null && before < lowMark) short += 1;
    });
    return { short, all };
  };

  const seekFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * N);
    onSeek(Math.max(1, Math.min(N, i + 1)));
  };

  const barW = W / N;
  const rows: { label: string; white: React.ReactNode; black: React.ReactNode }[] = [
    {
      label: "Time used",
      white: sides.white.measured ? formatSpent(sides.white.total) : "–",
      black: sides.black.measured ? formatSpent(sides.black.total) : "–",
    },
    {
      label: "Average move",
      white: sides.white.measured ? formatSpent(sides.white.total / sides.white.measured) : "–",
      black: sides.black.measured ? formatSpent(sides.black.total / sides.black.measured) : "–",
    },
  ];

  const seekButton = (index: number | null, text: (i: number) => string) =>
    index == null ? (
      "–"
    ) : (
      <button
        className="underline decoration-ivory/25 underline-offset-2 hover:text-ink"
        onClick={() => onSeek(index + 1)}
        title={moveName(index)}
      >
        {text(index)}
      </button>
    );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted">Clock</p>
        {timeControl && (
          <p className="font-mono text-[11px] text-muted">{timeControlLabel(timeControl)}</p>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-20 w-full cursor-crosshair rounded-2xl bg-ebony ring-1 ring-ivory/[0.08]"
        onPointerDown={seekFromPointer}
        onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e)}
        role="img"
        aria-label="Time spent on each move, White above the line and Black below — click to jump to a move"
      >
        {times.map((t, i) => {
          if (t == null) return null;
          const h = Math.max(0.8, (t / longest) * (MID - 4));
          const white = sideOf(i, firstMover) === "white";
          const cls = verdict.get(i);
          const marked = cls && MARKED.includes(cls) ? CLASS_META[cls].bg : undefined;
          return (
            <rect
              key={i}
              x={i * barW + barW * 0.15}
              y={white ? MID - h : MID}
              width={Math.max(0.6, barW * 0.7)}
              height={h}
              rx={Math.min(1.5, barW * 0.2)}
              className={marked ? undefined : white ? "fill-ivory/75" : "fill-brass/80"}
              fill={marked}
              opacity={cursor > 0 && cursor - 1 !== i ? 0.85 : 1}
            >
              <title>{`${moveName(i)} — ${formatSpent(t)}`}</title>
            </rect>
          );
        })}
        <line x1={0} y1={MID} x2={W} y2={MID} stroke="#8F8676" strokeWidth={0.5} opacity={0.6} />
        {cursor > 0 && (
          <rect
            x={(cursor - 1) * barW}
            y={0}
            width={barW}
            height={H}
            fill="#8B7BE8"
            opacity={0.22}
          />
        )}
      </svg>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted">
            <th className="pb-1 text-left font-normal">Time</th>
            <th className="w-16 pb-1 text-right font-normal">White</th>
            <th className="w-16 pb-1 text-right font-normal">Black</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.label} className="hover:bg-ivory/[0.04]">
              <td className="py-0.5 font-sans">{r.label}</td>
              <td className="text-right">{r.white}</td>
              <td className="text-right">{r.black}</td>
            </tr>
          ))}
          <tr className="hover:bg-ivory/[0.04]">
            <td className="py-0.5 font-sans">Longest think</td>
            <td className="text-right">
              {seekButton(sides.white.longest?.index ?? null, () => formatSpent(sides.white.longest!.seconds))}
            </td>
            <td className="text-right">
              {seekButton(sides.black.longest?.index ?? null, () => formatSpent(sides.black.longest!.seconds))}
            </td>
          </tr>
          <tr className="hover:bg-ivory/[0.04]">
            <td className="py-0.5 font-sans" title={`Under ${formatSpent(lowMark)} left on the clock`}>
              Short of time from
            </td>
            <td className="text-right">
              {seekButton(sides.white.lowFrom, (i) => `move ${moveNumber(i)}`)}
            </td>
            <td className="text-right">
              {seekButton(sides.black.lowFrom, (i) => `move ${moveNumber(i)}`)}
            </td>
          </tr>
          {reviewed && (
            <tr className="hover:bg-ivory/[0.04]">
              <td className="py-0.5 font-sans" title="Mistakes and blunders decided with the clock already short">
                Errors when short
              </td>
              {(["white", "black"] as const).map((side) => {
                const { short, all } = errorsWhenShort(side);
                return (
                  <td key={side} className={`text-right ${short > 0 ? "text-warn" : ""}`}>
                    {all ? `${short} of ${all}` : "–"}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
