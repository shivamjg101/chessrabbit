import type { Classification } from "@/lib/api";

/** Move verdict text and badge colours on cream surfaces. Every filled badge
 * has a light glyph; the glyph also distinguishes verdicts without colour. */
export const CLASS_META: Record<
  Classification,
  { glyph: string; color: string; label: string; bg: string }
> = {
  book: { glyph: "◆", color: "text-[#526A77]", label: "Book", bg: "#526A77" },
  best: { glyph: "★", color: "text-accent", label: "Best", bg: "#286047" },
  excellent: { glyph: "✓", color: "text-good", label: "Excellent", bg: "#326747" },
  good: { glyph: "✓", color: "text-[#4E6244]", label: "Good", bg: "#4E6244" },
  inaccuracy: { glyph: "?!", color: "text-[#805916]", label: "Inaccuracy", bg: "#805916" },
  mistake: { glyph: "?", color: "text-warn", label: "Mistake", bg: "#855016" },
  blunder: { glyph: "??", color: "text-bad", label: "Blunder", bg: "#A0352A" },
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
