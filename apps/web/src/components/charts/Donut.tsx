"use client";

import { useState } from "react";
import { seriesColor } from "@/lib/vizTheme";

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** Overrides the categorical slot, for scales with their own meaning. */
  color?: string;
}

interface Props {
  slices: Slice[];
  /** Drawn in the hole: the total, or whatever the ring is "of". */
  centerValue?: string;
  centerLabel?: string;
  size?: number;
}

const TAU = Math.PI * 2;

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const x1 = cx + r * Math.cos(from);
  const y1 = cy + r * Math.sin(from);
  const x2 = cx + r * Math.cos(to);
  const y2 = cy + r * Math.sin(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/**
 * Composition ring with a legend. Slices are drawn largest-first so the eye
 * lands on what matters, and every slice is named in the legend - the ring
 * alone never has to carry identity.
 */
export default function Donut({
  slices,
  centerValue,
  centerLabel,
  size = 168,
}: Props) {
  const [active, setActive] = useState<string | null>(null);

  const data = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-xs text-muted">No data yet</p>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const stroke = size * 0.17;
  const r = cx - stroke / 2 - 2;

  // A 2px surface gap between slices, expressed as an angle at this radius.
  const gap = data.length > 1 ? 2 / r : 0;
  let cursor = -Math.PI / 2;

  const arcs = data.map((s, i) => {
    const sweep = (s.value / total) * TAU;
    const from = cursor + gap / 2;
    const to = cursor + sweep - gap / 2;
    cursor += sweep;
    return {
      ...s,
      color: s.color ?? seriesColor(i),
      d: to > from ? arc(cx, cy, r, from, to) : null,
      share: (s.value / total) * 100,
    };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
        role="img"
        aria-label={arcs.map((a) => `${a.label} ${a.share.toFixed(1)}%`).join(", ")}
      >
        {arcs.map((a) =>
          a.d ? (
            <path
              key={a.key}
              d={a.d}
              fill="none"
              stroke={a.color}
              strokeWidth={active && active !== a.key ? stroke * 0.72 : stroke}
              strokeLinecap="butt"
              opacity={active && active !== a.key ? 0.45 : 1}
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
              className="transition-all duration-150"
            />
          ) : null
        )}
        {(centerValue || active) && (
          <>
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              className="fill-ink text-[15px] font-bold"
            >
              {active
                ? `${arcs.find((a) => a.key === active)!.share.toFixed(1)}%`
                : centerValue}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              className="fill-muted text-[9px] uppercase tracking-wider"
            >
              {active ? arcs.find((a) => a.key === active)!.label : centerLabel}
            </text>
          </>
        )}
      </svg>

      <ul className="min-w-[9rem] space-y-1 text-xs">
        {arcs.map((a) => (
          <li
            key={a.key}
            className={`flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors ${
              active === a.key ? "bg-ivory/[0.07]" : ""
            }`}
            onMouseEnter={() => setActive(a.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ background: a.color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">{a.label}</span>
            <span className="font-mono font-semibold text-ink">
              {a.share.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
