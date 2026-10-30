"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { api, ApiError, Study } from "@/lib/api";

/**
 * The study's own name, description and topics. Who can read and write it is
 * the Share panel's business; this is what it is called and what it is about.
 */

/** Split "Sicilian, endgames,  rook endings" into clean topics. */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const topic = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (topic && !seen.has(topic.toLowerCase())) {
      seen.add(topic.toLowerCase());
      out.push(topic);
    }
  }
  return out.slice(0, 12);
}

interface Props {
  study: Study;
  isOwner: boolean;
  onSaved: (study: Study) => void;
  onDeleted: () => void;
  onClose: () => void;
}

export default function StudySettings({ study, isOwner, onSaved, onDeleted, onClose }: Props) {
  const [name, setName] = useState(study.name);
  const [description, setDescription] = useState(study.description ?? "");
  const [topics, setTopics] = useState(study.topics.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await api.updateStudy(String(study.id), {
          name: name.trim() || study.name,
          description: description.trim(),
          topics: parseTopics(topics),
        })
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the study");
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${study.name}" and all of its chapters? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteStudy(String(study.id));
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the study");
      setBusy(false);
    }
  }

  return (
    <Modal title="Study settings" onClose={onClose}>
      <label className="block">
        <span className="eyebrow mb-1 block">Name</span>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="eyebrow mb-1 block">Description</span>
        <textarea
          className="input h-28 text-sm"
          value={description}
          maxLength={4000}
          placeholder="What the study covers, who it is for, how to read it."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="eyebrow mb-1 block">Topics</span>
        <input
          className="input"
          value={topics}
          placeholder="Sicilian Defense, Endgames, Rook endings"
          onChange={(e) => setTopics(e.target.value)}
        />
        <span className="mt-1 block text-[11px] text-muted">
          Comma-separated, up to 12. A public study is found by these.
        </span>
      </label>

      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}

      <div className="flex items-center gap-2">
        {isOwner && (
          <button className="btn text-xs text-bad hover:bg-bad/10" disabled={busy} onClick={remove}>
            Delete study
          </button>
        )}
        <span className="flex-1" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
