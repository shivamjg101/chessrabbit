"use client";

/**
 * Studies: yours, and everybody's.
 *
 * A study is a notebook of positions that lives on the server rather than in
 * one browser — the thing the move tree was always for, minus the part where
 * only you could ever see it. "Public" lists the ones their owners chose to
 * publish, searchable by name and topic, the way Lichess's study list works.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ChapterOptions, { ChapterOptionValues } from "@/components/ChapterOptions";
import Modal from "@/components/Modal";
import MoreMenu from "@/components/MoreMenu";
import { parseTopics } from "@/components/StudySettings";
import { api, ApiError, Me, PublicStudySort, Study, StudyVisibility } from "@/lib/api";
import { chaptersFromPgn } from "@/lib/chapterImport";

const VISIBILITY_LABEL: Record<StudyVisibility, string> = {
  private: "Private",
  unlisted: "Anyone with the link",
  public: "Public",
};

const SORTS: { id: PublicStudySort; label: string }[] = [
  { id: "popular", label: "Most liked" },
  { id: "updated", label: "Recently updated" },
  { id: "newest", label: "Newest" },
];

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

type Tab = "mine" | "public";

export default function StudiesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>("mine");
  const [studies, setStudies] = useState<Study[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
      <header className="glass relative z-30 mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/app" className="btn">
          ← Board
        </Link>
        <h1 className="font-display text-xl">📓 Studies</h1>
        <div className="seg ml-2">
          {(["mine", "public"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`seg-item ${tab === t ? "seg-item-on" : ""}`}
            >
              {t === "mine" ? "My studies" : "Public studies"}
            </button>
          ))}
        </div>
        <nav className="seg ml-auto hidden md:flex">
          <MoreMenu />
        </nav>
      </header>

      {tab === "public" ? (
        <PublicStudies />
      ) : (
        <>
          <div className="card mb-6 flex flex-wrap items-end gap-2 p-4">
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
            <button className="btn" onClick={() => setImporting(true)} title="Every game in a PGN file becomes a chapter">
              Import PGN…
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {studies === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : studies.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="font-display text-xl">Nothing here yet</p>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
                A study is a board that keeps what you found on it. Play the
                variations, write what they mean, draw the plan on the squares — then
                hand somebody the link and they see all of it. Or turn it into an
                interactive lesson, where they have to find the moves themselves.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <StudyGroup title="Yours" studies={mine} onDelete={remove} />
              <StudyGroup title="Shared with you" studies={shared} />
            </div>
          )}
        </>
      )}

      {importing && (
        <ImportStudy
          onClose={() => setImporting(false)}
          onDone={(id) => router.push(`/study/view/?id=${id}`)}
        />
      )}
    </div>
  );
}

function StudyRow({ s, onDelete, showOwner }: { s: Study; onDelete?: (study: Study) => void; showOwner: boolean }) {
  return (
    <li className="card flex items-center gap-3 p-3">
      <Link href={`/study/view/?id=${s.id}`} className="min-w-0 flex-1">
        <p className="truncate font-medium">{s.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"} ·{" "}
          {VISIBILITY_LABEL[s.visibility as StudyVisibility] ?? s.visibility} · {relative(s.updated_at)}
          {showOwner && ` · by ${s.owner_name}`}
          {s.likes > 0 && ` · ♥ ${s.likes}`}
        </p>
        {s.topics.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {s.topics.map((t) => (
              <span key={t} className="rounded-md bg-ivory/[0.07] px-1.5 py-px text-[10px] text-muted">
                {t}
              </span>
            ))}
          </div>
        )}
      </Link>
      {onDelete && (
        <button
          onClick={() => onDelete(s)}
          title={`Delete ${s.name}`}
          className="shrink-0 rounded-md border border-ivory/10 px-2 py-1 text-xs text-muted
                     hover:bg-bad/20 hover:text-bad"
        >
          Delete
        </button>
      )}
    </li>
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
          <StudyRow key={s.id} s={s} onDelete={onDelete} showOwner={!onDelete} />
        ))}
      </ul>
    </section>
  );
}

/** Published studies, searchable by name, description and topic. */
function PublicStudies() {
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<PublicStudySort>("popular");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Study[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (at: number) => {
      setError(null);
      try {
        const res = await api.publicStudies({ q, topic: topic ?? undefined, sort, page: at });
        setResults((prev) => (at === 1 ? res.studies : [...(prev ?? []), ...res.studies]));
        setHasMore(res.has_more);
        setPage(at);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load public studies");
      }
    },
    [q, topic, sort]
  );

  // Searching as you type, settled so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => run(1), 250);
    return () => clearTimeout(t);
  }, [run]);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <input
          className="input min-w-[200px] flex-1"
          placeholder="Search studies — an opening, a player, a theme"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="seg">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`seg-item text-xs ${sort === s.id ? "seg-item-on" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {topic && (
        <p className="text-xs text-muted">
          Topic: <span className="chip bg-brass/15 text-ink">{topic}</span>{" "}
          <button className="underline" onClick={() => setTopic(null)}>
            clear
          </button>
        </p>
      )}

      {error && <div className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm">{error}</div>}

      {results === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : results.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-lg">No public studies {q || topic ? "match" : "yet"}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            A study appears here when its owner sets it to Public in the Share panel.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {results.map((s) => (
            <li key={s.id} className="card p-3">
              <Link href={`/study/view/?id=${s.id}`} className="block">
                <p className="truncate font-medium">{s.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  by {s.owner_name} · {s.chapter_count} chapter{s.chapter_count === 1 ? "" : "s"} ·{" "}
                  {relative(s.updated_at)} · ♥ {s.likes}
                </p>
                {s.description && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink/75">{s.description}</p>
                )}
              </Link>
              {s.topics.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.topics.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTopic(t)}
                      className="rounded-md bg-ivory/[0.07] px-1.5 py-px text-[10px] text-muted hover:bg-brass/20 hover:text-ink"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button className="btn w-full" onClick={() => run(page + 1)}>
          More studies
        </button>
      )}
    </div>
  );
}

/**
 * A PGN file in, a study out: one chapter per game, which is how ChessBase
 * and Lichess write a study when they export one.
 */
function ImportStudy({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const [name, setName] = useState("");
  const [topics, setTopics] = useState("");
  const [pgn, setPgn] = useState("");
  const [options, setOptions] = useState<ChapterOptionValues>({
    orientation: "white",
    mode: "normal",
    hide_engine: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const drafts = pgn.trim() ? chaptersFromPgn(pgn, options) : [];

  function readFile(file: File) {
    if (file.size > 4_000_000) return setError("That file is larger than a study can hold.");
    if (!name.trim()) setName(file.name.replace(/\.pgn$/i, "").slice(0, 120));
    const reader = new FileReader();
    reader.onload = () => setPgn(String(reader.result ?? ""));
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
  }

  async function run() {
    if (drafts.length === 0) return setError("No games were found in that PGN.");
    if (drafts.length > 64) return setError(`That PGN has ${drafts.length} games; a study holds 64 chapters.`);
    setBusy(true);
    setError(null);
    try {
      const study = await api.createStudy({
        name: name.trim() || drafts[0].name,
        topics: parseTopics(topics),
      });
      const ref = String(study.id);
      await api.importChapters(ref, drafts);
      // Every study is created with an empty first chapter so it never opens
      // on nothing. An imported study has real ones, so the placeholder goes.
      const placeholder = study.chapters[0];
      if (placeholder) await api.deleteChapter(ref, placeholder.id).catch(() => {});
      onDone(study.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import that PGN");
      setBusy(false);
    }
  }

  return (
    <Modal title="Import PGN as a new study" onClose={onClose}>
      <label className="block">
        <span className="eyebrow mb-1 block">Study name</span>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block">
        <span className="eyebrow mb-1 block">Topics</span>
        <input
          className="input"
          value={topics}
          placeholder="Comma-separated, optional"
          onChange={(e) => setTopics(e.target.value)}
        />
      </label>
      <textarea
        className="input h-40 font-mono text-xs"
        placeholder={'[Event "..."]\n\n1. e4 e5 ...\n\n[Event "..."]\n\n1. d4 d5 ...'}
        value={pgn}
        onChange={(e) => setPgn(e.target.value)}
      />
      <div className="flex items-center gap-3 text-xs">
        <label className="btn cursor-pointer px-2 py-1 text-xs">
          Load a .pgn file
          <input
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </label>
        <span className="ml-auto text-muted">
          {drafts.length > 0 && `${drafts.length} chapter${drafts.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <ChapterOptions value={options} onChange={setOptions} disabled={busy} />
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy || drafts.length === 0} onClick={run}>
          {busy ? "Importing…" : "Create study"}
        </button>
      </div>
    </Modal>
  );
}
