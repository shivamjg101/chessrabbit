"use client";

import { useState } from "react";
import ChapterOptions, { ChapterOptionValues } from "@/components/ChapterOptions";
import Modal from "@/components/Modal";
import { api, ApiError, StudyChapter } from "@/lib/api";

/**
 * One chapter's own settings: its name and prose, how it is read, and its PGN
 * tags - who played it, where, when, and who annotated it. The tags travel
 * out with the chapter in every export, and are what the player plates above
 * and below the board show.
 */

/** The tags people actually fill in, offered as one click each. */
const COMMON_TAGS = [
  "White", "Black", "WhiteElo", "BlackElo", "Event", "Site", "Date", "Round",
  "Result", "ECO", "Opening", "Annotator",
];

interface Props {
  studyRef: string;
  studyName: string;
  chapter: StudyChapter;
  canEdit: boolean;
  onSaved: (chapter: StudyChapter) => void;
  onClose: () => void;
}

export default function ChapterSettings({ studyRef, studyName, chapter, canEdit, onSaved, onClose }: Props) {
  const [name, setName] = useState(chapter.name);
  const [description, setDescription] = useState(chapter.description ?? "");
  const [options, setOptions] = useState<ChapterOptionValues>({
    orientation: chapter.orientation,
    mode: chapter.mode,
    hide_engine: chapter.hide_engine,
  });
  const [tags, setTags] = useState<[string, string][]>(Object.entries(chapter.tags ?? {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = new Set(tags.map(([k]) => k));

  async function save() {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of tags) {
      const key = k.trim();
      if (!key) continue;
      if (!/^\w{1,40}$/.test(key)) {
        setError(`"${key}" is not a tag name: letters, digits and underscores only.`);
        return;
      }
      if (v.trim()) cleaned[key] = v.trim();
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateChapter(studyRef, chapter.id, {
        name: name.trim() || chapter.name,
        description: description.trim(),
        tags: cleaned,
        ...options,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the chapter");
      setBusy(false);
    }
  }

  return (
    <Modal title={canEdit ? "Chapter settings" : chapter.name} onClose={onClose}>
      <label className="block">
        <span className="eyebrow mb-1 block">Name</span>
        <input
          className="input"
          value={name}
          maxLength={120}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="eyebrow mb-1 block">Description</span>
        <textarea
          className="input h-24 text-sm"
          value={description}
          readOnly={!canEdit}
          maxLength={20_000}
          placeholder="What this chapter is about, and what to look for in it."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <ChapterOptions value={options} onChange={setOptions} disabled={!canEdit || busy} />

      <div>
        <p className="eyebrow mb-1.5">PGN tags</p>
        <div className="space-y-1">
          {tags.map(([k, v], i) => (
            <div key={i} className="flex gap-1.5">
              <input
                className="input w-32 py-1 font-mono text-xs"
                value={k}
                readOnly={!canEdit}
                maxLength={40}
                onChange={(e) => setTags((t) => t.map((row, j) => (j === i ? [e.target.value, row[1]] : row)))}
              />
              <input
                className="input flex-1 py-1 text-xs"
                value={v}
                readOnly={!canEdit}
                maxLength={255}
                onChange={(e) => setTags((t) => t.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
              />
              {canEdit && (
                <button
                  onClick={() => setTags((t) => t.filter((_, j) => j !== i))}
                  aria-label={`Remove ${k}`}
                  className="rounded-md px-2 text-xs text-muted hover:bg-bad/20 hover:text-bad"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {tags.length === 0 && <p className="text-xs text-muted">No tags yet.</p>}
        </div>
        {canEdit && (
          <div className="mt-2 flex flex-wrap gap-1">
            {COMMON_TAGS.filter((t) => !used.has(t)).map((t) => (
              <button
                key={t}
                onClick={() => setTags((rows) => [...rows, [t, ""]])}
                className="rounded-md border border-ivory/10 px-1.5 py-0.5 text-[10px] text-muted hover:bg-ivory/10 hover:text-ink"
              >
                + {t}
              </button>
            ))}
            <button
              onClick={() => setTags((rows) => [...rows, ["", ""]])}
              className="rounded-md border border-ivory/10 px-1.5 py-0.5 text-[10px] text-muted hover:bg-ivory/10 hover:text-ink"
            >
              + Other
            </button>
          </div>
        )}
      </div>

      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn text-xs"
          onClick={() => api.downloadStudyPgn(studyRef, `${studyName}-${chapter.name}`, chapter.id).catch(() => setError("Could not download that chapter"))}
        >
          Download chapter PGN
        </button>
        <span className="flex-1" />
        <button className="btn" onClick={onClose}>
          {canEdit ? "Cancel" : "Close"}
        </button>
        {canEdit && (
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </Modal>
  );
}
