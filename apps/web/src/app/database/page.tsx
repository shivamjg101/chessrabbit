"use client";

/**
 * Your games as a database: the screen ChessBase opens on.
 *
 * The board's rail is a list of recent games; this is the whole collection
 * as a table you can filter by any header, sort by any column, file into
 * collections, correct the headers of, export as one PGN, or turn into a
 * study - a chapter per game, or every game merged into one opening tree.
 *
 * The reference database of master games has its own screen (/search); this
 * one is only ever about games you imported, synced or played.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Modal from "@/components/Modal";
import MoreMenu from "@/components/MoreMenu";
import { CrosstableDialog, DossierDialog, DuplicatesDialog } from "@/components/DatabaseReports";
import { gameTags } from "@/components/NewChapterDialog";
import {
  api,
  ApiError,
  Collection,
  Game,
  GameHeaders,
  GameListQuery,
  GameSort,
} from "@/lib/api";
import { mergedChapter } from "@/lib/chapterImport";

const PAGE_SIZE = 50;

const RESULTS = [
  { value: "", label: "Any result" },
  { value: "1-0", label: "1-0" },
  { value: "0-1", label: "0-1" },
  { value: "1/2-1/2", label: "½-½" },
  { value: "*", label: "Unfinished" },
];

type Filters = Pick<
  GameListQuery,
  "q" | "white" | "black" | "eco" | "opening" | "event" | "result" | "min_elo" | "date_from" | "date_to"
>;

const NO_FILTERS: Filters = {
  q: "", white: "", black: "", eco: "", opening: "", event: "", result: "",
  min_elo: undefined, date_from: "", date_to: "",
};

const COLUMNS: { sort: GameSort; label: string; className?: string }[] = [
  { sort: "white", label: "White" },
  { sort: "white_elo", label: "Elo", className: "hidden lg:table-cell" },
  { sort: "black", label: "Black" },
  { sort: "black_elo", label: "Elo", className: "hidden lg:table-cell" },
  { sort: "result", label: "Result" },
  { sort: "eco", label: "Opening", className: "hidden sm:table-cell" },
  { sort: "event", label: "Event", className: "hidden md:table-cell" },
  { sort: "date", label: "Date", className: "hidden sm:table-cell" },
  { sort: "moves", label: "Moves", className: "text-right" },
];

export default function DatabasePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [games, setGames] = useState<Game[] | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<GameSort>("added");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Game | null>(null);
  const [newCollection, setNewCollection] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  // The reports: which dialog is open, and what it opens on.
  const [report, setReport] = useState<
    null | { kind: "duplicates" } | { kind: "crosstable"; event?: string } | { kind: "dossier"; name?: string }
  >(null);

  useEffect(() => {
    api
      .me()
      .then(() => setReady(true))
      .catch(() => router.push("/login"));
  }, [router]);

  const loadCollections = useCallback(() => {
    api.listCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const rows = await api.queryGames({
        ...applied,
        collection: collection ?? undefined,
        sort,
        order,
        page,
        limit: PAGE_SIZE,
      });
      setGames(rows);
    } catch (err) {
      setGames([]);
      setNotice({ text: err instanceof ApiError ? err.message : "Could not load your games", bad: true });
    }
  }, [applied, collection, sort, order, page]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  useEffect(() => {
    if (ready) loadCollections();
  }, [ready, loadCollections]);

  // A selection belongs to the rows it was made on.
  useEffect(() => setSelected(new Set()), [applied, collection, sort, order, page]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  function sortBy(column: GameSort) {
    if (sort === column) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(column);
      // Names read A→Z; numbers and dates read biggest/newest first.
      setOrder(column === "white" || column === "black" || column === "event" || column === "eco" ? "asc" : "desc");
    }
    setPage(1);
  }

  function search() {
    setApplied(filters);
    setPage(1);
  }

  const ids = useMemo(() => [...selected], [selected]);
  const allOnPage = !!games?.length && games.every((g) => selected.has(g.id));

  async function exportSelected(all = false) {
    const list = all ? (games ?? []).map((g) => g.id) : ids;
    if (!list.length) return;
    try {
      await api.downloadGames(list, all ? "games" : `games-${list.length}`);
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : "Export failed", bad: true });
    }
  }

  async function deleteSelected() {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} game${ids.length === 1 ? "" : "s"} from your database? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteGames(ids);
      setNotice({ text: `Deleted ${ids.length} game${ids.length === 1 ? "" : "s"}` });
      setSelected(new Set());
      await load();
      loadCollections();
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : "Delete failed", bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function fileInto(collectionId: number) {
    if (!ids.length) return;
    try {
      const c = await api.addToCollection(collectionId, ids);
      setNotice({ text: `${ids.length} game${ids.length === 1 ? "" : "s"} filed in ${c.name}` });
      loadCollections();
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : "Could not add to that collection", bad: true });
    }
  }

  async function removeFromCollection() {
    if (collection == null || !ids.length) return;
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => api.removeFromCollection(collection, id)));
      await load();
      loadCollections();
    } catch {
      setNotice({ text: "Some games could not be removed from the collection", bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function createCollection() {
    const name = newCollection.trim();
    if (!name) return;
    try {
      const c = await api.createCollection(name);
      setNewCollection("");
      setCollections((cs) => [...cs, c]);
      if (ids.length) await fileInto(c.id);
    } catch (err) {
      setNotice({ text: err instanceof ApiError ? err.message : "Could not create the collection", bad: true });
    }
  }

  async function deleteCollection(c: Collection) {
    if (!confirm(`Delete the collection "${c.name}"? The games stay in your database.`)) return;
    try {
      await api.deleteCollection(c.id);
      if (collection === c.id) setCollection(null);
      loadCollections();
    } catch {
      setNotice({ text: "Could not delete that collection", bad: true });
    }
  }

  /**
   * The selection as a new study: a chapter per game, or - merged - one
   * chapter holding every game as a branch of a single tree.
   */
  async function makeStudy(merge: boolean) {
    const chosen = (games ?? []).filter((g) => selected.has(g.id));
    if (!chosen.length) return;
    if (!merge && chosen.length > 64) {
      setNotice({ text: "A study holds 64 chapters. Select fewer games, or merge them.", bad: true });
      return;
    }
    const name = prompt(
      merge ? "Name the study (the games become one opening tree):" : "Name the study (one chapter per game):",
      merge ? "Merged games" : `${chosen.length} games`
    );
    if (!name?.trim()) return;

    setBusy(true);
    try {
      const study = await api.createStudy({ name: name.trim() });
      const ref = String(study.id);
      if (merge) {
        const texts = await Promise.all(chosen.map((g) => api.getGame(g.id).then((d) => d.movetext)));
        const { draft, skipped } = mergedChapter(texts, name.trim());
        if (!draft) throw new Error("Those games have no moves to merge.");
        await api.importChapters(ref, [draft]);
        if (skipped) setNotice({ text: `${skipped} game(s) started from another position and were left out` });
      } else {
        await api.importChapters(
          ref,
          chosen.map((g) => ({
            name: `${g.white || "?"} – ${g.black || "?"}`.slice(0, 120),
            from_game_id: g.id,
            tags: gameTags(g),
          }))
        );
      }
      // The empty chapter every study is born with: the import replaced it.
      if (study.chapters[0]) await api.deleteChapter(ref, study.chapters[0].id).catch(() => {});
      router.push(`/study/view/?id=${study.id}`);
    } catch (err) {
      setNotice({
        text: err instanceof ApiError || err instanceof Error ? err.message : "Could not create the study",
        bad: true,
      });
      setBusy(false);
    }
  }

  const field = (key: keyof Filters, label: string, placeholder = "", className = "") => (
    <label className={`min-w-[120px] flex-1 ${className}`}>
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        className="input py-1.5 text-sm"
        placeholder={placeholder}
        value={(filters[key] as string) ?? ""}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && search()}
      />
    </label>
  );

  const activeCollection = collections.find((c) => c.id === collection);

  return (
    <div className="mx-auto min-h-screen max-w-7xl p-4">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/app" className="btn">
          ← Board
        </Link>
        <h1 className="font-display text-xl">Database</h1>
        <span className="text-xs text-muted">Your games — filter, sort, file, export, study.</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() => setReport({ kind: "crosstable", event: applied.event?.trim() || undefined })}
            title="Standings and results of an event in your database"
          >
            Crosstable
          </button>
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() =>
              setReport({
                kind: "dossier",
                name: (applied.q || applied.white || applied.black)?.trim() || undefined,
              })
            }
            title="Score, openings and opponents of one player"
          >
            Player dossier
          </button>
          <button
            className="btn px-2 py-1 text-xs"
            onClick={() => setReport({ kind: "duplicates" })}
            title="Games that are in your database more than once"
          >
            Duplicates
          </button>
        </div>
        <nav className="seg ml-auto hidden md:flex">
          <MoreMenu />
        </nav>
      </header>

      {notice && (
        <div
          className={`mb-3 rounded-xl border px-3 py-2 text-sm ${
            notice.bad ? "border-bad/30 bg-bad/10" : "border-accent/30 bg-accent/10"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* ---------- Collections ---------- */}
        <aside className="shrink-0 lg:w-56">
          <p className="eyebrow mb-2">Collections</p>
          <ul className="space-y-0.5 text-sm">
            <li>
              <button
                onClick={() => { setCollection(null); setPage(1); }}
                className={`w-full rounded-xl px-2.5 py-1.5 text-left ${collection == null ? "bg-ivory/[0.12] text-ink shadow-edge ring-1 ring-brass/40" : "text-muted hover:bg-ivory/[0.06] hover:text-ink"}`}
              >
                All games
              </button>
            </li>
            {collections.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  onClick={() => { setCollection(c.id); setPage(1); }}
                  className={`min-w-0 flex-1 truncate rounded-xl px-2.5 py-1.5 text-left ${collection === c.id ? "bg-ivory/[0.12] text-ink shadow-edge ring-1 ring-brass/40" : "text-muted hover:bg-ivory/[0.06] hover:text-ink"}`}
                >
                  {c.name} <span className="font-mono text-[10px] opacity-60">{c.game_count}</span>
                </button>
                <button
                  onClick={() => deleteCollection(c)}
                  aria-label={`Delete collection ${c.name}`}
                  className="rounded-md px-1.5 text-[11px] text-muted opacity-0 hover:text-bad group-hover:opacity-100 focus:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1">
            <input
              className="input py-1 text-xs"
              placeholder="New collection"
              value={newCollection}
              maxLength={100}
              onChange={(e) => setNewCollection(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCollection()}
            />
            <button className="btn px-2 text-xs" disabled={!newCollection.trim()} onClick={createCollection}>
              +
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Select games, then file them with “Add to” — or create a collection with games selected to file them straight in.
          </p>
        </aside>

        <section className="min-w-0 flex-1 space-y-3">
          {/* ---------- Filters ---------- */}
          <div className="card p-3">
            <div className="flex flex-wrap items-end gap-2">
              {field("q", "Player (either side)", "Carlsen")}
              {field("opening", "Opening", "Sicilian")}
              {field("eco", "ECO", "B90", "max-w-[90px]")}
              <label className="w-32">
                <span className="mb-1 block text-[11px] text-muted">Result</span>
                <select
                  className="input py-1.5 text-sm"
                  value={filters.result ?? ""}
                  onChange={(e) => setFilters({ ...filters, result: e.target.value })}
                >
                  {RESULTS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn text-xs" onClick={() => setMoreFilters((m) => !m)} aria-expanded={moreFilters}>
                {moreFilters ? "Fewer" : "More"} filters
              </button>
              <button className="btn-primary" onClick={search}>
                Search
              </button>
              <button
                className="btn"
                onClick={() => {
                  setFilters(NO_FILTERS);
                  setApplied(NO_FILTERS);
                  setPage(1);
                }}
              >
                Reset
              </button>
            </div>
            {moreFilters && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {field("white", "White", "")}
                {field("black", "Black", "")}
                {field("event", "Event", "")}
                <label className="w-28">
                  <span className="mb-1 block text-[11px] text-muted">Min Elo</span>
                  <input
                    type="number"
                    min={0}
                    max={4000}
                    className="input py-1.5 text-sm"
                    value={filters.min_elo ?? ""}
                    onChange={(e) =>
                      setFilters({ ...filters, min_elo: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </label>
                <label className="w-36">
                  <span className="mb-1 block text-[11px] text-muted">From</span>
                  <input
                    type="date"
                    className="input py-1.5 text-sm"
                    value={filters.date_from ?? ""}
                    onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
                  />
                </label>
                <label className="w-36">
                  <span className="mb-1 block text-[11px] text-muted">To</span>
                  <input
                    type="date"
                    className="input py-1.5 text-sm"
                    value={filters.date_to ?? ""}
                    onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
                  />
                </label>
              </div>
            )}
          </div>

          {/* ---------- Bulk actions ---------- */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-muted">
              {activeCollection ? `${activeCollection.name} · ` : ""}
              {selected.size ? `${selected.size} selected` : "Select games for bulk actions"}
            </span>
            <button className="btn px-2 py-1 text-xs" disabled={!selected.size} onClick={() => exportSelected()}>
              Export PGN
            </button>
            <select
              className="input w-auto py-1 text-xs"
              disabled={!selected.size || collections.length === 0}
              value=""
              onChange={(e) => e.target.value && fileInto(Number(e.target.value))}
            >
              <option value="">Add to…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {collection != null && (
              <button className="btn px-2 py-1 text-xs" disabled={!selected.size || busy} onClick={removeFromCollection}>
                Remove from collection
              </button>
            )}
            <button className="btn px-2 py-1 text-xs" disabled={!selected.size || busy} onClick={() => makeStudy(false)}>
              New study (chapter per game)
            </button>
            <button className="btn px-2 py-1 text-xs" disabled={selected.size < 2 || busy} onClick={() => makeStudy(true)}>
              Merge into one study tree
            </button>
            <button
              className="btn px-2 py-1 text-xs hover:bg-bad/20 hover:text-bad"
              disabled={!selected.size || busy}
              onClick={deleteSelected}
            >
              Delete
            </button>
            <button
              className="btn ml-auto px-2 py-1 text-xs"
              disabled={!games?.length}
              onClick={() => exportSelected(true)}
              title="Every game on this page"
            >
              Export page
            </button>
          </div>

          {/* ---------- Table ---------- */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                <tr className="border-b border-ivory/[0.06]">
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select every game on this page"
                      checked={allOnPage}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set((games ?? []).map((g) => g.id)) : new Set())
                      }
                    />
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.label + c.sort} className={`px-2 py-2 font-semibold ${c.className ?? ""}`}>
                      <button
                        onClick={() => sortBy(c.sort)}
                        className={`inline-flex items-center gap-1 hover:text-ink ${sort === c.sort ? "text-ink" : ""}`}
                      >
                        {c.label}
                        {sort === c.sort && <span aria-hidden>{order === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {games === null ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-sm text-muted">
                      Loading…
                    </td>
                  </tr>
                ) : games.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted">
                      {page > 1
                        ? "That was the last page."
                        : "No games match. Import a PGN or connect Lichess / Chess.com from the board's account menu."}
                    </td>
                  </tr>
                ) : (
                  games.map((g) => (
                    <tr
                      key={g.id}
                      className={`cursor-pointer border-b border-ivory/[0.04] transition-colors last:border-0 hover:bg-ivory/[0.05] ${
                        selected.has(g.id) ? "bg-accent/[0.08]" : ""
                      }`}
                      onClick={() => router.push(`/app/?game=${g.id}`)}
                      title="Open in the analysis board"
                    >
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${g.white} – ${g.black}`}
                          checked={selected.has(g.id)}
                          onChange={(e) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(g.id);
                              else next.delete(g.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-[160px] truncate px-2 py-1.5">{g.white || "?"}</td>
                      <td className="hidden px-2 py-1.5 font-mono text-[11px] text-muted lg:table-cell">{g.white_elo ?? ""}</td>
                      <td className="max-w-[160px] truncate px-2 py-1.5">{g.black || "?"}</td>
                      <td className="hidden px-2 py-1.5 font-mono text-[11px] text-muted lg:table-cell">{g.black_elo ?? ""}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{g.result}</td>
                      <td className="hidden max-w-[220px] truncate px-2 py-1.5 text-xs text-muted sm:table-cell">
                        {g.eco && <span className="mr-1 rounded-md bg-ivory/[0.07] px-1 font-mono">{g.eco}</span>}
                        {g.opening ?? ""}
                      </td>
                      <td className="hidden max-w-[160px] truncate px-2 py-1.5 text-xs text-muted md:table-cell">{g.event || ""}</td>
                      <td className="hidden whitespace-nowrap px-2 py-1.5 text-xs text-muted sm:table-cell">{g.played_on ?? ""}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-muted">{Math.ceil(g.ply_count / 2)}</td>
                      <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(g)}
                          aria-label="Edit headers"
                          title="Edit headers"
                          className="rounded-md px-1.5 text-xs text-muted hover:bg-ivory/10 hover:text-ink"
                        >
                          ✎
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted">
            <span>Page {page}</span>
            <div className="flex gap-2">
              <button className="btn px-2 py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <button
                className="btn px-2 py-1 text-xs"
                disabled={!games || games.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        </section>
      </div>

      {report?.kind === "duplicates" && (
        <DuplicatesDialog
          onClose={() => setReport(null)}
          onDeleted={(n) => {
            setReport(null);
            setNotice({ text: `Deleted ${n} duplicate game${n === 1 ? "" : "s"}` });
            load();
            loadCollections();
          }}
        />
      )}
      {report?.kind === "crosstable" && (
        <CrosstableDialog
          initialEvent={report.event}
          onClose={() => setReport(null)}
          onPlayer={(name) => setReport({ kind: "dossier", name })}
        />
      )}
      {report?.kind === "dossier" && (
        <DossierDialog
          // A new name is a new dossier, not a re-render of the last one.
          key={report.name ?? ""}
          initialName={report.name}
          onClose={() => setReport(null)}
          onOpenGame={(id) => router.push(`/app/?game=${id}`)}
        />
      )}

      {editing && (
        <EditHeaders
          game={editing}
          onClose={() => setEditing(null)}
          onSaved={(g) => {
            setGames((rows) => (rows ?? []).map((r) => (r.id === g.id ? g : r)));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/** Correct a game's headers - the typo in a name, the missing Elo, the event. */
function EditHeaders({ game, onClose, onSaved }: { game: Game; onClose: () => void; onSaved: (g: Game) => void }) {
  const [h, setH] = useState({
    white: game.white,
    black: game.black,
    white_elo: game.white_elo?.toString() ?? "",
    black_elo: game.black_elo?.toString() ?? "",
    event: game.event,
    played_on: game.played_on ?? "",
    result: game.result,
    eco: game.eco ?? "",
    opening: game.opening ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const elo = (v: string) => (v.trim() ? Number(v) : null);
    const body: GameHeaders = {
      white: h.white.trim(),
      black: h.black.trim(),
      white_elo: elo(h.white_elo),
      black_elo: elo(h.black_elo),
      event: h.event.trim(),
      played_on: h.played_on || null,
      result: h.result,
      eco: h.eco.trim().toUpperCase(),
      opening: h.opening.trim(),
    };
    // A blank number box means "no change", not zero; null is not sent at all.
    for (const k of Object.keys(body) as (keyof GameHeaders)[]) if (body[k] === null) delete body[k];
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.updateGame(game.id, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save those headers");
      setBusy(false);
    }
  }

  const input = (key: keyof typeof h, label: string, props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        className="input py-1.5 text-sm"
        value={h[key]}
        onChange={(e) => setH({ ...h, [key]: e.target.value })}
        {...props}
      />
    </label>
  );

  return (
    <Modal title="Edit game headers" onClose={onClose}>
      <div className="grid grid-cols-[1fr_90px] gap-2">
        {input("white", "White")}
        {input("white_elo", "Elo", { type: "number", min: 0, max: 4000 })}
        {input("black", "Black")}
        {input("black_elo", "Elo", { type: "number", min: 0, max: 4000 })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {input("event", "Event")}
        {input("played_on", "Date", { type: "date" })}
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted">Result</span>
          <select className="input py-1.5 text-sm" value={h.result} onChange={(e) => setH({ ...h, result: e.target.value })}>
            {RESULTS.filter((r) => r.value).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {input("eco", "ECO", { maxLength: 3, placeholder: "B90" })}
      </div>
      {input("opening", "Opening")}
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
