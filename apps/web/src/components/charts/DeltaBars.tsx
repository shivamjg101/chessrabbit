"use client";

import { OUTCOME } from "@/lib/vizTheme";

export interface DeltaRow {
  key: string;
  label: string;
  value: number | null;
  sub?: string;
}

interface Props {
  rows: DeltaRow[];
  /** The centre line every row is measured against. */
  baseline: number;
  baselineLabel: string;
  unit?: string;
}

/**
 * Diverging bars centred on a baseline — "how far above or below your own
 * average is this?".
 *
 * Absolute bars are the wrong form here: accuracies live in a narrow band near
 * the top of a 0–100 scale, so on an honest zero baseline every bar is the same
 * height and the chart says nothing. Measuring the delta instead makes the
 * comparison the reader actually wants (which piece costs me accuracy?) the
 * thing the bar length encodes — without truncating any axis.
 *
 * Above/below is doubled up as a sign on the label, so the reading never rests
 * on telling the two hues apart.
 */
export default function DeltaBars({
  rows,
  baseline,
  baselineLabel,
  unit = "",
}: Props) {
  const present = rows.filter((r) => r.value !== null);
  if (present.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">Not enough data yet</p>;
  }

  const deltas = present.map((r) => Math.abs(r.value! - baseline));
  // A little headroom so the longest bar never touches the edge.
  const span = Math.max(...deltas, 1) * 1.15;

  return (
    <div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const delta = r.value === null ? 0 : r.value - baseline;
          const width = (Math.abs(delta) / span) * 50;
          const above = delta >= 0;
          return (
            <div key={r.key} className="flex items-center gap-2">
              <span className="w-16 shrink-0 truncate text-xs text-muted" title={r.label}>
                {r.label}
              </span>

              <div className="relative h-5 min-w-0 flex-1">
                {/* Centre line: the baseline itself */}
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/20" />
                {r.value !== null && (
                  <div
                    className="absolute top-1/2 h-2.5 -translate-y-1/2 transition-all duration-500"
                    style={{
                      left: above ? "50%" : `${50 - width}%`,
                      width: `${width}%`,
                      background: above ? OUTCOME.win : OUTCOME.loss,
                      // 4px rounded data-end, square against the baseline.
                      borderRadius: above ? "0 4px 4px 0" : "4px 0 0 4px",
                    }}
                    title={`${r.label}: ${r.value}${unit} (${
                      above ? "+" : ""
                    }${delta.toFixed(1)} vs ${baselineLabel})`}
                  />
                )}
              </div>

              <span className="w-11 shrink-0 text-right font-mono text-[11px] font-semibold text-ink">
                {r.value === null ? "—" : `${above ? "+" : "−"}${Math.abs(delta).toFixed(1)}`}
              </span>
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted/70">
                {r.value === null ? "" : r.value.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 border-t border-line/35 pt-2 text-[11px] text-muted">
        Centre line is {baselineLabel} ({baseline.toFixed(1)}
        {unit}). Right of it is better than your average, left is worse.
      </p>
    </div>
  );
}
