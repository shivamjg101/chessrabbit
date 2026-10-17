"use client";

/**
 * Studies: the list.
 *
 * A study is a notebook of positions that lives on the server rather than in
 * one browser — the thing the move tree was always for, minus the part where
 * only you could ever see it.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MoreMenu from "@/components/MoreMenu";
import { api, ApiError, Me, Study, StudyVisibility } from "@/lib/api";

const VISIBILITY_LABEL: Record<StudyVisibility, string> = {
  private: "Private",
  unlisted: "Anyone with the link",
  public: "Public",
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function StudiesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStudies(await api.listStudies());
    } catch {
      setStudies([]);
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        load();
      })
      .catch(() => router.push("/login"));
  }, [router, load]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      const study = await api.createStudy({ name: trimmed });
      router.push(`/study/view/?id=${study.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create that study");
      setCreating(false);
    }
  }

  async function remove(study: Study) {
    if (!confirm(`Delete "${study.name}" and all of its chapters? This cannot be undone.`)) {
      return;
    }
    // Gone from the list first: the request is a formality, and waiting on it
    // leaves the row you just deleted sitting there looking undeleted.
    setStudies((s) => (s ?? []).filter((x) => x.id !== study.id));
    try {
      await api.deleteStudy(String(study.id));
    } catch {
      load();
    }
  }

  const mine = (studies ?? []).filter((s) => s.owner_id === me?.id);
  const shared = (studies ?? []).filter((s) => s.owner_id !== me?.id);

  return (
    <div className="mx-auto min-h-screen max-w-4xl p-4">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/app" className="btn">
          ← Board
        </Link>
        <h1 className="font-display text-xl">📓 Studies</h1>
        <nav className="seg ml-auto hidden md:flex">
          <MoreMenu />
        </nav>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-line/35 bg-panelAlt/60 p-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-muted" htmlFor="study-name">
            New study
          </label>
          <input
            id="study-name"
            className="input"
            placeholder="Najdorf — the 6.Bg5 main lines"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        <button className="btn-primary" disabled={!name.trim() || creating} onClick={create}>
          {creating ? "Creating…" : "Create"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {studies === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : studies.length === 0 ? (
        <div className="rounded-xl border border-line/35 bg-panelAlt/60 p-8 text-center">
          <p className="font-display text-xl">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
            A study is a board that keeps what you found on it. Play the
            variations, write what they mean, draw the plan on the squares — then
            hand somebody the link and they see all of it.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <StudyGroup title="Yours" studies={mine} onDelete={remove} />
          <StudyGroup title="Shared with you" studies={shared} />
        </div>
      )}
    </div>
  );
}

function StudyGroup({
  title,
  studies,
  onDelete,
}: {
  title: string;
  studies: Study[];
  onDelete?: (study: Study) => void;
}) {
  if (studies.length === 0) return null;

  return (
    <section>
      <h2 className="eyebrow mb-2">{title}</h2>
      <ul className="space-y-2">
        {studies.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-line/35 bg-panelAlt/60 p-3"
          >
            <Link href={`/study/view/?id=${s.id}`} className="min-w-0 flex-1">
              <p className="truncate font-medium">{s.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"} ·{" "}
                {VISIBILITY_LABEL[s.visibility]} · {relative(s.updated_at)}
                {!onDelete && ` · by ${s.owner_name}`}
              </p>
            </Link>
            {onDelete && (
              <button
                onClick={() => onDelete(s)}
                title={`Delete ${s.name}`}
                className="shrink-0 rounded border border-line/35 px-2 py-1 text-xs text-muted
                           hover:bg-bad/20 hover:text-bad"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
