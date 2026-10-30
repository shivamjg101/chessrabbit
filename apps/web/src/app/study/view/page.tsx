"use client";

/**
 * One study: the chapter rail, the board, and who it is shared with.
 *
 * Opened by id (`?id=12`) for a study you have access to, or by share slug
 * (`?s=…`) for one somebody sent you. Both go through the same request and the
 * same screen — a shared study is not a second, lesser view of a study, it is
 * the same one with the writing turned off. `&chapter=…` opens a given
 * chapter, which is what "copy link to this chapter" hands out.
 *
 * The route is a query parameter rather than a path segment because the web
 * tier ships as a static export: a `[id]` route would need every id known at
 * build time, and studies are made after the build.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AnalysisBoard from "@/components/AnalysisBoard";
import ChapterSettings from "@/components/ChapterSettings";
import LessonBoard from "@/components/LessonBoard";
import NewChapterDialog from "@/components/NewChapterDialog";
import StudyChapters from "@/components/StudyChapters";
import StudyOverview from "@/components/StudyOverview";
import StudySettings from "@/components/StudySettings";
import StudyShare from "@/components/StudyShare";
import { api, ApiError, Study, StudyChapter, StudyDetail, StudyMember } from "@/lib/api";
import { GamePlayers } from "@/components/PlayerPlate";

/** What the board's header says about the last save. */
type SaveState = { text: string; bad?: boolean } | null;

type Dialog = null | "new" | "study" | { chapter: number };

/** The plates name whoever the chapter's tags say played it. */
function playersOf(c: StudyChapter): GamePlayers | undefined {
  const t = c.tags ?? {};
  if (!t.White && !t.Black) return undefined;
  const elo = (v?: string) => (v && Number(v) > 0 ? Number(v) : null);
  return {
    white: t.White ?? "White",
    black: t.Black ?? "Black",
    whiteElo: elo(t.WhiteElo),
    blackElo: elo(t.BlackElo),
    result: t.Result,
  };
}

function StudyWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  // Either form resolves at the same endpoint; the slug is simply another name
  // for the study, and the server decides what it grants.
  const ref = params.get("id") ?? params.get("s") ?? "";
  const chapterParam = Number(params.get("chapter"));

  const [study, setStudy] = useState<StudyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [saving, setSaving] = useState<SaveState>(null);
  const [busy, setBusy] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [overview, setOverview] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** An author looking at their lesson the way a reader will. */
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Who is reading: only the owner may delete the study. Null for a stranger. */
  const [meId, setMeId] = useState<number | null>(null);

  useEffect(() => {
    api.me().then((m) => setMeId(m.id)).catch(() => setMeId(null));
  }, []);

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
  const activeIndex = study && active ? study.chapters.indexOf(active) : -1;
  const canEdit = study?.can_edit ?? false;

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2400);
    return () => clearTimeout(t);
  }, [note]);

  const openChapter = useCallback((chapter: StudyChapter) => {
    setActiveId(chapter.id);
    setOpenPgn(chapter.pgn);
    setOpenFen(chapter.starting_fen);
    version.current = chapter.version;
    setSaving(null);
    setOverview(false);
    setPreview(false);
    // Kept in the address bar, so the link you copy is to the chapter you are
    // on. replaceState rather than a navigation: switching chapters is not a
    // page anybody wants the back button to step through.
    const url = new URL(window.location.href);
    url.searchParams.set("chapter", String(chapter.id));
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    if (!ref) {
      setError("No study was named in that link.");
      return;
    }
    api
      .getStudy(ref)
      .then((s) => {
        setStudy(s);
        const wanted = s.chapters.find((c) => c.id === chapterParam) ?? s.chapters[0];
        if (wanted) {
          setActiveId(wanted.id);
          setOpenPgn(wanted.pgn);
          setOpenFen(wanted.starting_fen);
          version.current = wanted.version;
        }
      })
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? "That study does not exist, or is not shared with you."
            : "Could not open that study."
        )
      );
    // The chapter is read once, on arrival; afterwards the page writes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

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

  function chaptersAdded(made: StudyChapter[]) {
    if (!study || made.length === 0) return;
    setStudy({ ...study, chapters: [...study.chapters, ...made] });
    setDialog(null);
    openChapter(made[0]);
    if (made.length > 1) setNote(`Added ${made.length} chapters`);
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

  /** Settings changed what the chapter is or how it reads; reopen it if it is the one on the board. */
  function chapterSaved(saved: StudyChapter) {
    merge(saved);
    setDialog(null);
    if (saved.id === activeId) {
      version.current = saved.version;
      setOpenFen(saved.starting_fen);
    }
  }

  async function toggleLike() {
    if (!study) return;
    const before = { likes: study.likes, liked: study.liked };
    const liked = !study.liked;
    setStudy({ ...study, liked, likes: study.likes + (liked ? 1 : -1) });
    try {
      const res = await api.likeStudy(ref, liked);
      setStudy((s) => (s ? { ...s, ...res } : s));
    } catch {
      setStudy((s) => (s ? { ...s, ...before } : s));
      setNote("Could not record that — sign in to like studies");
    }
  }

  async function cloneStudy() {
    if (!study) return;
    if (!confirm(`Make your own private copy of "${study.name}"? You can change the copy freely.`)) return;
    setBusy(true);
    try {
      const copy = await api.cloneStudy(ref);
      router.push(`/study/view/?id=${copy.id}`);
      // A new study id in the same route: the page does not remount, so it
      // has to be told to load the copy.
      setStudy(null);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not clone this study");
    } finally {
      setBusy(false);
    }
  }

  async function copyChapterLink() {
    const url = new URL(window.location.href);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNote("Link to this chapter copied");
    } catch {
      setNote("Copying was blocked — copy the address bar instead");
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

  const isOwner = meId != null && meId === study.owner_id;
  const asLesson = active.mode === "lesson" && (!canEdit || preview);
  const next = study.chapters[activeIndex + 1];
  const settingsFor =
    dialog && typeof dialog === "object" ? study.chapters.find((c) => c.id === dialog.chapter) : null;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header
        className="glass-bar z-40 flex h-14 shrink-0 items-center gap-1.5 px-3"
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

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium" title={study.name}>
            {study.name}
          </p>
          <p className="truncate text-[11px] text-muted">
            {canEdit ? `${study.chapters.length} chapters` : `Read-only · by ${study.owner_name}`}
            {study.topics.length > 0 && ` · ${study.topics.join(", ")}`}
          </p>
        </div>

        <button
          onClick={toggleLike}
          aria-pressed={study.liked}
          title={study.liked ? "Unlike" : "Like this study"}
          className={`btn shrink-0 px-2 text-xs ${study.liked ? "text-bad" : ""}`}
        >
          {study.liked ? "♥" : "♡"} {study.likes}
        </button>
        <button
          onClick={() => setOverview((o) => !o)}
          aria-pressed={overview}
          title="All chapters as boards"
          className="btn hidden shrink-0 px-2 text-xs sm:block"
        >
          ▦ Overview
        </button>
        <button
          onClick={() =>
            api.downloadStudyPgn(ref, study.name).catch(() => setNote("Could not download the PGN"))
          }
          className="btn shrink-0 px-2 text-xs"
          title="Download every chapter as one PGN file"
        >
          PGN
        </button>
        <button
          onClick={cloneStudy}
          disabled={busy}
          title="Make your own copy of this study"
          className="btn hidden shrink-0 px-2 text-xs sm:block"
        >
          Clone
        </button>
        {canEdit && (
          <button
            onClick={() => setDialog("study")}
            className="btn shrink-0 px-2 text-xs"
            title="Name, description and topics"
          >
            ⚙
          </button>
        )}
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

      {note && (
        <div className="glass mx-3 mt-2 shrink-0 rounded-xl px-4 py-1.5 text-xs">{note}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {railOpen && (
          <aside
            className="glass m-2 flex shrink-0 flex-col overflow-hidden rounded-2xl lg:mr-0 lg:h-[calc(100%-1rem)] lg:w-60"
          >
            <div className="min-h-0 flex-1">
              <StudyChapters
                chapters={study.chapters}
                activeId={overview ? null : activeId}
                canEdit={canEdit}
                busy={busy}
                onSelect={(id) => {
                  const chapter = study.chapters.find((c) => c.id === id);
                  if (chapter) openChapter(chapter);
                }}
                onAdd={() => setDialog("new")}
                onRename={renameChapter}
                onDelete={deleteChapter}
                onMove={moveChapter}
                onSettings={(id) => setDialog({ chapter: id })}
              />
            </div>
            <div className="shrink-0 space-y-1.5 border-t border-ivory/[0.06] p-2 text-[11px]">
              {active.mode === "lesson" && canEdit && (
                <button
                  onClick={() => setPreview((p) => !p)}
                  className="btn w-full py-1 text-xs"
                  aria-pressed={preview}
                >
                  {preview ? "✎ Back to editing" : "🎓 Preview the lesson"}
                </button>
              )}
              <button onClick={copyChapterLink} className="w-full rounded-md px-2 py-1 text-left text-muted hover:bg-ivory/[0.06] hover:text-ink">
                🔗 Copy link to this chapter
              </button>
            </div>
          </aside>
        )}

        <main className="min-h-0 flex-1">
          {overview ? (
            <StudyOverview study={study} onOpen={openChapter} />
          ) : asLesson ? (
            <LessonBoard
              key={active.id}
              name={active.name}
              description={active.description}
              pgn={active.pgn}
              startFen={active.starting_fen}
              orientation={active.orientation}
              onNext={next ? () => openChapter(next) : undefined}
              onAnalyse={canEdit ? () => setPreview(false) : undefined}
            />
          ) : (
            <AnalysisBoard
              initialPgn={openPgn}
              gameLabel={active.name}
              players={playersOf(active)}
              study={{
                startFen: openFen,
                orientation: active.orientation,
                readOnly: !canEdit,
                onPersist: persist,
                status: saving?.text ?? null,
                mode: active.mode,
                hideEngine: active.hide_engine,
              }}
            />
          )}
        </main>

        {showShare && canEdit && (
          <aside
            className="glass m-2 shrink-0 rounded-2xl p-3 lg:ml-0 lg:h-[calc(100%-1rem)] lg:w-72
                       lg:overflow-y-auto"
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

      {dialog === "new" && (
        <NewChapterDialog
          studyRef={ref}
          chapterCount={study.chapters.length}
          onCreated={chaptersAdded}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "study" && (
        <StudySettings
          study={study}
          isOwner={isOwner}
          onSaved={(s) => {
            setStudy({ ...study, ...s });
            setDialog(null);
          }}
          onDeleted={() => router.push("/study")}
          onClose={() => setDialog(null)}
        />
      )}
      {settingsFor && (
        <ChapterSettings
          studyRef={ref}
          studyName={study.name}
          chapter={settingsFor}
          canEdit={canEdit}
          onSaved={chapterSaved}
          onClose={() => setDialog(null)}
        />
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
