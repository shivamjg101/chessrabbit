"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError, Insights, InsightsRange, InsightsSource, OtbPlayer, TimeClass, api,
} from "@/lib/api";
import {
  CalendarSection, GamesSection, MovesSection, OpeningsSection,
  PhasesSection, ResultsSection,
} from "@/components/InsightsSections";
import { findings } from "@/lib/findings";

const SECTIONS = [
  { id: "games", label: "Games", hint: "How are the games going?" },
  { id: "results", label: "Results", hint: "How do they end?" },
  { id: "phases", label: "Phases & shapes", hint: "Where are they decided?" },
  { id: "openings", label: "Openings", hint: "What gets played, and how does it go?" },
  { id: "moves", label: "Moves", hint: "Where do the strengths lie?" },
  { id: "calendar", label: "Calendar", hint: "When are the best results?" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const TIME_CLASSES: { id: TimeClass | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bullet", label: "Bullet" },
  { id: "blitz", label: "Blitz" },
  { id: "rapid", label: "Rapid" },
  { id: "classical", label: "Classical" },
];

const RANGES: { id: InsightsRange; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "1y", label: "Last year" },
  { id: "90d", label: "90 days" },
  { id: "30d", label: "30 days" },
];

const COLORS: { id: "all" | "w" | "b"; label: string }[] = [
  { id: "all", label: "Both" },
  { id: "w", label: "White" },
  { id: "b", label: "Black" },
];

const SOURCES: { id: InsightsSource; label: string; hint: string }[] = [
  { id: "lichess", label: "Lichess", hint: "lichess username" },
  { id: "chesscom", label: "Chess.com", hint: "chess.com username" },
  { id: "otb", label: "Over the board", hint: "e.g. Carlsen, Magnus" },
];

/** Who the page is about: the signed-in user, or somebody looked up. */
type Subject = { kind: "me" } | { kind: "player"; source: InsightsSource; name: string };

/**
 * The findings, across the top, each one a link into the chart it came from.
 *
 * Deliberately silent when nothing clears its evidence threshold: a band of
 * three cards that always fills itself would be filled with noise on the day a
 * player has forty games, and after that nobody would believe the day it says
 * something real. See lib/findings.ts.
 */
function FindingsBand({
  data,
  onJump,
}: {
  data: Insights;
  onJump: (s: SectionId) => void;
}) {
  const found = findings(data);
  if (found.length === 0) return null;

  /* The column count follows the findings, because the findings are allowed to
     number fewer than three — a fixed three-column grid left an empty cell
     sitting on the divider colour, which reads as a card that failed to load
     rather than as a finding that was never claimed. */
  const cols =
    found.length === 1
      ? "grid-cols-1"
      : found.length === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <section className="border-b border-line/35 bg-panelAlt/25">
      <div className="mx-auto max-w-6xl px-3 py-4">
        <p className="rule-label mb-3">What your games say</p>
        <div className={`grid gap-px overflow-hidden rounded-md bg-line/40 ${cols}`}>
          {/* Severity is a stripe, not the headline colour. Three coral
              headlines in a row shout at each other, and coral in this app
              means a move that lost — a diagnosis is not a verdict. The stripe
              carries the tone and the words stay in chalk, which is also the
              same device the verdict plate on /app uses. */}
          {found.map((f) => (
            <button
              key={f.kind}
              onClick={() => onJump(f.section)}
              className="bg-night p-3 pl-4 text-left transition-colors hover:bg-panelAlt/60"
              style={{
                borderLeft: `3px solid ${f.tone === "bad" ? "#A0352A" : "#286047"}`,
              }}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                {f.kind}
              </span>
              <p className="mt-1 text-[15px] font-semibold leading-tight text-ink">
                {f.headline}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{f.detail}</p>
              {/* Always visible: a hover-only affordance tells a touch user
                  nothing, and these are the band's whole point. */}
              <span className="mt-1.5 inline-block text-[11px] text-brassLit">
                See the chart →
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function InsightsPage() {
  const router = useRouter();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionId>("games");

  const [timeClass, setTimeClass] = useState<TimeClass | "all">("all");
  const [range, setRange] = useState<InsightsRange>("all");
  const [color, setColor] = useState<"all" | "w" | "b">("all");

  const [subject, setSubject] = useState<Subject>({ kind: "me" });

  const load = useCallback(() => {
    setLoading(true);
    const query = {
      timeClass: timeClass === "all" ? undefined : timeClass,
      range,
      color: color === "all" ? undefined : color,
    };
    const req =
      subject.kind === "me"
        ? api.insights(query)
        : api.playerInsights(subject.source, subject.name, query);

    req
      .then((res) => {
        setData(res);
        setError(null);
          })
      .catch((err) => {
        setData(null);
            setError(
          err instanceof ApiError
            ? err.message
            : subject.kind === "me"
              ? "Could not load your insights"
              : "Could not load that player"
        );
      })
      .finally(() => setLoading(false));
  }, [timeClass, range, color, subject]);

  useEffect(() => {
    api.me().then(load).catch(() => router.push("/login"));
  }, [router, load]);

  const body = () => {
    if (!data) return null;
    switch (section) {
      case "games": return <GamesSection data={data} />;
      case "results": return <ResultsSection data={data} />;
      case "phases": return <PhasesSection data={data} />;
      case "openings": return <OpeningsSection data={data} />;
      case "moves": return <MovesSection data={data} />;
      case "calendar": return <CalendarSection data={data} />;
    }
  };

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="min-h-dvh">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line/35 bg-panel/70 px-3 backdrop-blur-xl">
        <Link href="/app" className="btn px-2" aria-label="Back to the board">
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-xl leading-none">
            {subject.kind === "me" ? "Insights" : subject.name}
          </h1>
          <p className="truncate text-[11px] text-muted">
            {data
              ? `${data.games.toLocaleString()} games analysed${
                  data.source
                    ? ` · ${SOURCES.find((s) => s.id === data.source)?.label}`
                    : ""
                }`
              : subject.kind === "me"
                ? "Reading your games…"
                : `Reading ${subject.name}'s games…`}
          </p>
        </div>
        <nav className="seg ml-auto hidden md:flex">
          {[
            { href: "/app", label: "Analyse" },
            { href: "/train", label: "Train" },
            { href: "/play", label: "Play" },
            { href: "/insights", label: "Insights", active: true },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`seg-item ${n.active ? "seg-item-on" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ---------- Filters ----------

          Not sticky. Two stacked sticky bars took 132px off the top of every
          screen before a single chart appeared, which on a phone is a fifth of
          the viewport spent on controls you set once and then leave alone. The
          header stays pinned; the filters scroll away with the page. */}
      <div className="border-b border-line/35 bg-panel/40 px-3 py-2.5">
        <div className="mx-auto max-w-6xl space-y-2">
          <SubjectPicker subject={subject} onChange={setSubject} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FilterGroup
              label="Time class"
              options={TIME_CLASSES}
              value={timeClass}
              onChange={setTimeClass}
            />
            <FilterGroup label="Colour" options={COLORS} value={color} onChange={setColor} />
            <FilterGroup label="Range" options={RANGES} value={range} onChange={setRange} />
          </div>
        </div>
      </div>

      {/* ---------- What the games say ----------

          The page's actual question, answered before the charts rather than
          left for the reader to work out by scanning six of them. */}
      {data && <FindingsBand data={data} onJump={setSection} />}

      {subject.kind === "me" && data && data.practice_games && data.practice_games.length > 0 && (
        <section className="mx-auto max-w-6xl px-3 pt-5">
          <h2 className="font-display text-xl">Practise positions from your games</h2>
          <p className="mt-1 text-sm text-muted">Guess the better move before revealing the engine review.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.practice_games.map((game) => (
              <Link key={game.id} href={`/train/review?game=${game.id}`} className="card p-3 hover:border-brass/50">
                <p className="truncate text-sm font-medium">{game.white} vs {game.black}</p>
                <p className="mt-1 truncate text-xs text-muted">
                  {game.opening || game.played_on || "Reviewed game"} · {game.critical_moves} critical moves
                </p>
                <span className="mt-2 inline-block text-xs text-brassLit">Test yourself →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Rail first in the source and on the left at desktop width: it is this
          page's primary navigation, and it used to sit on the right where it
          was read last. */}
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-3 py-5 lg:flex-row">
        {/* ---------- Section rail ---------- */}
        <aside className="lg:sticky lg:top-16 lg:h-fit lg:w-52 lg:shrink-0">
          <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                /* Brass, not verdigris: choosing a section is navigation, and
                   verdigris in this app only ever means "you got it right". */
                className={`flex shrink-0 items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors lg:w-full ${
                  section === s.id
                    ? "bg-brass/15 text-brassLit ring-1 ring-brass/40"
                    : "text-muted hover:bg-ink/[0.06] hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {data && (
            <div className="mt-3 hidden rounded-xl border border-line/35 bg-panelAlt/50 p-3 text-[11px] leading-relaxed text-muted lg:block">
              {data.engine_metrics === false ? (
                <p>
                  Built from{" "}
                  <span className="font-mono font-semibold text-ink">
                    {data.games.toLocaleString()}
                  </span>{" "}
                  games, replaying the most recent{" "}
                  {(data.replayed ?? 0).toLocaleString()} for the piece and
                  castling charts. Accuracy and move quality need an engine
                  review, which we only run on your own games.
                </p>
              ) : (
                <p>
                  <span className="font-mono font-semibold text-ink">
                    {data.reviewed.toLocaleString()}
                  </span>{" "}
                  of your games have an engine review. Accuracy, phases, shapes and
                  move quality are built from those.
                </p>
              )}
              {data.engine_metrics !== false && data.unattributed > 0 && (
                <p className="mt-2">
                  {data.unattributed.toLocaleString()} game
                  {data.unattributed === 1 ? " is" : "s are"} excluded — we
                  can&apos;t tell which side you played. Connect the account you
                  played them on and re-sync.
                </p>
              )}
            </div>
          )}
        </aside>

        {/* ---------- Body ---------- */}
        <main className="min-w-0 flex-1">
          <div className="mb-3">
            <h2 className="font-display text-xl">{current.label}</h2>
            <p className="text-sm text-muted">{current.hint}</p>
          </div>

          {error && (
            <div className="card p-4">
              <p className="text-sm text-bad">{error}</p>
              <button className="btn mt-3 text-xs" onClick={load}>
                Try again
              </button>
            </div>
          )}

          {loading && !data && (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="card h-40 animate-pulse"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              ))}
            </div>
          )}



          {data && data.games === 0 && !loading && (
            <div className="card p-6 text-center">
              <p className="font-display text-lg">Nothing to show yet</p>
              {subject.kind === "me" ? (
                <>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                    Insights are built from your own games. Connect your Lichess or
                    Chess.com account and your history imports automatically — then
                    this page fills in.
                  </p>
                  <Link href="/app" className="btn-primary mt-4 inline-block text-sm">
                    Connect an account
                  </Link>
                </>
              ) : (
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                  No finished games for {subject.name} with these filters. Try
                  widening the range or clearing the time class.
                </p>
              )}
            </div>
          )}

          {data && data.games > 0 && (
            <div className={loading ? "opacity-60 transition-opacity" : ""}>
              {body()}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Choose whose insights to read.
 *
 * Over-the-board is a picker rather than free text: reference PGNs spell names
 * "Lastname, Firstname", which nobody guesses correctly, and an exact match is
 * what lets the query use the indexed lower(white)/lower(black) columns.
 */
function SubjectPicker({
  subject,
  onChange,
}: {
  subject: Subject;
  onChange: (s: Subject) => void;
}) {
  const [open, setOpen] = useState(subject.kind === "player");
  const [source, setSource] = useState<InsightsSource>(
    subject.kind === "player" ? subject.source : "lichess"
  );
  const [text, setText] = useState(subject.kind === "player" ? subject.name : "");
  const [matches, setMatches] = useState<OtbPlayer[]>([]);

  // Only the OTB source can suggest names — we hold that database. Debounced
  // so typing does not fire a query per keystroke.
  useEffect(() => {
    if (source !== "otb" || text.trim().length < 2) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchOtbPlayers(text.trim()).then(setMatches).catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [source, text]);

  const submit = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setMatches([]);
    onChange({ kind: "player", source, name: trimmed });
  };

  const active = SOURCES.find((s) => s.id === source)!;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="seg">
        <button
          className={`seg-item text-xs ${subject.kind === "me" ? "seg-item-on" : ""}`}
          onClick={() => {
            onChange({ kind: "me" });
            setOpen(false);
          }}
        >
          You
        </button>
        <button
          className={`seg-item text-xs ${subject.kind === "player" ? "seg-item-on" : ""}`}
          onClick={() => setOpen(true)}
        >
          Another player
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className={`seg-item text-xs ${source === s.id ? "seg-item-on" : ""}`}
                onClick={() => {
                  setSource(s.id);
                  setMatches([]);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <input
              className="input w-56 py-1 text-sm"
              placeholder={active.hint}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(text);
                if (e.key === "Escape") setMatches([]);
              }}
              aria-label={`Search by ${active.hint}`}
            />
            {matches.length > 0 && (
              <ul className="card absolute left-0 top-full z-50 mt-1 max-h-64 w-72 overflow-y-auto p-1 shadow-card">
                {matches.map((m) => (
                  <li key={m.name}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink/[0.06]"
                      onClick={() => {
                        setText(m.name);
                        submit(m.name);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {m.games.toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button className="btn text-xs" onClick={() => submit(text)} disabled={!text.trim()}>
            Show
          </button>
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow hidden sm:inline">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`seg-item text-xs ${value === o.id ? "seg-item-on" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
