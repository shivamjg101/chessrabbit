"use client";

import { SEQUENTIAL } from "@/lib/vizTheme";

export interface Column {
  key: string;
  label: string;
  value: number | null;
  /** Secondary line under the axis label, e.g. a sample size. */
  sub?: string;
  color?: string;
}

interface Props {
  columns: Column[];
  /** Axis top. Accuracy is a percentage, so it defaults to 100. */
  max?: number;
  /**
   * Axis floor. ONLY honoured in `dot` mode, and that restriction is the whole
   * point: a bar encodes its value as length from the baseline, so moving the
   * baseline off zero makes it lie about the ratio between two bars. A dot
   * encodes position, which a labelled non-zero axis does not distort.
   */
  min?: number;
  /**
   * `bar` for magnitudes that start at zero (counts, shares). `dot` for a
   * bounded measure clustered in a narrow band — accuracy sits between about
   * 60 and 95, and drawn as bars from zero those all render as near-identical
   * full-height blocks: maximum ink, minimum information, in the loudest
   * colours the palette has.
   */
  mode?: "bar" | "dot";
  unit?: string;
  height?: number;
  /** Rendered where a column has no value at all. */
  emptyNote?: string;
}

/**
 * One measure across a handful of categories.
 *
 * Built from divs rather than SVG so the value labels stay crisp at any width
 * and never distort with the plot. Every column is directly labelled, which is
 * also what lets a single hue carry the whole chart.
 */
export default function Columns({
  columns,
  max = 100,
  min = 0,
  mode = "bar",
  unit = "",
  height = 148,
  emptyNote = "Not enough reviewed games",
}: Props) {
  const floor = mode === "dot" ? min : 0;
  const span = Math.max(1, max - floor);
  const present = columns.filter((c) => c.value !== null);
  if (present.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">{emptyNote}</p>;
  }

  return (
    <div>
      <div
        className="relative flex items-end gap-2 border-b border-line/35"
        style={{ height }}
      >
        {/* In dot mode the axis does not start at zero, so it has to say so. */}
        {mode === "dot" && (
          <>
            <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line/35" />
            <span className="pointer-events-none absolute left-0 top-0 -translate-y-1/2 bg-panel px-1 font-mono text-[10px] text-faint">
              {max}
              {unit}
            </span>
            <span className="pointer-events-none absolute bottom-0 left-0 translate-y-1/2 bg-panel px-1 font-mono text-[10px] text-faint">
              {floor}
              {unit}
            </span>
          </>
        )}

        {columns.map((c) => {
          const value = c.value ?? 0;
          const share = Math.max(0, Math.min(100, ((value - floor) / span) * 100));
          return (
            <div
              key={c.key}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={c.value === null ? "No data" : `${c.label}: ${value}${unit}`}
            >
              {c.value !== null &&
                (mode === "dot" ? (
                  <div
                    className="relative w-full"
                    style={{ height: `${share}%` }}
                  >
                    {/* A hairline stem down to the axis, so the dot reads as a
                        position on a scale rather than as a floating mark. */}
                    <span
                      className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2"
                      style={{ background: `${c.color ?? SEQUENTIAL[2]}44` }}
                    />
                    <span
                      className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{ background: c.color ?? SEQUENTIAL[2] }}
                    />
                    <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[150%] whitespace-nowrap font-mono text-[11px] font-semibold text-ink">
                      {value}
                      {unit}
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="mb-1 text-center font-mono text-[11px] font-semibold text-ink">
                      {value}
                      {unit}
                    </span>
                    <div
                      className="w-full rounded-t-[4px] transition-[height] duration-500 ease-out"
                      style={{
                        height: `${share}%`,
                        background: c.color ?? SEQUENTIAL[2],
                      }}
                    />
                  </>
                ))}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1.5">
        {columns.map((c) => (
          <div key={c.key} className="min-w-0 flex-1 text-center">
            <div className="truncate text-[11px] text-muted">{c.label}</div>
            {c.sub && (
              <div className="truncate font-mono text-[10px] text-muted/70">{c.sub}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
