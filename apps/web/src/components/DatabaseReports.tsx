"use client";

/**
 * The database screen's reports, the ones a ChessBase user opens a database
 * for: the doubles in it, an event's crosstable, and a player's dossier.
 *
 * Each is a dialog over the game list. The crosstable and the dossier lead
 * into one another - a name in the standings opens that player's dossier, an
 * opponent in a dossier opens theirs - and a game in a dossier opens on the
 * board.
 */

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import {
  api,
  ApiError,
  Crosstable,
  DuplicateGroup,
  EventSummary,
  PlayerDossier,
  ScoreLine,
} from "@/lib/api";

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** 2.5 as a crosstable writes it: 2½. */
export function points(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  return half ? `${whole || ""}½` : String(whole);
}

function dateSpan(first: string | null, last: string | null): string {
  if (!first && !last) return "undated";
  if (first === last || !last) return first ?? "";
  return `${first} – ${last}`;
}

// ---------- duplicates ----------

/** Games the API's own delete route accepts in one request. */
const DELETE_BATCH = 1000;

export function DuplicatesDialog({
  onClose,
  onDeleted,
}: {
  onClose: () => void;
  onDeleted: (count: number) => void;
}) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .findDuplicates()
      .then((res) => {
        setGroups(res.groups);
        setTotal(res.total);
      })
      .catch((err) => setError(message(err, "Could not look for duplicates")));
  }, []);

  async function removeAll() {
    if (!groups?.length) return;
    if (!confirm(`Delete ${total} duplicate game${total === 1 ? "" : "s"}? One copy of each game stays.`)) return;
    const ids = groups.flatMap((g) => g.duplicates);
    setBusy(true);
    try {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        await api.deleteGames(ids.slice(i, i + DELETE_BATCH));
      }
      onDeleted(ids.length);
    } catch (err) {
      setError(message(err, "Some duplicates could not be deleted"));
      setBusy(false);
    }
  }

  return (
    <Modal title="Duplicate games" onClose={onClose}>
      <p className="text-xs text-muted">
        The same players, result, date and moves, more than once. The copy with your notes or review is kept.
      </p>
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
      {groups === null && !error ? (
        <p className="text-sm text-muted">Looking…</p>
      ) : groups && groups.length === 0 ? (
        <p className="text-sm">No duplicates. Every game is in your database once.</p>
      ) : (
        groups && (
          <>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {groups.map((g) => (
                <li key={g.keep} className="flex items-baseline gap-2 rounded-lg bg-ivory/[0.04] px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    {g.white || "?"} – {g.black || "?"}
                  </span>
                  <span className="font-mono text-xs text-muted">{g.result}</span>
                  <span className="hidden text-xs text-muted sm:inline">{g.played_on ?? "undated"}</span>
                  <span className="rounded-md bg-ivory/[0.07] px-1.5 font-mono text-[11px]">×{g.duplicates.length + 1}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={onClose}>
                Keep them
              </button>
              <button className="btn-primary" disabled={busy} onClick={removeAll}>
                {busy ? "Deleting…" : `Delete ${total} duplicate${total === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )
      )}
    </Modal>
  );
}

// ---------- crosstable ----------

export function CrosstableDialog({
  initialEvent,
  onClose,
  onPlayer,
}: {
  initialEvent?: string;
  onClose: () => void;
  onPlayer: (name: string) => void;
}) {
  const [q, setQ] = useState(initialEvent ?? "");
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [event, setEvent] = useState<string | null>(null);
  const [table, setTable] = useState<Crosstable | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The event list follows the box, a moment after typing stops.
  useEffect(() => {
    if (event) return;
    const timer = setTimeout(() => {
      api
        .listEvents(q)
        .then((rows) => {
          setEvents(rows);
          setError(null);
        })
        .catch((err) => setError(message(err, "Could not list your events")));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, event]);

  useEffect(() => {
    if (!event) return;
    setTable(null);
    setError(null);
    api
      .crosstable(event)
      .then(setTable)
      .catch((err) => setError(message(err, "Could not build that crosstable")));
  }, [event]);

  return (
    <Modal title={event ? event : "Crosstable"} onClose={onClose} wide>
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
      {!event ? (
        <>
          <input
            className="input py-1.5 text-sm"
            placeholder="Event name"
            aria-label="Find an event"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
          />
          {events === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted">
              No event in your database has more than one game{q.trim() ? " under that name" : ""}.
            </p>
          ) : (
            <ul className="max-h-80 space-y-0.5 overflow-y-auto text-sm">
              {events.map((e) => (
                <li key={e.event}>
                  <button
                    className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-ivory/[0.07]"
                    onClick={() => setEvent(e.event)}
                  >
                    <span className="min-w-0 flex-1 truncate">{e.event}</span>
                    <span className="hidden text-xs text-muted sm:inline">{dateSpan(e.first_date, e.last_date)}</span>
                    <span className="font-mono text-xs text-muted">{e.games} games</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
            <button className="btn px-2 py-1 text-xs" onClick={() => { setEvent(null); setTable(null); }}>
              ← Events
            </button>
            {table && (
              <span>
                {table.players.length} players · {table.games} games
                {table.unfinished ? ` (${table.unfinished} unfinished)` : ""} · {dateSpan(table.first_date, table.last_date)}
              </span>
            )}
          </div>
          {!table && !error && <p className="text-sm text-muted">Building…</p>}
          {table && <Standings table={table} onPlayer={onPlayer} />}
        </>
      )}
    </Modal>
  );
}

function Standings({ table, onPlayer }: { table: Crosstable; onPlayer: (name: string) => void }) {
  const matrix = table.players.some((p) => p.results.length > 0);
  return (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-ivory/[0.06]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel text-left text-[11px] uppercase tracking-wider text-muted">
          <tr className="border-b border-ivory/[0.06]">
            <th className="px-2 py-1.5 text-right">#</th>
            <th className="px-2 py-1.5">Player</th>
            <th className="px-2 py-1.5 text-right">Elo</th>
            {matrix &&
              table.players.map((_, i) => (
                <th key={i} className="w-8 px-1 py-1.5 text-center font-mono">
                  {i + 1}
                </th>
              ))}
            <th className="px-2 py-1.5 text-right">Pts</th>
            <th className="px-2 py-1.5 text-right" title="Sonneborn-Berger">
              SB
            </th>
            <th className="px-2 py-1.5 text-right" title="Elo performance">
              Perf
            </th>
          </tr>
        </thead>
        <tbody>
          {table.players.map((p, i) => (
            <tr key={p.name} className="border-b border-ivory/[0.04] last:border-0">
              <td className="px-2 py-1 text-right font-mono text-xs text-muted">{i + 1}</td>
              <td className="max-w-[180px] truncate px-2 py-1">
                <button className="hover:text-accent hover:underline" onClick={() => onPlayer(p.name)}>
                  {p.name}
                </button>
              </td>
              <td className="px-2 py-1 text-right font-mono text-xs text-muted">{p.elo ?? ""}</td>
              {matrix &&
                p.results.map((r, j) => (
                  <td
                    key={j}
                    className={`px-1 py-1 text-center font-mono text-xs ${i === j ? "bg-ivory/[0.06]" : ""}`}
                  >
                    {r}
                  </td>
                ))}
              <td className="px-2 py-1 text-right font-mono font-semibold">{points(p.score)}</td>
              <td className="px-2 py-1 text-right font-mono text-xs text-muted">{p.tiebreak.toFixed(2)}</td>
              <td className="px-2 py-1 text-right font-mono text-xs text-muted">{p.performance ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- player dossier ----------

export function DossierDialog({
  initialName,
  onClose,
  onOpenGame,
}: {
  initialName?: string;
  onClose: () => void;
  onOpenGame: (id: number) => void;
}) {
  const [q, setQ] = useState(initialName ?? "");
  const [matches, setMatches] = useState<{ name: string; games: number }[]>([]);
  const [name, setName] = useState<string | null>(initialName?.trim() ? initialName.trim() : null);
  const [dossier, setDossier] = useState<PlayerDossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (name || !q.trim()) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      api.findPlayers(q.trim()).then(setMatches).catch(() => setMatches([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, name]);

  useEffect(() => {
    if (!name) return;
    setDossier(null);
    setError(null);
    api
      .playerDossier(name)
      .then(setDossier)
      .catch((err) => {
        setError(message(err, "Could not build that dossier"));
        setName(null);
      });
  }, [name]);

  const open = (who: string) => {
    setQ(who);
    setName(who);
  };

  return (
    <Modal title={dossier ? dossier.name : "Player dossier"} onClose={onClose} wide>
      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
      {!name ? (
        <>
          <input
            className="input py-1.5 text-sm"
            placeholder="Player name"
            aria-label="Find a player"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q.trim() && open(matches[0]?.name ?? q.trim())}
          />
          {matches.length > 0 && (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto text-sm">
              {matches.map((m) => (
                <li key={m.name}>
                  <button
                    className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-ivory/[0.07]"
                    onClick={() => open(m.name)}
                  >
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="font-mono text-xs text-muted">{m.games} games</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : !dossier ? (
        !error && <p className="text-sm text-muted">Reading their games…</p>
      ) : (
        <Dossier d={dossier} onPlayer={open} onOpenGame={onOpenGame} onBack={() => { setName(null); setDossier(null); }} />
      )}
    </Modal>
  );
}

function Score({ label, s }: { label: string; s: ScoreLine }) {
  return (
    <div className="rounded-xl bg-ivory/[0.04] px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-xl">{s.games ? `${s.score_pct}%` : "–"}</p>
      <p className="font-mono text-[11px] text-muted">
        {s.games} games · +{s.wins} ={s.draws} −{s.losses}
      </p>
    </div>
  );
}

function Openings({
  label,
  rows,
}: {
  label: string;
  rows: PlayerDossier["openings_white"];
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="eyebrow mb-1">{label}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">No finished games.</p>
      ) : (
        <ul className="space-y-0.5 text-xs">
          {rows.map((o, i) => (
            <li key={i} className="flex items-baseline gap-2">
              {o.eco && <span className="rounded-md bg-ivory/[0.07] px-1 font-mono">{o.eco}</span>}
              <span className="min-w-0 flex-1 truncate">{o.opening || (o.eco ? "" : "Unclassified")}</span>
              <span className="font-mono text-muted">
                {o.games} · {o.score_pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dossier({
  d,
  onPlayer,
  onOpenGame,
  onBack,
}: {
  d: PlayerDossier;
  onPlayer: (name: string) => void;
  onOpenGame: (id: number) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted">
        <button className="btn px-2 py-1 text-xs" onClick={onBack}>
          ← Players
        </button>
        <span>{dateSpan(d.first_date, d.last_date)}</span>
        {d.highest_elo && (
          <span>
            · Elo {d.latest_elo ?? d.highest_elo}
            {d.latest_elo !== d.highest_elo ? ` (peak ${d.highest_elo})` : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Score label="Overall" s={d.total} />
        <Score label="With White" s={d.as_white} />
        <Score label="With Black" s={d.as_black} />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Openings label="Openings with White" rows={d.openings_white} />
        <Openings label="Openings with Black" rows={d.openings_black} />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">Most met</p>
          <ul className="space-y-0.5 text-xs">
            {d.opponents.map((o) => (
              <li key={o.name} className="flex items-baseline gap-2">
                <button className="min-w-0 flex-1 truncate text-left hover:text-accent hover:underline" onClick={() => onPlayer(o.name)}>
                  {o.name}
                </button>
                <span className="font-mono text-muted">
                  {o.games} · {o.score_pct}%
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1">Latest games</p>
          <ul className="space-y-0.5 text-xs">
            {d.recent.map((g) => (
              <li key={g.id}>
                <button
                  className="flex w-full items-baseline gap-2 rounded-md px-1 text-left hover:bg-ivory/[0.07]"
                  onClick={() => onOpenGame(g.id)}
                  title="Open on the board"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {g.white} – {g.black}
                  </span>
                  <span className="font-mono">{g.result}</span>
                  <span className="hidden text-muted sm:inline">{g.played_on ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
