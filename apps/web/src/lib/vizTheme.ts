/** Insights chart colours on the cream panel surface. Keep these values in
 * step with scripts/palette-check.py, including its contrast and CVD checks. */
export const OUTCOME = {
  win: "#2E8056",
  draw: "#65707E",
  loss: "#922D25",
} as const;

/** Fixed order keeps adjacent series distinguishable under colour blindness. */
export const SERIES = [
  "#2D67A5", // blue
  "#875413", // amber
  "#286047", // green
  "#6C4D9D", // violet
  "#9B3D64", // rose
  "#597523", // olive
] as const;

/** Light to dark green for filled magnitude charts, never for chart text. */
export const SEQUENTIAL = ["#D9E8DC", "#A7CBAF", "#76AD83", "#4D8862", "#286047"];

export const AXIS = "#604B39";
export const GRID = "rgba(48,35,24,0.14)";

/** Colour for slot `i`, folding anything past the palette into the last hue. */
export function seriesColor(i: number): string {
  return SERIES[Math.min(i, SERIES.length - 1)];
}

/** Sequential step for a 0..1 magnitude. */
export function sequentialColor(t: number): string {
  const i = Math.round(Math.max(0, Math.min(1, t)) * (SEQUENTIAL.length - 1));
  return SEQUENTIAL[i];
}

export const SHAPE_LABELS: Record<string, { label: string; blurb: string }> = {
  smooth: { label: "Smooth", blurb: "One side stayed on top; little changed." },
  grind: { label: "Grind", blurb: "Long and quiet — 40+ moves, few swings." },
  sudden: { label: "Sudden", blurb: "Calm, then one decisive swing." },
  sharp: { label: "Sharp", blurb: "Repeatedly volatile evaluation." },
  wild: { label: "Wild", blurb: "Volatile, and the advantage changed hands." },
};

export const TERMINATION_LABELS: Record<string, string> = {
  checkmate: "Checkmate",
  resignation: "Resignation",
  timeout: "Timeout",
  abandoned: "Abandonment",
  agreement: "Agreement",
  stalemate: "Stalemate",
  repetition: "Repetition",
  insufficient: "Insufficient material",
  fifty_move: "50-move rule",
  other: "Other",
};

export const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export const PHASE_LABELS: Record<string, string> = {
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame",
  none: "Never castled",
};

/** Percentages that always sum to 100, so a stacked bar never shows a seam. */
export function shares(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  return parts.map((p) => (p / total) * 100);
}

export function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}
