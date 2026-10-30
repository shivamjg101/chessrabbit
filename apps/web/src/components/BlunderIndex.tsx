"use client";

import { Annotation } from "@/lib/api";
import { CLASS_META } from "@/lib/classification";
import { selectBlunders } from "@/lib/blunderIndex";

/**
 * Every move in the game that went wrong, in the order it went wrong, as one
 * strip you can click through.
 *
 * The move list already contains this information, but it contains it the way a
 * transcript contains an argument: you have to read the whole thing to find the
 * four moves that mattered. Reviewing a game is not reading it start to finish —
 * it is going to the mistakes. This is that list, and nothing else.
 *
 * The chip IS the move number: `24??` is move 24, and the glyph is the verdict.
 * Move numbers are real sequence data, so they are doing the indexing here
 * rather than decorating it.
 */

interface Props {
  annotations: Annotation[];
  /** Ply currently under the cursor, so the strip can show where you are. */
  cursor: number;
  onSeek: (ply: number) => void;
}

export default function BlunderIndex({ annotations, cursor, onSeek }: Props) {
  const { kept, hidden, total } = selectBlunders(annotations);
  if (total === 0) return null;

  return (
    <div>
      <p className="rule-label mb-2">
        Where it went wrong
        <span className="font-mono text-faint">{total}</span>
      </p>

      <div className="flex flex-wrap gap-1">
        {kept.map((a) => {
          const meta = CLASS_META[a.classification!];
          // Ply 0 is White's first move, which players call "1.".
          const moveNo = Math.floor(a.ply / 2) + 1;
          const black = a.ply % 2 === 1;
          const here = cursor === a.ply + 1;
          return (
            <button
              key={a.ply}
              onClick={() => onSeek(a.ply + 1)}
              aria-current={here ? "true" : undefined}
              title={`${moveNo}${black ? "…" : "."} ${a.move_san ?? ""} — ${meta.label}`}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px]
                          tabular-nums transition-colors ${
                            here
                              ? "bg-ivory/[0.14] text-ink shadow-edge ring-1 ring-brass/50"
                              : "bg-ivory/[0.05] text-muted ring-1 ring-ivory/[0.06] hover:bg-ivory/10 hover:text-ink"
                          }`}
            >
              <span>
                {moveNo}
                {black ? "…" : ""}
              </span>
              <span style={{ color: meta.bg }}>{meta.glyph}</span>
            </button>
          );
        })}
      </div>

      {hidden > 0 && (
        <p className="mt-1.5 text-[11px] text-faint">
          Showing the {kept.length} worst. {hidden} smaller slip
          {hidden === 1 ? "" : "s"} are in the move list.
        </p>
      )}
    </div>
  );
}
