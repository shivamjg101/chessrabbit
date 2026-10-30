"use client";

/**
 * Vertical evaluation bar, full board height. White's share of the bar grows
 * from White's own side, so the bar reads the same way the board does - and
 * flips with it.
 */
interface Props {
  /** White's share of the bar, 0-100. */
  pct: number;
  /** Formatted eval, e.g. "+0.34" or "M5". */
  text: string;
  whiteAhead: boolean;
  /** True when the board is viewed from Black's side. */
  flipped: boolean;
  height: number;
}

export default function EvalBar({ pct, text, whiteAhead, flipped, height }: Props) {
  const whiteAtBottom = !flipped;
  // The number sits at the leader's end of the bar.
  const labelAtBottom = whiteAhead === whiteAtBottom;

  return (
    <div
      className="relative w-5 shrink-0 overflow-hidden rounded-full bg-ebony/80 shadow-card ring-1 ring-ivory/20"
      style={{ height: height || undefined }}
      title={`Evaluation ${text}`}
      aria-label={`Evaluation ${text}`}
    >
      <div
        className={`absolute inset-x-0 bg-gradient-to-b from-white to-ivory transition-[height] duration-500 ease-out ${
          whiteAtBottom ? "bottom-0" : "top-0"
        }`}
        style={{ height: `${pct}%` }}
      />
      {/* Midpoint tick - equal position at a glance */}
      <div className="absolute inset-x-0 top-1/2 h-px bg-brass/60" />
      <span
        className={`absolute inset-x-0 text-[9px] leading-none font-mono font-bold text-center
                    ${labelAtBottom ? "bottom-1" : "top-1"}
                    ${whiteAhead ? "text-ebony" : "text-ink"}`}
      >
        {text}
      </span>
    </div>
  );
}
