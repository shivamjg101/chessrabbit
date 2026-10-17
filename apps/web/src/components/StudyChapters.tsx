"use client";

import { useEffect, useRef, useState } from "react";
import { StudyChapter } from "@/lib/api";

/**
 * The chapter rail: every board in this study, and the way between them.
 *
 * Reordering is two buttons rather than a drag. A drag needs a pointer, and
 * this list is read on a phone as often as on a desk; the arrows work in both
 * places and are the whole of what reordering a list of eight things needs.
 */

interface Props {
  chapters: StudyChapter[];
  activeId: number | null;
  canEdit: boolean;
  busy?: boolean;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, delta: -1 | 1) => void;
}

export default function StudyChapters({
  chapters,
  activeId,
  canEdit,
  busy,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onMove,
}: Props) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing !== null) input.current?.focus();
  }, [editing]);

  function commit() {
    if (editing === null) return;
    const name = draft.trim();
    const before = chapters.find((c) => c.id === editing)?.name;
    // An empty box means "I changed my mind", not "call this chapter nothing".
    if (name && name !== before) onRename(editing, name);
    setEditing(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="eyebrow">Chapters</span>
        {canEdit && (
          <button
            onClick={onAdd}
            disabled={busy}
            title="Add a chapter"
            className="ml-auto rounded border border-line/35 px-2 py-0.5 text-xs text-muted
                       transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40"
          >
            + Add
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {chapters.map((c, i) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <div
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm
                            transition-colors ${
                              active
                                ? "bg-accent/[0.18] text-ink"
                                : "text-muted hover:bg-ink/[0.06] hover:text-ink"
                            }`}
              >
                {editing === c.id ? (
                  <input
                    ref={input}
                    className="input h-7 flex-1 py-0 text-sm"
                    value={draft}
                    maxLength={120}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => onSelect(c.id)}
                    onDoubleClick={() => {
                      if (!canEdit) return;
                      setDraft(c.name);
                      setEditing(c.id);
                    }}
                    title={canEdit ? `${c.name} — double-click to rename` : c.name}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    <span className="mr-1.5 font-mono text-[10px] opacity-50">{i + 1}</span>
                    {c.name}
                  </button>
                )}

                {canEdit && editing !== c.id && (
                  // Held out of the way until the row is wanted, so eight
                  // chapters read as eight names rather than as a control panel.
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity
                                   focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => onMove(c.id, -1)}
                      disabled={i === 0 || busy}
                      title="Move up"
                      className="rounded px-1 text-[11px] hover:bg-ink/10 disabled:opacity-25"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => onMove(c.id, 1)}
                      disabled={i === chapters.length - 1 || busy}
                      title="Move down"
                      className="rounded px-1 text-[11px] hover:bg-ink/10 disabled:opacity-25"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      disabled={chapters.length < 2 || busy}
                      title={
                        chapters.length < 2
                          ? "A study keeps at least one chapter"
                          : `Delete ${c.name}`
                      }
                      className="rounded px-1 text-[11px] hover:bg-bad/20 hover:text-bad disabled:opacity-25"
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
