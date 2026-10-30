"use client";

import type { ChapterMode } from "@/lib/api";

/**
 * How a chapter is read - the three choices, as Lichess offers them when a
 * chapter is made, and the switches that go with them. Shared by "new
 * chapter" and the chapter's own settings so the two never describe the
 * modes differently.
 */

export const MODE_META: Record<ChapterMode, { label: string; icon: string; blurb: string }> = {
  normal: {
    label: "Analysis",
    icon: "♟",
    blurb: "A board to read and explore. Every move is visible.",
  },
  lesson: {
    label: "Interactive lesson",
    icon: "🎓",
    blurb:
      "Readers play your side and have to find the main-line moves. Side lines are the wrong answers; their comments explain why.",
  },
  conceal: {
    label: "Hidden moves",
    icon: "👁",
    blurb: "Each move stays hidden until the reader steps onto it — read a game as “guess the move”.",
  },
};

export interface ChapterOptionValues {
  orientation: "white" | "black";
  mode: ChapterMode;
  hide_engine: boolean;
}

export default function ChapterOptions({
  value,
  onChange,
  disabled,
}: {
  value: ChapterOptionValues;
  onChange: (next: ChapterOptionValues) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow">Read from</span>
        <div className="seg">
          {(["white", "black"] as const).map((o) => (
            <button
              key={o}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, orientation: o })}
              className={`seg-item ${value.orientation === o ? "seg-item-on" : ""}`}
            >
              {o === "white" ? "White" : "Black"}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.hide_engine}
            onChange={(e) => onChange({ ...value, hide_engine: e.target.checked })}
          />
          Hide the engine from readers
        </label>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-3">
        {(Object.keys(MODE_META) as ChapterMode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, mode: m })}
            aria-pressed={value.mode === m}
            className={`rounded-xl border p-2 text-left transition-colors ${
              value.mode === m
                ? "border-brass/60 bg-brass/10 shadow-edge"
                : "border-ivory/10 hover:bg-ivory/[0.05]"
            }`}
          >
            <span className="block font-medium text-ink">
              <span aria-hidden className="mr-1">
                {MODE_META[m].icon}
              </span>
              {MODE_META[m].label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{MODE_META[m].blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
