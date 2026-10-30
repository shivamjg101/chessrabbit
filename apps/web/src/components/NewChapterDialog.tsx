"use client";

import { useEffect, useMemo, useState } from "react";
import BoardEditor from "@/components/BoardEditor";
import ChapterOptions, { ChapterOptionValues } from "@/components/ChapterOptions";
import Modal from "@/components/Modal";
import { api, ApiError, ChapterDraft, Game, StudyChapter } from "@/lib/api";
import { chaptersFromPgn, mergedChapter } from "@/lib/chapterImport";
import { START_FEN } from "@/lib/boardEditor";

/**
 * Making a chapter, the four ways Lichess offers: an empty board, a position
 * set up by hand, PGN pasted or loaded from a file (one chapter per game, or
 * every game merged into one tree), or games already in your database.
 */

type Source = "empty" | "position" | "pgn" | "games";

const SOURCES: { id: Source; label: string }[] = [
  { id: "empty", label: "Empty" },
  { id: "position", label: "Position" },
  { id: "pgn", label: "PGN" },
  { id: "games", label: "My games" },
];

/** The study's chapter limit, as the server enforces it. */
const MAX_CHAPTERS = 64;

/** A game's own headers, as the tags its chapter should keep. */
export function gameTags(g: Game): Record<string, string> {
  const tags: Record<string, string> = {};
  if (g.white) tags.White = g.white;
  if (g.black) tags.Black = g.black;
  if (g.white_elo) tags.WhiteElo = String(g.white_elo);
  if (g.black_elo) tags.BlackElo = String(g.black_elo);
  if (g.event) tags.Event = g.event;
  if (g.played_on) tags.Date = g.played_on.replace(/-/g, ".");
  if (g.result) tags.Result = g.result;
  if (g.eco) tags.ECO = g.eco;
  if (g.opening) tags.Opening = g.opening;
  return tags;
}

interface Props {
  studyRef: string;
  chapterCount: number;
  onCreated: (chapters: StudyChapter[]) => void;
  onClose: () => void;
}

