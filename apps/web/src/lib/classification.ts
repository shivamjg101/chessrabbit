import type { Classification } from "@/lib/api";

/**
 * How each move verdict is drawn: the badge glyph, the badge fill, and the
 * text colour used in the move list.
 *
 * These used to be chess.com's review colours, borrowed on the grounds that
 * players arrive fluent in them. They are now derived from the app's own
 * palette instead, and the scale is built from two different mechanisms
 * because the two halves are not doing the same job:
 *
 *   THE GOOD HALF IS A CHROMA DECAY.  best is full verdigris; excellent is a
 *   paler wash of it; good is very nearly neutral sage. A move that was fine
 *   should fade out of the move list, not compete for attention with the one
 *   that lost the game.
 *
 *   THE BAD HALF IS A LIGHTNESS DESCENT.  inaccuracy is pale brass, mistake
 *   is brass, blunder is coral, and each step is a real drop in L*. Hue alone
 *   would collapse under red-green colour blindness; lightness does not.
 *
 * Book sits off the scale entirely, in chalk-blue: an opening move is not a
 * verdict, and colouring it anywhere on the verdigris-to-coral run would imply
 * a judgement that nobody made.
 *
 * Validated with apps/web/scripts/palette-check.py against the `panel` surface:
 * every good-half / bad-half pair holds ΔE >= 19 under protanopia, deuteranopia
 * and tritanopia, so "fine" and "trouble" can never be confused. excellent and
 * good DO collapse under deuteranopia (ΔE 6.8) and that is deliberate - they
 * both mean "non-event". Every verdict also carries its own glyph, so colour is
 * never the only channel.
 */
export const CLASS_META: Record<
  Classification,
  { glyph: string; color: string; label: string; bg: string }
> = {
  book: { glyph: "◆", color: "text-[#8FA9CE]", label: "Book", bg: "#8FA9CE" },
  best: { glyph: "★", color: "text-accent", label: "Best", bg: "#70C586" },
  excellent: { glyph: "✓", color: "text-good", label: "Excellent", bg: "#B6E1B8" },
  good: { glyph: "✓", color: "text-[#9DB0AC]", label: "Good", bg: "#9DB0AC" },
  inaccuracy: { glyph: "?!", color: "text-[#F2D177]", label: "Inaccuracy", bg: "#F2D177" },
  mistake: { glyph: "?", color: "text-warn", label: "Mistake", bg: "#EE9E46" },
  blunder: { glyph: "??", color: "text-bad", label: "Blunder", bg: "#E66250" },
};

/** Order used wherever verdicts are listed: strongest first, worst last. */
export const CLASS_ORDER: Classification[] = [
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "blunder",
];

/** Names the move and its verdict, the way a coach would say it. */
export function headline(san: string, cls: Classification): string {
  switch (cls) {
    case "book":
      return `${san} is a book move`;
    case "best":
      return `${san} is the best move`;
    case "excellent":
      return `${san} is excellent`;
    case "good":
      return `${san} is a good move`;
    case "inaccuracy":
      return `${san} is an inaccuracy`;
    case "mistake":
      return `${san} is a mistake`;
    case "blunder":
      return `${san} is a blunder`;
  }
}
