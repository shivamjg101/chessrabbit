"use client";

/**
 * The reference database, searchable.
 *
 * Two questions, one screen. "Who played this opening, and how did it go?" is
 * metadata search. "Who else has been in this exact position?" is position
 * search — the thing a ChessBase user actually reaches for, and the reason
 * `game_positions` carries a zobrist row per ply (BLUEPRINT 10.3).
 *
 * The position tab accepts a FEN in the box, but the way it is meant to be
 * reached is the link on the analysis board: you play into a position, you
 * want to know who has been there. It arrives here as `?fen=…`.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MoreMenu from "@/components/MoreMenu";
import { api, ApiError, Game, GameSearchQuery, NoveltyScope, SearchResults } from "@/lib/api";

type Mode = "players" | "position";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const RESULTS = [
  { value: "", label: "Any result" },
  { value: "1-0", label: "White won" },
  { value: "0-1", label: "Black won" },
  { value: "1/2-1/2", label: "Draw" },
];

const EMPTY: GameSearchQuery = {
  white: "",
  black: "",
  eco: "",
  opening: "",
  result: "",
  date_from: "",
  date_to: "",
};

function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const fenParam = params.get("fen");
  // A position can be looked up in your own games too: a new install has no
  // reference database, and your games are often the question anyway.
  const scopeParam: NoveltyScope = params.get("scope") === "mine" ? "mine" : "reference";

  const [mode, setMode] = useState<Mode>(fenParam ? "position" : "players");
  const [query, setQuery] = useState<GameSearchQuery>(EMPTY);
  const [minElo, setMinElo] = useState("");
  const [fen, setFen] = useState(fenParam ?? "");
  const [scope, setScope] = useState<NoveltyScope>(scopeParam);

  const [results, setResults] = useState<SearchResults | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Distinguishes "no games matched" from "you have not searched yet". */
  const [searched, setSearched] = useState(false);

  const run = useCallback(
    async (which: Mode, at: number) => {
      setBusy(true);
      setError(null);
      try {
        const res =
          which === "position"
            ? await api.searchPosition(fen.trim() || START_FEN, at, scope)
            : await api.searchGames(
                { ...query, min_elo: minElo ? Number(minElo) : undefined },
                at
              );
        setResults(res);
        setPage(at);
        setSearched(true);
      } catch (err) {
        setResults(null);
        setError(
          err instanceof ApiError
            ? err.code === "rate_limited"
              ? "That is a lot of searching. Give it a moment."
              : err.message
            : "The search could not be run."
        );
      } finally {
        setBusy(false);
      }
    },
    [fen, query, minElo, scope]
  );

  // A position arriving from the board is a search the user already asked for
  // by clicking; making them press the button again would be a second ask.
  useEffect(() => {
    if (fenParam) run("position", 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fenParam]);

  function switchTo(next: Mode) {
    setMode(next);
    setResults(null);
    setSearched(false);
    setError(null);
    setPage(1);
  }

  const field = (key: keyof GameSearchQuery, label: string, placeholder = "") => (
    <div className="min-w-[130px] flex-1">
      <label className="mb-1 block text-xs text-muted" htmlFor={`f-${key}`}>
        {label}
      </label>
      <input
        id={`f-${key}`}
        className="input"
        placeholder={placeholder}
        value={(query[key] as string) ?? ""}
        onChange={(e) => setQuery({ ...query, [key]: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && run("players", 1)}
      />
    </div>
  );

  return (
    <div className="mx-auto min-h-screen max-w-5xl p-4">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/app" className="btn">
          ← Board
        </Link>
        <h1 className="font-display text-xl">
          {mode === "position" && scope === "mine" ? "Your games" : "Reference database"}
        </h1>
        <nav className="seg ml-auto hidden md:flex">
          <MoreMenu />
        </nav>
      </header>

      <div className="seg mb-4">
        {(["players", "position"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchTo(m)}
            aria-pressed={mode === m}
            className={`seg-item ${mode === m ? "seg-item-on" : ""}`}
          >
            {m === "players" ? "Players & openings" : "Position"}
          </button>
        ))}
      </div>

      {mode === "players" ? (
        <div className="card mb-5 space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {field("white", "White", "Carlsen")}
            {field("black", "Black", "Nepomniachtchi")}
          </div>
          <div className="flex flex-wrap gap-2">
            {field("opening", "Opening", "Najdorf")}
            {field("eco", "ECO", "B90")}
            <div className="min-w-[110px]">
              <label className="mb-1 block text-xs text-muted" htmlFor="f-elo">
                Min Elo
              </label>
              <input
                id="f-elo"
                className="input"
                type="number"
                min={0}
                max={4000}
                placeholder="2200"
                value={minElo}
                onChange={(e) => setMinElo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && run("players", 1)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[130px]">
              <label className="mb-1 block text-xs text-muted" htmlFor="f-result">
                Result
              </label>
              <select
                id="f-result"
                className="input"
                value={query.result ?? ""}
                onChange={(e) => setQuery({ ...query, result: e.target.value })}
              >
                {RESULTS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {field("date_from", "Played from")}
            {field("date_to", "Played to")}
            <button className="btn-primary" disabled={busy} onClick={() => run("players", 1)}>
              {busy ? "Searching…" : "Search"}
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Every box is optional and they combine. Names and openings match
            anywhere in the text; dates are YYYY-MM-DD, and a game with no
            recorded date matches neither bound.
          </p>
        </div>
      ) : (
        <div className="card mb-5 space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="block text-xs text-muted" htmlFor="f-fen">
              Position (FEN)
            </label>
            <div className="seg ml-auto" role="group" aria-label="Which games to search">
              {(["reference", "mine"] as NoveltyScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setScope(s);
                    setResults(null);
                    setSearched(false);
                  }}
                  aria-pressed={scope === s}
                  className={`seg-item text-xs ${scope === s ? "seg-item-on" : ""}`}
                >
                  {s === "reference" ? "Reference games" : "My games"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              id="f-fen"
              className="input min-w-[240px] flex-1 font-mono text-xs"
              placeholder={START_FEN}
              value={fen}
              onChange={(e) => setFen(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run("position", 1)}
            />
            <button className="btn-primary" disabled={busy} onClick={() => run("position", 1)}>
              {busy ? "Searching…" : "Find games"}
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Exact-position search over the first 20 moves of every game in{" "}
            {scope === "mine" ? "your database" : "the reference database"}.
            Easier from the board: play into a position and use{" "}
            <span className="text-ink">Find games with this position</span> in
            its Tools menu or Book tab.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <Results
        mine={mode === "position" && scope === "mine"}
        results={results}
        searched={searched}
        busy={busy}
        page={page}
        onPage={(p) => run(mode, p)}
        onOpen={(g) => router.push(`/app/?game=${g.id}`)}
      />
    </div>
  );
}

function Results({
  mine,
  results,
  searched,
  busy,
  page,
  onPage,
  onOpen,
}: {
  /** The search ran over your games, not the reference database. */
  mine?: boolean;
  results: SearchResults | null;
  searched: boolean;
  busy: boolean;
  page: number;
  onPage: (page: number) => void;
  onOpen: (game: Game) => void;
}) {
  if (!searched) {
    return (
      <p className="text-sm text-muted">
        Results appear here. Nothing is searched until you ask.
      </p>
    );
  }

  if (results && results.games.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="font-display text-lg">No games matched</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          {page > 1
            ? "That was the last page."
            : mine
              ? "None of your games reached this position in their first 20 moves."
              : "Try fewer filters. If nothing at all comes back, the reference database may not be loaded yet — search My games instead, or see pipeline/load_reference_games.py."}
        </p>
      </div>
    );
  }

  if (!results) return null;

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr className="border-b border-ivory/[0.06]">
              <th className="px-3 py-2 font-semibold">White</th>
              <th className="px-3 py-2 font-semibold">Black</th>
              <th className="px-3 py-2 font-semibold">Result</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">Opening</th>
              <th className="hidden px-3 py-2 font-semibold md:table-cell">Event</th>
              <th className="hidden px-3 py-2 font-semibold sm:table-cell">Date</th>
              <th className="px-3 py-2 text-right font-semibold">Moves</th>
            </tr>
          </thead>
          <tbody>
            {results.games.map((g) => (
              <tr
                key={g.id}
                onClick={() => onOpen(g)}
                title="Open in the analysis board"
                className="cursor-pointer border-b border-ivory/[0.04] transition-colors last:border-0 hover:bg-ivory/[0.05]"
              >
                <td className="px-3 py-2">
                  <span className="truncate">{g.white || "?"}</span>
                  {g.white_elo ? (
                    <span className="ml-1.5 font-mono text-[11px] text-muted">{g.white_elo}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <span className="truncate">{g.black || "?"}</span>
                  {g.black_elo ? (
                    <span className="ml-1.5 font-mono text-[11px] text-muted">{g.black_elo}</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{g.result}</td>
                <td className="hidden max-w-[220px] truncate px-3 py-2 text-xs text-muted sm:table-cell">
                  {g.opening ?? g.eco ?? "—"}
                </td>
                <td className="hidden max-w-[180px] truncate px-3 py-2 text-xs text-muted md:table-cell">
                  {g.event || "—"}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted sm:table-cell">
                  {g.played_on ?? "—"}
                </td>
                {/* Plies are what the column holds; moves are what people count. */}
                <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                  {Math.ceil(g.ply_count / 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>
          Page {page} · {results.games.length} game
          {results.games.length === 1 ? "" : "s"}
        </span>
        <button
          className="btn ml-auto px-2 py-1 text-xs disabled:opacity-40"
          disabled={page < 2 || busy}
          onClick={() => onPage(page - 1)}
        >
          ← Previous
        </button>
        <button
          className="btn px-2 py-1 text-xs disabled:opacity-40"
          disabled={!results.has_more || busy}
          onClick={() => onPage(page + 1)}
        >
          Next →
        </button>
      </div>
    </>
  );
}

export default function SearchPage() {
  // useSearchParams needs a boundary in an exported app, or the build fails.
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Loading…</p>}>
      <SearchScreen />
    </Suspense>
  );
}
