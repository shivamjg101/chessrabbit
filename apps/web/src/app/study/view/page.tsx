"use client";

/**
 * One study: the chapter rail, the board, and who it is shared with.
 *
 * Opened by id (`?id=12`) for a study you have access to, or by share slug
 * (`?s=…`) for one somebody sent you. Both go through the same request and the
 * same screen — a shared study is not a second, lesser view of a study, it is
 * the same one with the writing turned off.
 *
 * The route is a query parameter rather than a path segment because the web
 * tier ships as a static export: a `[id]` route would need every id known at
 * build time, and studies are made after the build.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AnalysisBoard from "@/components/AnalysisBoard";
import StudyChapters from "@/components/StudyChapters";
import StudyShare from "@/components/StudyShare";
import { api, ApiError, Study, StudyChapter, StudyDetail, StudyMember } from "@/lib/api";
import { parseStudyImport } from "@/lib/studyImport";

/** What the board's header says about the last save. */
type SaveState = { text: string; bad?: boolean } | null;

function StudyWorkspace() {
  const params = useSearchParams();
  // Either form resolves at the same endpoint; the slug is simply another name
  // for the study, and the server decides what it grants.
  const ref = params.get("id") ?? params.get("s") ?? "";

  const [study, setStudy] = useState<StudyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saving, setSaving] = useState<SaveState>(null);
  const [busy, setBusy] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  /**
   * The chapter text the board was opened with.
   *
   * Deliberately not read from `study.chapters` on every render. The board
   * re-reads its PGN whenever that prop changes, and every autosave echoes the
   * saved text back — so feeding it straight through would reset the cursor to
   * the first move each time the chapter saved itself.
   */
  const [openPgn, setOpenPgn] = useState<string>("");
  const [openFen, setOpenFen] = useState<string | undefined>();

  /**
   * The version the open chapter was last seen at. A ref, for the same reason:
   * every save returns a new one, and re-rendering the board over it would
   * throw away where you were standing.
   */
  const version = useRef(1);

  /**
   * The chapter currently open, readable from inside an async reply.
   *
   * A save that lands after you have clicked to another chapter must not stamp
   * this one's version — or its "Saved" — onto that one.
   */
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const active = study?.chapters.find((c) => c.id === activeId) ?? null;
  const canEdit = study?.can_edit ?? false;

  useEffect(() => {
    if (!ref) {
      setError("No study was named in that link.");
      return;
    }
    api
      .getStudy(ref)
      .then((s) => {
        setStudy(s);
        const first = s.chapters[0];
        if (first) {
          setActiveId(first.id);
          setOpenPgn(first.pgn);
          setOpenFen(first.starting_fen);
          version.current = first.version;
        }
      })
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? "That study does not exist, or is not shared with you."
            : "Could not open that study."
        )
      );
  }, [ref]);

  const openChapter = useCallback((chapter: StudyChapter) => {
    setActiveId(chapter.id);
    setOpenPgn(chapter.pgn);
    setOpenFen(chapter.starting_fen);
    version.current = chapter.version;
    setSaving(null);
  }, []);

  /** Fold a changed chapter back into the study without touching the board. */
  const merge = useCallback((chapter: StudyChapter) => {
    setStudy((s) =>
      s
        ? { ...s, chapters: s.chapters.map((c) => (c.id === chapter.id ? chapter : c)) }
        : s
    );
  }, []);

  /**
   * Write the tree back. Called on the board's own debounce.
   *
   * The version guard is what makes a shared study safe to write to: a chapter
   * is stored whole, so a save built on a stale copy would not merge badly, it
   * would delete whatever the other person added. The server refuses one, and
   * this says so rather than pretending the work was kept.
   */
  const persist = useCallback(
    async (movetext: string) => {
      const id = activeId;
      if (id == null) return;
      setSaving({ text: "Saving…" });
      try {
        const saved = await api.updateChapter(ref, id, {
          pgn: movetext,
          version: version.current,
        });
        // Only if we are still on the chapter the save was for: switching away
        // mid-flight must not stamp this chapter's version onto another.
        if (activeIdRef.current === id) {
          version.current = saved.version;
          setSaving({ text: "Saved" });
        }
        merge(saved);
      } catch (err) {
        const stale = err instanceof ApiError && err.code === "stale_chapter";
        setSaving({
          text: stale ? "Someone else saved this — reload" : "Not saved",
          bad: true,
        });
      }
    },
    [ref, activeId, merge]
  );

  async function addChapter() {
    if (!study) return;
    setBusy(true);
    try {
      const chapter = await api.createChapter(ref, {
        name: `Chapter ${study.chapters.length + 1}`,
      });
      setStudy({ ...study, chapters: [...study.chapters, chapter] });
      openChapter(chapter);
    } catch (err) {
      setSaving({
        text: err instanceof ApiError ? err.message : "Could not add a chapter",
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function duplicateChapter(id: number) {
    if (!study || busy) return;
    setBusy(true);
    try {
      const chapter = await api.duplicateChapter(ref, id);
      setStudy((current) => current
        ? { ...current, chapters: [...current.chapters, chapter] }
        : current);
      setSaving({ text: `Copied the last saved version of this chapter` });
    } catch (err) {
      setSaving({
        text: err instanceof ApiError ? err.message : "Could not duplicate that chapter",
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function importPgn() {
    if (!study || busy) return;
    let chapters;
    try {
      chapters = parseStudyImport(importText);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not read that PGN");
      return;
    }
    if (study.chapters.length + chapters.length > 64) {
      setImportError("A study holds 64 chapters. Import fewer chapters or start another study.");
      return;
    }
    setBusy(true);
    setImportError(null);
    try {
      const imported = await api.importStudyChapters(ref, chapters);
      setStudy((current) => current
        ? { ...current, chapters: [...current.chapters, ...imported] }
        : current);
      setSaving({ text: `Imported ${imported.length} chapter${imported.length === 1 ? "" : "s"}` });
      setShowImport(false);
      setImportText("");
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Could not import that PGN");
    } finally {
      setBusy(false);
    }
  }

  async function renameChapter(id: number, name: string) {
    const before = study?.chapters.find((c) => c.id === id);
    if (!before) return;

    merge({ ...before, name });
    try {
      merge(await api.updateChapter(ref, id, { name }));
    } catch {
      merge(before);
      setSaving({ text: "Could not rename that chapter — name restored", bad: true });
    }
  }

  async function deleteChapter(id: number) {
    if (!study || study.chapters.length < 2) return;
    const doomed = study.chapters.find((c) => c.id === id);
    if (!confirm(`Delete "${doomed?.name}" and everything in it?`)) return;

    // Gone from the list and off the board before the request goes out. The
    // whole study is restored on failure rather than just re-inserting the
    // chapter: position ordering lives on the server, and a local splice would
    // guess at where it went.
    const before = study;
    const left = study.chapters.filter((c) => c.id !== id);
    setStudy({ ...study, chapters: left });
    if (activeId === id && left[0]) openChapter(left[0]);

    try {
      await api.deleteChapter(ref, id);
    } catch (err) {
      setStudy(before);
      if (doomed) openChapter(doomed);
      setSaving({
        text: err instanceof ApiError ? err.message : "Could not delete that chapter",
        bad: true,
      });
    }
  }

  async function moveChapter(id: number, delta: -1 | 1) {
    if (!study) return;
    const order = study.chapters.map((c) => c.id);
    const at = order.indexOf(id);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];

    // Shown in the new order straight away; the request only records it.
    const byId = new Map(study.chapters.map((c) => [c.id, c]));
    setStudy({ ...study, chapters: order.map((cid) => byId.get(cid)!) });
    setBusy(true);
    try {
      await api.reorderChapters(ref, order);
    } catch {
      api.getStudy(ref).then(setStudy).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function flipChapter() {
    if (!active) return;
    const before = active;
    const orientation = active.orientation === "white" ? "black" : "white";

    // The board turns on the click. This is the one control where a round trip
    // was unmistakable: flipping is a reflex, and a board that turns half a
    // second late reads as a dropped click.
    merge({ ...before, orientation });
    try {
      merge(await api.updateChapter(ref, before.id, { orientation }));
    } catch {
      merge(before);
      setSaving({ text: "Could not save the board's side — flipped back", bad: true });
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <p className="font-display text-xl">Not available</p>
        <p className="mt-2 text-sm text-muted">{error}</p>
        <Link href="/study" className="btn-primary mt-4 inline-block">
          Your studies
        </Link>
      </div>
    );
  }

  if (!study || !active) {
    return <p className="p-8 text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header
        className="z-40 flex h-14 shrink-0 items-center gap-2 border-b border-line/50
                   bg-panel/90 px-3 shadow-[0_2px_10px_rgba(77,47,24,0.14)] backdrop-blur-xl"
      >
        <button
          className="btn px-2"
          onClick={() => setRailOpen((s) => !s)}
          aria-label="Toggle chapters"
          title="Toggle chapters"
        >
          {railOpen ? "⟨" : "⟩"}
        </button>

        <Link href="/study" className="btn shrink-0 px-2 text-sm">
          ← Studies
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={study.name}>
            {study.name}
          </p>
          <p className="truncate text-[11px] text-muted">
            {canEdit ? `${study.chapters.length} chapters` : `Read-only · by ${study.owner_name}`}
          </p>
        </div>

        <a
          href={api.studyPgnUrl(ref)}
          className="btn shrink-0 px-2 text-xs"
          title="Download every chapter as one PGN file"
        >
          PGN
        </a>
        {canEdit && (
          <button
            onClick={() => setShowShare((s) => !s)}
            className="btn shrink-0 px-2 text-xs"
            aria-pressed={showShare}
          >
            Share
          </button>
        )}
        <button
          onClick={flipChapter}
          disabled={!canEdit}
          title="Which side this chapter is read from"
          className="btn shrink-0 px-2 text-xs disabled:opacity-40"
        >
          {active.orientation === "white" ? "♔" : "♚"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {railOpen && (
          <aside
            className="shrink-0 border-b border-line/35 bg-panel/40 lg:h-full lg:w-56
                       lg:border-b-0 lg:border-r"
          >
            <StudyChapters
              chapters={study.chapters}
              activeId={activeId}
              canEdit={canEdit}
              busy={busy}
              onSelect={(id) => {
                const chapter = study.chapters.find((c) => c.id === id);
                if (chapter) openChapter(chapter);
              }}
              onAdd={addChapter}
              onImport={() => { setImportError(null); setShowImport(true); }}
              onDuplicate={duplicateChapter}
              onRename={renameChapter}
              onDelete={deleteChapter}
              onMove={moveChapter}
            />
          </aside>
        )}

        <main className="min-h-0 flex-1">
          <AnalysisBoard
            key={active.id}
            initialPgn={openPgn}
            gameLabel={active.name}
            study={{
              startFen: openFen,
              orientation: active.orientation,
              readOnly: !canEdit,
              onPersist: persist,
              status: saving?.text ?? null,
            }}
          />
        </main>

        {showShare && canEdit && (
          <aside
            className="shrink-0 border-t border-line/35 bg-panel/60 p-3 lg:h-full lg:w-72
                       lg:overflow-y-auto lg:border-l lg:border-t-0"
          >
            <StudyShare
              study={study}
              members={study.members}
              onStudy={(s: Study) => setStudy({ ...study, ...s })}
              onMembers={(members: StudyMember[]) => setStudy({ ...study, members })}
            />
          </aside>
        )}
      </div>

      {showImport && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="study-import-title"
               className="w-full max-w-xl rounded-xl border border-line/40 bg-panel p-5 shadow-xl">
            <h2 id="study-import-title" className="font-display text-xl">Import PGN chapters</h2>
            <p className="mt-1 text-sm text-muted">
              Paste a PGN or choose a file. Each game becomes a chapter; moves,
              variations and comments stay with it. Lichess study exports work here.
            </p>
            <input
              type="file"
              accept=".pgn,application/x-chess-pgn,text/plain"
              aria-label="Choose PGN file"
              className="mt-4 block w-full text-sm"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 5_000_000) {
                  setImportError("Choose a PGN file smaller than 5 MB.");
                  return;
                }
                setImportText(await file.text());
                setImportError(null);
              }}
            />
            <label htmlFor="study-import-pgn" className="mt-4 block text-xs text-muted">
              PGN text
            </label>
            <textarea
              id="study-import-pgn"
              className="input mt-1 h-48 w-full font-mono text-xs"
              value={importText}
              onChange={(event) => { setImportText(event.target.value); setImportError(null); }}
              placeholder={'[Event "My study: Chapter 1"]\n\n1. e4 (1. d4) e5 *'}
            />
            {importError && <p role="alert" className="mt-2 text-sm text-bad">{importError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn" disabled={busy} onClick={() => setShowImport(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !importText.trim()} onClick={importPgn}>
                {busy ? "Importing…" : "Add chapters"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudyViewPage() {
  // useSearchParams needs a boundary in an exported app; without it the build
  // refuses the page outright.
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Loading…</p>}>
      <StudyWorkspace />
    </Suspense>
  );
}
