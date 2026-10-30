/**
 * Chart palettes for Insights, validated rather than eyeballed.
 *
 * Surface is a glass card as it actually renders over the walnut desk
 * (#2E231B); the app is one dark field, so there is one set of steps, chosen
 * for that surface. Every ΔE and contrast figure below is output from
 * `apps/web/scripts/palette-check.py` - re-run it after touching a colour here
 * OR after changing the glass recipe in globals.css, because the contrast gate
 * is measured against that surface.
 *
 * ---------------------------------------------------------------------------
 * OUTCOME (win / draw / loss) - a diverging scale, not a categorical one.
 *
 * Win is green and loss is terracotta, which is the same pairing the rest of
 * the app uses for "right" and "lost", so a result chart reads in the vocabulary
 * the drill screens already taught. The catch: any mid-green against any
 * mid-red is nearly one colour under deuteranopia - the two most important
 * colours on the page would be indistinguishable to a red-green colourblind
 * reader.
 *
 * The fix is that WIN AND LOSS ARE SEPARATED BY LIGHTNESS, not by hue: L* 81.7
 * against L* 52.1, which survives greyscale printing too. Do not "correct"
 * these two steps toward each other - that is precisely the failure this
 * spacing exists to avoid.
 *
 * Two categorical gates fail on this triad by design, because it is diverging:
 *   - the neutral midpoint is below the chroma floor (a diverging midpoint is
 *     required to be neutral, never a hue)
 *   - the light green sits above the categorical lightness band (the band
 *     assumes equal-weight slots; the whole point here is unequal lightness)
 * The gates that do apply pass on ALL pairs: CVD ΔE 18.4 (worst, tritan),
 * normal-vision 29.3, contrast ≥ 3:1 (worst 3.68, the terracotta loss).
 *
 * The midpoint is pewter rather than a warm taupe: on walnut a warm neutral
 * sinks into the timber and reads as part of the desk rather than as a result,
 * and against terracotta it collapses under protanopia. Pewter is near-neutral
 * (C* 6.6), so it still reads as the absence of a hue.
 *
 * Even so, outcome is never encoded by colour alone: segments are always in
 * win → draw → loss order, always directly labelled, and always legended.
 * ---------------------------------------------------------------------------
 */
export const OUTCOME = {
  win: "#94DBA6",
  draw: "#8F99A3",
  loss: "#D4513F",
} as const;

/**
 * Categorical slots, assigned in this fixed order and never cycled. Passes
 * every gate on the glass surface: lightness band, chroma floor, adjacent CVD
 * (worst ΔE 15.5), normal-vision floor (worst ΔE 18.4), contrast (worst 4.49).
 *
 * The ORDER is the colourblind-safety mechanism, not decoration, and this
 * particular order was found by searching all 720 permutations for the one with
 * the best worst-case adjacent CVD separation - the hand-picked order that
 * looked sensible failed the tritan gate at ΔE 8.1, because olive and violet
 * ended up neighbours. Re-ordering silently breaks it; re-run the validator if
 * you must.
 *
 * Past six categories, fold the tail into "Other" rather than inventing a
 * seventh hue.
 */
export const SERIES = [
  "#5AA0E0", // blue
  "#D9A356", // amber
  "#35B29B", // teal
  "#9080E6", // violet
  "#D4688C", // rose
  "#8CB43F", // olive
] as const;

/**
 * Single hue, light -> dark, for magnitude (accuracy columns). A mint-teal
 * ramp, so a magnitude chart stays inside the app's vocabulary. Smallest step
 * between neighbours is ΔE 10.4, comfortably above a just-noticeable
 * difference; the darkest step holds 2.42:1 on the glass, which is acceptable
 * only because a ramp step is a filled area that is never asked to carry text.
 */
export const SEQUENTIAL = ["#DEE8E1", "#A9CFC1", "#72B4A0", "#47907D", "#2C6A5C"];

export const AXIS = "#CFBEA4";
export const GRID = "rgba(255,236,208,0.08)";

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
