"use client";

import { useMemo, useRef, useState } from "react";
import { AXIS, GRID } from "@/lib/vizTheme";

export interface Point {
  label: string;
  value: number;
  /** Extra line in the tooltip, e.g. "412 moves". */
  note?: string;
}

interface Props {
  points: Point[];
  color: string;
  /** Fixed axis bounds. Omit `max` to fit the data. */
  min?: number;
  max?: number;
  unit?: string;
  height?: number;
  /** Reference line, e.g. the player's average. */
  baseline?: { value: number; label: string };
}

const W = 600; // viewBox width; the SVG itself is fluid

/**
 * A single measure over an ordered axis (months, move numbers).
 *
 * Carries a crosshair + tooltip on hover, because an HTML chart that shows a
 * shape but won't tell you a value is only half a chart. Axis labels are HTML
 * beneath the plot so they stay crisp while the plot scales.
 */
export default function AreaChart({
  points,
  color,
  min,
  max,
  unit = "",
  height = 160,
  baseline,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const lo = min ?? Math.min(...values, baseline?.value ?? Infinity);
    const hi = max ?? Math.max(...values, baseline?.value ?? -Infinity);
    const span = hi - lo || 1;
    const H = 100;

    const x = (i: number) =>
      points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
    const y = (v: number) => H - ((v - lo) / span) * H;

    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    return {
      lo,
      hi,
      H,
      x,
      y,
      line: `M${line.join(" L")}`,
      area: `M${x(0)},${H} L${line.join(" L")} L${x(points.length - 1)},${H} Z`,
    };
  }, [points, min, max, baseline]);

  if (!geom) {
    return <p className="py-6 text-center text-xs text-muted">No data yet</p>;
  }

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1)))));
  };

  const active = hover === null ? null : points[hover];
  const gradId = `area-${color.replace("#", "")}`;

  return (
    <div>
      <div
        ref={ref}
        className="relative"
        style={{ height }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${geom.H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`${points[0].label} to ${points[points.length - 1].label}: ${
            points[0].value
          }${unit} to ${points[points.length - 1].value}${unit}`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={0}
              y1={geom.H * t}
              x2={W}
              y2={geom.H * t}
              stroke={GRID}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={geom.area} fill={`url(#${gradId})`} />
          <path
            d={geom.line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {baseline && (
            <line
              x1={0}
              y1={geom.y(baseline.value)}
              x2={W}
              y2={geom.y(baseline.value)}
              stroke={AXIS}
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {hover !== null && (
            <line
              x1={geom.x(hover)}
              y1={0}
              x2={geom.x(hover)}
              y2={geom.H}
              stroke={color}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Marker and tooltip live in HTML so neither is distorted by the
            non-uniform viewBox scaling the plot uses. */}
        {hover !== null && active && (
          <>
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
              style={{
                left: `${(geom.x(hover) / W) * 100}%`,
                top: `${(geom.y(active.value) / geom.H) * 100}%`,
                background: color,
                // 2px surface ring, so the marker reads on top of the fill.
                boxShadow: "0 0 0 2px #2E231B",
              }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-ivory/10 bg-panelAlt px-2 py-1 text-[11px] shadow-card"
              style={{
                left: `${Math.max(12, Math.min(88, (geom.x(hover) / W) * 100))}%`,
                top: `${Math.max(0, (geom.y(active.value) / geom.H) * 100 - 8)}%`,
              }}
            >
              <div className="font-mono font-semibold text-ink">
                {active.value}
                {unit}
              </div>
              <div className="text-muted">{active.label}</div>
              {active.note && <div className="text-muted/70">{active.note}</div>}
            </div>
          </>
        )}
      </div>

      {/* The plot fits its range rather than starting at zero — legitimate for
          a line, where position carries the value — so the range is stated. */}
      <div className="flex items-baseline justify-between pt-1 font-mono text-[10px] text-muted">
        <span>{points[0].label}</span>
        <span className="text-muted/60">
          {geom.lo.toFixed(0)}–{geom.hi.toFixed(0)}
          {unit}
          {baseline ? ` · ${baseline.label}` : ""}
        </span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}
