import { Chess } from "chess.js";

/** SAN or UCI with the parts people leave out or add stripped: captures, checks, "=". */
const key = (s: string) => s.replace(/[x=+#]/g, "");

/**
 * A move typed on the keyboard, as the SAN of the legal move it names in `fen`:
 * "Nf3", "nf3", "Bxc4", "e8=N", "0-0" or UCI "g1f3". Null when it names no legal
 * move, or more than one.
 *
 * Case decides first, so "bc4" is the b-pawn and "Bc4" the bishop; only when
 * case alone finds nothing is "nf3" read as "Nf3".
 */
export function typedMoveSan(fen: string, text: string): string | null {
  const typed = key(text.trim().replace(/[!?]+$/, "").replace(/0/g, "O"));
  if (!typed) return null;
  let legal;
  try {
    legal = new Chess(fen).moves({ verbose: true });
  } catch {
    return null;
  }
  const lower = typed.toLowerCase();
  const tiers = [
    legal.filter((m) => key(m.san) === typed),
    legal.filter((m) => m.from + m.to + (m.promotion ?? "") === lower),
    legal.filter((m) => key(m.san).toLowerCase() === lower),
  ];
  const hit = tiers.find((t) => t.length > 0);
  return hit?.length === 1 ? hit[0].san : null;
}
