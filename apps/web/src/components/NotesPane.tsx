"use client";

import { useEffect, useRef, useState } from "react";
import { GLYPHS, GlyphFamily } from "@/lib/nags";
import { BRUSH_COLOR, Shape } from "@/lib/shapes";

/**
 * What you write about the position you are looking at.
 *
 * In a study this is the point — the moves are the evidence and this is the
 * argument. It writes to the same place PGN keeps it, so a chapter annotated
 * here opens annotated in ChessBase, Lichess or anything else that reads the
 * format.
 *
 * The textarea is deliberately uncontrolled-ish: it holds a local draft and
 * pushes it up on a pause, because the tree it writes to is itself saved on a
 * debounce, and threading every keystroke through both would have the board
 * re-render per character.
 */

/**
 * The annotation palette, in the three families an annotator reaches for:
 * what the move was, where the position stands, and what is going on in it.
 */
const FAMILIES: { family: GlyphFamily; label: string }[] = [
  { family: "move", label: "Move" },
  { family: "position", label: "Position" },
  { family: "observation", label: "Observation" },
];

/** Matches the tree's own save cadence: one write per pause, not per key. */
const COMMIT_AFTER_MS = 400;

interface Props {
  /** The move being annotated, for the heading. Empty at the start position. */
  san: string;
  ply: number;
  comment: string;
  shapes: Shape[];
  nag?: number;
  nags?: number[];
  readOnly?: boolean;
  onComment: (text: string) => void;
  /** Put a glyph on, or take it off. The tree applies the family rules. */
  onGlyph: (nag: number) => void;
  onShapes: (shapes: Shape[]) => void;
}

export default function NotesPane({
  san,
  ply,
  comment,
  shapes,
  nag,
  nags,
  readOnly,
  onComment,
  onGlyph,
  onShapes,
}: Props) {
  const [draft, setDraft] = useState(comment);
  // Which move the draft belongs to. Without it, moving the cursor while a
  // pending edit is in flight would carry your words onto the next move.
  const owner = useRef(ply);

  useEffect(() => {
    owner.current = ply;
    setDraft(comment);
  }, [ply, comment]);

  useEffect(() => {
    if (draft === comment) return;
    const mine = owner.current;
    const timer = setTimeout(() => {
      if (owner.current === mine) onComment(draft);
    }, COMMIT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft, comment, onComment]);

  const label = san ? `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? "." : "..."} ${san}` : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="eyebrow">{label ? "About" : "Before the first move"}</span>
        {label && <span className="font-mono text-xs font-semibold">{label}</span>}
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        readOnly={readOnly}
        rows={5}
        placeholder={
          readOnly
            ? "Nothing was written about this position."
            : "What is going on here, and why does the next move follow from it?"
        }
        className="w-full resize-y rounded-xl border border-ivory/10 bg-ivory/[0.04] px-2.5 py-2
                   text-xs leading-relaxed text-ink placeholder:text-muted
                   focus:border-accent/40 focus:outline-none read-only:opacity-70"
      />

      {/* A glyph is about a move, so the start position has none to give. */}
      {san &&
        FAMILIES.map(({ family, label }) => (
          <div key={family}>
            <p className="eyebrow mb-1.5">{label}</p>
            <div className="flex flex-wrap gap-1">
              {GLYPHS.filter((g) => g.family === family).map((g) => {
                const on = family === "move" ? nag === g.nag : !!nags?.includes(g.nag);
                return (
                  <button
                    key={g.nag}
                    title={g.name}
                    aria-label={g.name}
                    disabled={readOnly}
                    // Clicking the glyph it already has takes it off — there is
                    // no other way back to an unmarked move.
                    onClick={() => onGlyph(g.nag)}
                    aria-pressed={on}
                    className={`min-w-8 rounded-md border px-1.5 py-1 font-mono text-xs transition-colors
                                disabled:opacity-40 ${
                                  on
                                    ? "border-brass/60 bg-brass/15 text-ink"
                                    : "border-ivory/10 text-muted hover:bg-ivory/10 hover:text-ink"
                                }`}
                  >
                    {g.symbol}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <p className="eyebrow">Drawn here</p>
          {shapes.length > 0 && !readOnly && (
            <button
              onClick={() => onShapes([])}
              className="ml-auto rounded-md border border-ivory/10 px-1.5 py-0.5 text-[10px]
                         text-muted hover:bg-bad/20 hover:text-bad"
            >
              Clear
            </button>
          )}
        </div>

        {shapes.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-muted">
            {readOnly ? (
              "Nothing drawn on this position."
            ) : (
              <>
                Right-click a square to ring it, or right-drag between two for an
                arrow. Hold <kbd className="kbd">Shift</kbd>,{" "}
                <kbd className="kbd">Alt</kbd> or <kbd className="kbd">Ctrl</kbd> to
                change colour.
              </>
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shapes.map((s, i) => (
              <span
                key={`${s.from}${s.to ?? ""}${i}`}
                className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]"
                style={{ borderColor: BRUSH_COLOR[s.brush], color: BRUSH_COLOR[s.brush] }}
              >
                {s.to ? `${s.from}→${s.to}` : s.from}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