export default function NewChapterDialog({ studyRef, chapterCount, onCreated, onClose }: Props) {
  const [source, setSource] = useState<Source>("empty");
  const [name, setName] = useState(`Chapter ${chapterCount + 1}`);
  const [options, setOptions] = useState<ChapterOptionValues>({
    orientation: "white",
    mode: "normal",
    hide_engine: false,
  });
  const [pgn, setPgn] = useState("");
  const [merge, setMerge] = useState(false);
  const [games, setGames] = useState<Game[] | null>(null);
  const [gameQuery, setGameQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = MAX_CHAPTERS - chapterCount;

  useEffect(() => {
    if (source !== "games" || games !== null) return;
    api
      .queryGames({ limit: 200, sort: "added", order: "desc" })
      .then(setGames)
      .catch(() => setGames([]));
  }, [source, games]);

  const drafts = useMemo(
    () => (source === "pgn" && pgn.trim() ? chaptersFromPgn(pgn, options) : []),
    [source, pgn, options]
  );

  const visibleGames = useMemo(() => {
    const q = gameQuery.trim().toLowerCase();
    if (!games) return [];
    if (!q) return games;
    return games.filter((g) =>
      [g.white, g.black, g.event, g.opening ?? "", g.eco ?? ""].some((v) => v.toLowerCase().includes(q))
    );
  }, [games, gameQuery]);

  async function create(list: ChapterDraft[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const made =
        list.length === 1
          ? [await api.createChapter(studyRef, list[0])]
          : await api.importChapters(studyRef, list);
      onCreated(made);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the chapter");
      setBusy(false);
    }
  }

  async function fromPgn() {
    if (merge) {
      const { draft, merged, skipped } = mergedChapter([pgn], name.trim() || "Merged games", options);
      if (!draft) return setError("No games with moves were found in that PGN.");
      if (skipped) setError(`${skipped} game${skipped === 1 ? "" : "s"} started from another position and were left out.`);
      if (merged) await create([draft]);
      return;
    }
    if (drafts.length === 0) return setError("No games were found in that PGN.");
    if (drafts.length > room) {
      return setError(`That PGN has ${drafts.length} games and this study has room for ${room} more chapters.`);
    }
    // One game takes the name typed above when it was changed from the default.
    const single =
      drafts.length === 1 && name.trim() && name !== `Chapter ${chapterCount + 1}`
        ? [{ ...drafts[0], name: name.trim() }]
        : drafts;
    await create(single);
  }

  async function fromGames() {
    const chosen = (games ?? []).filter((g) => picked.includes(g.id));
    if (chosen.length === 0) return;
    if (merge) {
      setBusy(true);
      try {
        const texts = await Promise.all(chosen.map((g) => api.getGame(g.id).then((d) => d.movetext)));
        const { draft } = mergedChapter(texts, name.trim() || "Merged games", options);
        if (!draft) {
          setError("Those games have no moves to merge.");
          setBusy(false);
          return;
        }
        await create([draft]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not read those games");
        setBusy(false);
      }
      return;
    }
    if (chosen.length > room) {
      return setError(`You picked ${chosen.length} games and this study has room for ${room} more chapters.`);
    }
    await create(
      chosen.map((g) => ({
        name: `${g.white || "?"} – ${g.black || "?"}`.slice(0, 120),
        from_game_id: g.id,
        tags: gameTags(g),
        ...options,
      }))
    );
  }

  function readFile(file: File) {
    // A ChessBase or Lichess export of a few hundred games is a few hundred
    // kilobytes; anything past a few megabytes is a database, not a study.
    if (file.size > 4_000_000) return setError("That file is larger than a study can hold.");
    const reader = new FileReader();
    reader.onload = () => setPgn(String(reader.result ?? ""));
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsText(file);
  }

  return (
    <Modal title="New chapter" onClose={onClose} wide={source === "position"}>
      <div className="seg w-full">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSource(s.id);
              setError(null);
            }}
            className={`seg-item flex-1 text-xs ${source === s.id ? "seg-item-on" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {(source === "empty" || source === "position" || merge) && (
        <label className="block">
          <span className="eyebrow mb-1 block">Name</span>
          <input
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}

      <ChapterOptions value={options} onChange={setOptions} disabled={busy} />

      {source === "empty" && (
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => create([{ name: name.trim(), ...options }])}
          >
            {busy ? "Creating…" : "Create chapter"}
          </button>
        </div>
      )}

      {source === "position" && (
        <BoardEditor
          initialFen={START_FEN}
          doneLabel={busy ? "Creating…" : "Create chapter"}
          onCancel={onClose}
          onDone={(fen) =>
            create([
              {
                name: name.trim() || `Chapter ${chapterCount + 1}`,
                starting_fen: fen,
                ...options,
              },
            ])
          }
        />
      )}

      {source === "pgn" && (
        <div className="space-y-2">
          <textarea
            className="input h-40 font-mono text-xs"
            placeholder={'[Event "..."]\n[White "..."]\n\n1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 {a comment} *'}
            value={pgn}
            onChange={(e) => setPgn(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="btn cursor-pointer px-2 py-1 text-xs">
              Load a .pgn file
              <input
                type="file"
                accept=".pgn,application/x-chess-pgn,text/plain"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
              />
            </label>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              Merge every game into one chapter
            </label>
            <span className="ml-auto text-muted">
              {pgn.trim()
                ? merge
                  ? `${drafts.length} game${drafts.length === 1 ? "" : "s"} → 1 chapter`
                  : `${drafts.length} chapter${drafts.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || !pgn.trim()} onClick={fromPgn}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}

      {source === "games" && (
        <div className="space-y-2">
          <input
            className="input text-sm"
            placeholder="Filter by player, event, opening or ECO"
            value={gameQuery}
            onChange={(e) => setGameQuery(e.target.value)}
          />
          <div className="max-h-64 overflow-y-auto rounded-xl border border-ivory/[0.06]">
            {games === null ? (
              <p className="p-3 text-xs text-muted">Loading your games…</p>
            ) : visibleGames.length === 0 ? (
              <p className="p-3 text-xs text-muted">No games match.</p>
            ) : (
              <ul className="divide-y divide-ivory/[0.04]">
                {visibleGames.map((g) => (
                  <li key={g.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-ivory/[0.05]">
                      <input
                        type="checkbox"
                        checked={picked.includes(g.id)}
                        onChange={(e) =>
                          setPicked((p) => (e.target.checked ? [...p, g.id] : p.filter((x) => x !== g.id)))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {g.white || "?"} – {g.black || "?"}
                      </span>
                      <span className="font-mono text-[10px] text-muted">{g.result}</span>
                      <span className="hidden w-24 truncate text-[10px] text-muted sm:inline">
                        {g.opening ?? g.eco ?? ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              Merge them into one chapter
            </label>
            <span className="ml-auto text-muted">{picked.length} selected</span>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy || picked.length === 0} onClick={fromGames}>
              {busy ? "Creating…" : merge ? "Create merged chapter" : `Create ${picked.length || ""} chapter${picked.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
    </Modal>
  );
}
