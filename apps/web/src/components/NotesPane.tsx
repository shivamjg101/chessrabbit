"use client";

import { useEffect, useRef, useState } from "react";
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

/** The marks worth a button. The rest of the NAG table is not a UI. */
const MARKS: { nag: number; glyph: string; title: string }[] = [
  { nag: 1, glyph: "!", title: "Good move" },
  { nag: 2, glyph: "?", title: "Mistake" },
  { nag: 3, glyph: "!!", title: "Brilliant" },
  { nag: 4, glyph: "??", title: "Blunder" },
  { nag: 5, glyph: "!?", title: "Interesting" },
  { nag: 6, glyph: "?!", title: "Dubious" },
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
  readOnly?: boolean;
  onComment: (text: string) => void;
  onNag: (nag: number | undefined) => void;
  onShapes: (shapes: Shape[]) => void;
}

export default function NotesPane({
  san,
  ply,
  comment,
  shapes,
  nag,
  readOnly,
  onComment,
  onNag,
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
        className="w-full resize-y rounded-lg border border-line/35 bg-ink/[0.04] px-2.5 py-2
                   text-xs leading-relaxed text-ink placeholder:text-muted
                   focus:border-accent/40 focus:outline-none read-only:opacity-70"
      />

      {/* A mark is only about a move, so the start position has none to give. */}
      {san && (
        <div>
          <p className="eyebrow mb-1.5">Mark</p>
          <div className="flex flex-wrap gap-1.5">
            {MARKS.map((m) => (
              <button
                key={m.nag}
                title={m.title}
                disabled={readOnly}
                // Clicking the mark it already has takes it off — there is no
                // other way to get back to an unmarked move.
                onClick={() => onNag(nag === m.nag ? undefined : m.nag)}
                aria-pressed={nag === m.nag}
                className={`min-w-9 rounded border px-2 py-1 font-mono text-xs transition-colors
                            disabled:opacity-40 ${
                              nag === m.nag
                                ? "border-accent bg-accent/20 text-ink"
                                : "border-line/35 text-muted hover:bg-ink/10 hover:text-ink"
                            }`}
              >
                {m.glyph}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <p className="eyebrow">Drawn here</p>
          {shapes.length > 0 && !readOnly && (
            <button
              onClick={() => onShapes([])}
              className="ml-auto rounded border border-line/35 px-1.5 py-0.5 text-[10px]
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
                className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
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
