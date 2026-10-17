"use client";

import { Classification } from "@/lib/api";
import { CLASS_META, headline } from "@/lib/classification";

/**
 * What the engine thinks of the move under the cursor.
 *
 * This used to live inside the Review tab, which put the screen's entire job
 * behind a tab you had to choose — and because it was hidden there, the same
 * sentence had to be repeated inside the Moves tab so it was visible while you
 * tried alternatives. Two copies of one verdict, neither of them always on.
 *
 * It is a fixed plate above the tab strip now. The tabs are for the four
 * genuinely parallel things you might want next to a verdict (the move list,
 * the game report, the engine, the book). The verdict itself is not one of
 * four options; it is why the screen exists.
 */

export interface Verdict {
  cls: Classification;
  san: string;
  why: string | null;
  /** Formatted evaluation, e.g. "+1.4" or "-M3". */
  score: string | null;
  /** True when this came from the live engine rather than the saved review. */
  live: boolean;
  bestSan?: string | null;
}

interface Props {
  verdict: Verdict | null;
  /** Put the engine's preference on the board beside the move played. */
  onShowBest?: (san: string) => void;
  /** Drives the placeholder copy when there is no verdict to show. */
  reviewing?: boolean;
  hasReview?: boolean;
  canRun?: boolean;
}

export default function VerdictPlate({
  verdict,
  onShowBest,
  reviewing = false,
  hasReview = false,
  canRun = false,
}: Props) {
  if (!verdict) {
    return (
      <div className="rounded-md bg-panelAlt/70 p-3 ring-1 ring-line/35">
        <p className="text-sm font-semibold text-ink">
          {reviewing
            ? "Scoring every move…"
            : hasReview
              ? "Step through the game"
              : canRun
                ? "Ready to review"
                : "Open a game to review it"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {reviewing
            ? "The engine is scoring both sides. This takes a few seconds."
            : hasReview
              ? "Pick any move to see what happened there."
              : canRun
                ? "Every move gets classified, both sides get scored, and each blunder stays bound to the position it happened in."
                : "Pick a game from the rail, or import a PGN."}
        </p>
      </div>
    );
  }

  const meta = CLASS_META[verdict.cls];
  const showBest =
    verdict.bestSan && verdict.cls !== "best" && verdict.cls !== "book";

  return (
    <div
      key={`${verdict.san}-${verdict.cls}-${verdict.live}`}
      className="relative animate-rise rounded-md bg-panelAlt/90 p-3 pl-4 ring-1 ring-line/35"
      style={{ borderLeft: `3px solid ${meta.bg}` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 shrink-0 animate-pop place-items-center rounded font-mono font-semibold"
          style={
            verdict.live
              ? {
                  color: meta.bg,
                  boxShadow: `inset 0 0 0 1.5px ${meta.bg}`,
                  fontSize: meta.glyph.length > 1 ? 11 : 13,
                }
              : {
                  background: meta.bg,
                  color: "#FFF8EA",
                  fontSize: meta.glyph.length > 1 ? 11 : 13,
                }
          }
        >
          {meta.glyph}
        </span>
        <span className="text-sm font-semibold leading-tight text-ink">
          {headline(verdict.san, verdict.cls)}
        </span>
        {verdict.score && (
          <span className="ml-auto shrink-0 rounded bg-night/60 px-1.5 py-0.5 font-mono text-xs text-ink">
            {verdict.score}
          </span>
        )}
      </div>

      {verdict.why && (
        <p className="mt-2 text-xs leading-relaxed text-ink/75">{verdict.why}</p>
      )}

      {/* Never let a live verdict be mistaken for the reviewed game. */}
      {verdict.live && (
        <p className="mt-1.5 text-[11px] text-muted">
          Live engine — this move isn&rsquo;t part of the game.
        </p>
      )}

      {showBest &&
        (onShowBest ? (
          <button
            onClick={() => onShowBest(verdict.bestSan!)}
            className="mt-2 flex items-center gap-1.5 rounded border border-brass/40 bg-brass/10
                       px-2 py-1 text-xs text-brassLit transition-colors hover:bg-brass/20"
          >
            Best was <span className="san text-brassLit">{verdict.bestSan}</span>
            <span className="text-brass">— show me</span>
          </button>
        ) : (
          <p className="mt-2 text-xs text-brassLit">
            Best was <span className="san text-brassLit">{verdict.bestSan}</span>
          </p>
        ))}
    </div>
  );
}
