"use client";

/**
 * The body of the Insights page, one component per section so the page file
 * stays a layout and each section owns its own empty state.
 */

import { useState } from "react";
import Link from "next/link";
import { Insights, OpeningRow, Tally } from "@/lib/api";
import { CLASS_META, CLASS_ORDER } from "@/lib/classification";
import {
  OUTCOME, PHASE_LABELS, SEQUENTIAL, SHAPE_LABELS, SLOT_LABELS,
  TERMINATION_LABELS, seriesColor,
} from "@/lib/vizTheme";
import ChartCard, { StatTile } from "@/components/charts/ChartCard";
import WdlBar from "@/components/charts/WdlBar";
import Donut from "@/components/charts/Donut";
import Columns from "@/components/charts/Columns";
import DeltaBars from "@/components/charts/DeltaBars";
import AreaChart from "@/components/charts/AreaChart";

const num = (n: number) => n.toLocaleString();
const acc = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));

// The page keeps its second-person voice when it is about you, and names the
// player when it is not. `data.player` is set only for a looked-up player.
const poss = (d: Insights) => (d.player ? `${d.player}'s` : "your");
const subj = (d: Insights) => (d.player ? d.player : "you");

function NeedsReview({ data }: { data: Insights }) {
  // Another player's games are never engine-reviewed — reviewing a whole
  // career per lookup would cost more than the rest of the product. Say that,
  // rather than inviting someone to review games that are not theirs.
  if (data.engine_metrics === false) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        This one is built from engine reviews, which we only run on your own
        games — analysing {data.player ? `${data.player}'s` : "another player's"}{" "}
        whole history would take hours of engine time. Everything on this page
        that comes from the moves alone is filled in.
      </p>
    );
  }
  if (data.reviewed > 0) return null;
  return (
    <p className="text-xs leading-relaxed text-muted">
      This one is built from engine reviews, and none of your games have been
      reviewed yet.{" "}
      <Link href="/app" className="text-brassLit underline">
        Open a game and run a review
      </Link>{" "}
      — the numbers here fill in as you go.
    </p>
  );
}

// ---------------------------------------------------------------- Games ----

export function GamesSection({ data }: { data: Insights }) {
  const o = data.overview;
  const months = o.by_month.map((m) => ({ label: m.label, value: m.games }));
  const byMove = o.accuracy_by_move.map((m) => ({
    label: `Move ${m.move}`,
    value: m.accuracy ?? 0,
    note: `${num(m.moves)} of ${poss(data)} moves`,
  }));

  return (
    <div className="space-y-4">
      <ChartCard
        title="Games played"
        hint={`Every game we can attribute to ${subj(data)}, and how they finished.`}
      >
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile value={num(o.played)} label="Games" />
          {/* Accuracy is a magnitude, not a verdict, so it stays in chalk.
              Verdigris and coral are reserved for "right" and "lost" — which
              is exactly what a win rate and a loss rate are. */}
          <StatTile
            value={acc(o.accuracy.overall)}
            label="Avg accuracy"
            sub={`${num(data.reviewed)} reviewed`}
          />
          <StatTile
            value={o.played ? `${((o.wins / o.played) * 100).toFixed(1)}%` : "—"}
            label="Win rate"
            tone="accent"
          />
          <StatTile
            value={o.played ? `${((o.losses / o.played) * 100).toFixed(1)}%` : "—"}
            label="Loss rate"
            tone="bad"
          />
        </div>
        <WdlBar wins={o.wins} draws={o.draws} losses={o.losses} height={10} />
        {months.length > 1 && (
          <div className="mt-5">
            <p className="eyebrow mb-2">Games per month</p>
            <AreaChart points={months} color={seriesColor(0)} min={0} height={130} />
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Accuracy"
        hint={`How closely ${poss(data)} moves track the engine’s best — 100 is perfect play.`}
      >
        {data.reviewed === 0 ? (
          <NeedsReview data={data} />
        ) : (
          <>
            {/* Dots on a 50–100 axis, not bars from zero. Accuracy in these
                three states differs by a few points, and bars from zero drew
                three near-identical full-height blocks in the loudest colours
                the palette has — all the ink went to the 85 points every state
                shares, and none to the handful that tell them apart. */}
            <Columns
              mode="dot"
              min={50}
              unit="%"
              columns={[
                { key: "win", label: "When you win", value: o.accuracy.win ?? null, color: OUTCOME.win },
                { key: "draw", label: "When you draw", value: o.accuracy.draw ?? null, color: OUTCOME.draw },
                { key: "loss", label: "When you lose", value: o.accuracy.loss ?? null, color: OUTCOME.loss },
              ]}
              height={120}
            />
            {byMove.length > 2 && (
              <div className="mt-5">
                <p className="eyebrow mb-2">Accuracy by move number</p>
                <AreaChart
                  points={byMove}
                  color={seriesColor(1)}
                  height={140}
                  baseline={
                    o.accuracy.overall != null
                      ? { value: o.accuracy.overall, label: `avg ${acc(o.accuracy.overall)}` }
                      : undefined
                  }
                />
              </div>
            )}
          </>
        )}
      </ChartCard>

      {o.by_opponent_rating.length > 0 && (
        <ChartCard
          title="Results by opponent rating"
          hint="Grouped into 200-point bands. Only games where the opponent's rating was recorded."
        >
          <div className="space-y-2">
            {o.by_opponent_rating.map((b) => (
              <div key={b.bucket} className="flex items-center gap-3">
                <span className="w-16 shrink-0 font-mono text-xs text-muted">
                  {b.bucket}–{b.bucket + 199}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted/70">
                  {num(b.games)}
                </span>
                <div className="min-w-0 flex-1">
                  <WdlBar wins={b.wins} draws={b.draws} losses={b.losses} labels={false} />
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}
    </div>
  );
}

// -------------------------------------------------------------- Results ----

function terminationSlices(rows: { reason: string; games: number }[], color: string) {
  return rows.map((r) => ({
    key: r.reason,
    label: TERMINATION_LABELS[r.reason] ?? r.reason,
    value: r.games,
    color,
  }));
}

export function ResultsSection({ data }: { data: Insights }) {
  const groups = [
    { key: "won", title: `Games ${subj(data)} won by…`, rows: data.results.won_by, color: OUTCOME.win },
    { key: "drew", title: `Games ${subj(data)} drew by…`, rows: data.results.drew_by, color: OUTCOME.draw },
    { key: "lost", title: `Games ${subj(data)} lost by…`, rows: data.results.lost_by, color: OUTCOME.loss },
  ];
  const anyReason = groups.some((g) =>
    g.rows.some((r) => r.reason !== "other")
  );

  return (
    <div className="space-y-4">
      {!anyReason && (
        <ChartCard title={`How ${poss(data)} games ended`} hint="Reason each game finished.">
          <p className="text-xs leading-relaxed text-muted">
            No games record a termination reason yet. Games synced
            from Lichess or Chess.com from now on will carry it — re-sync a
            connected account, or import fresh PGNs, and this fills in.
          </p>
        </ChartCard>
      )}
      {anyReason &&
        groups.map((g) => (
          <ChartCard key={g.key} title={g.title}>
            {/* One outcome per card, so the ring is a composition of a single
                colour's reasons rather than a rainbow of unrelated hues. */}
            <Donut
              slices={terminationSlices(g.rows, g.color).map((s, i) => ({
                ...s,
                color: shade(g.color, i),
              }))}
              centerValue={num(g.rows.reduce((a, b) => a + b.games, 0))}
              centerLabel="games"
            />
          </ChartCard>
        ))}
    </div>
  );
}

/** Steps one hue lighter/darker so a single-outcome ring stays one family. */
function shade(hex: string, i: number): string {
  const amounts = [0, 0.18, -0.16, 0.34, -0.3, 0.5];
  const t = amounts[Math.min(i, amounts.length - 1)];
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// --------------------------------------------------------------- Phases ----

export function PhasesSection({ data }: { data: Insights }) {
  const phases = ["opening", "middlegame", "endgame"];
  const ended = data.phases.ended_in ?? {};
  const accuracy = data.phases.accuracy ?? {};
  const results = data.phases.results ?? {};
  const shapes = data.shapes ?? {};

  if (data.reviewed === 0) {
    return (
      <ChartCard title="Game phases" hint={`Where ${poss(data)} games are won and lost.`}>
        <NeedsReview data={data} />
      </ChartCard>
    );
  }

  return (
    <div className="space-y-4">
      <ChartCard
        title="Accuracy by phase"
        hint="Opening is the first 20 plies; endgame starts once 6 or fewer minor and major pieces remain."
      >
        <Columns
          columns={phases.map((p, i) => ({
            key: p,
            label: PHASE_LABELS[p],
            value: accuracy[p] ?? null,
            sub: ended[p] ? `${num(ended[p])} ended here` : undefined,
            color: SEQUENTIAL[i + 1],
          }))}
        />
      </ChartCard>

      <ChartCard title="Results by the phase a game ended in">
        <div className="space-y-3">
          {phases.map((p) => {
            const t: Tally | undefined = results[p];
            if (!t || t.games === 0) return null;
            return (
              <div key={p}>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-xs font-medium">{PHASE_LABELS[p]}</span>
                  <span className="font-mono text-[11px] text-muted">
                    {num(t.games)} games
                  </span>
                </div>
                <WdlBar wins={t.wins} draws={t.draws} losses={t.losses} />
              </div>
            );
          })}
        </div>
      </ChartCard>

      <ChartCard
        title="Game shapes"
        hint="What the evaluation curve looked like. Our own labels — hover a slice for what each means."
      >
        <Donut
          slices={Object.entries(shapes).map(([k, t]) => ({
            key: k,
            label: SHAPE_LABELS[k]?.label ?? k,
            value: t.games,
          }))}
          centerValue={num(
            Object.values(shapes).reduce((a, t) => a + t.games, 0)
          )}
          centerLabel="reviewed"
        />
        <ul className="mt-4 space-y-1.5 border-t border-ivory/[0.06] pt-3">
          {Object.entries(shapes)
            .sort((a, b) => b[1].games - a[1].games)
            .map(([k, t]) => (
              <li key={k} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-medium">{SHAPE_LABELS[k]?.label ?? k}</span>
                <span className="text-muted">{SHAPE_LABELS[k]?.blurb}</span>
                <span className="ml-auto font-mono text-muted">
                  {t.accuracy == null ? "—" : `${acc(t.accuracy)} acc`}
                </span>
              </li>
            ))}
        </ul>
      </ChartCard>
    </div>
  );
}

// ------------------------------------------------------------- Openings ----

function OpeningTable({ rows }: { rows: OpeningRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-xs text-muted">
        No opening played twice or more with this colour yet.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium" title={r.name}>
              {r.name}
            </div>
            {r.eco && (
              <span className="rounded-md bg-ivory/[0.07] px-1 font-mono text-[10px] text-muted">
                {r.eco}
              </span>
            )}
          </div>
          <span className="self-center font-mono text-[11px] text-muted">
            {num(r.games)}
          </span>
          <div className="col-span-2">
            <WdlBar wins={r.wins} draws={r.draws} losses={r.losses} labels={false} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpeningsSection({ data }: { data: Insights }) {
  const [side, setSide] = useState<"white" | "black">("white");
  const rows = data.openings[side];

  return (
    <ChartCard
      title="Opening performance"
      hint={`${data.player ? data.player + "’s" : "Your"} most-played openings with each colour, by how they actually go.`}
      actions={
        <div className="seg">
          {(["white", "black"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`seg-item text-xs capitalize ${side === s ? "seg-item-on" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>
      }
    >
      <OpeningTable rows={rows} />
    </ChartCard>
  );
}

// ---------------------------------------------------------------- Moves ----

export function MovesSection({ data }: { data: Insights }) {
  const q = data.moves.quality;
  const total = q.reduce((a, r) => a + r.moves, 0);
  const pieces = data.moves.pieces;
  const castle = data.moves.castling;

  if (data.reviewed === 0) {
    return (
      <ChartCard title="Move quality" hint="Every move you played, graded.">
        <NeedsReview data={data} />
      </ChartCard>
    );
  }

  return (
    <div className="space-y-4">
      <ChartCard
        title="Move quality"
        hint={`Across ${num(total)} of your own moves in reviewed games.`}
      >
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted">
              <th className="pb-1.5 text-left font-normal">Verdict</th>
              <th className="pb-1.5 text-right font-normal">Share</th>
              <th className="pb-1.5 text-right font-normal">Moves</th>
            </tr>
          </thead>
          <tbody>
            {CLASS_ORDER.filter((c) => q.some((r) => r.cls === c)).map((cls) => {
              const row = q.find((r) => r.cls === cls)!;
              const meta = CLASS_META[cls];
              return (
                <tr key={cls} className="hover:bg-ivory/[0.04]">
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
                        style={{ background: meta.bg }}
                      >
                        {meta.glyph}
                      </span>
                      <span className={meta.color}>{meta.label}</span>
                    </span>
                  </td>
                  <td className="py-1">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ivory/[0.07]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${row.pct}%`, background: meta.bg }}
                        />
                      </div>
                      <span className="w-11 text-right font-mono font-semibold">
                        {row.pct}%
                      </span>
                    </div>
                  </td>
                  <td className="py-1 text-right font-mono text-muted">
                    {num(row.moves)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartCard>

      {pieces.length > 0 && (
        <>
          <ChartCard
            title="Which pieces you move"
            hint="Share of your moves made by each piece."
          >
            <Donut
              slices={pieces.map((p) => ({
                key: p.piece,
                label: p.piece[0].toUpperCase() + p.piece.slice(1),
                value: p.moves,
              }))}
              centerValue={num(pieces.reduce((a, p) => a + p.moves, 0))}
              centerLabel="moves"
            />
          </ChartCard>

          <ChartCard
            title="Accuracy per piece"
            hint="Which piece you handle best — and which one keeps costing you."
          >
            {data.overview.accuracy.overall != null ? (
              <DeltaBars
                rows={pieces.map((p) => ({
                  key: p.piece,
                  label: p.piece[0].toUpperCase() + p.piece.slice(1),
                  value: p.accuracy,
                  sub: num(p.moves),
                }))}
                baseline={data.overview.accuracy.overall}
                baselineLabel="your average accuracy"
              />
            ) : (
              <NeedsReview data={data} />
            )}
          </ChartCard>
        </>
      )}

      {castle.phase && Object.keys(castle.phase).length > 0 && (
        <ChartCard title="Castling" hint="When you castle, and how those games go.">
          <Donut
            slices={Object.entries(castle.phase).map(([k, v]) => ({
              key: k,
              label: PHASE_LABELS[k] ?? k,
              value: v,
            }))}
            centerValue={num(
              Object.values(castle.side ?? {}).reduce((a, b) => a + b, 0)
            )}
            centerLabel="castled"
          />
          {castle.side && (
            <div className="mt-4 flex justify-center gap-6 border-t border-ivory/[0.06] pt-3 text-xs">
              <span>
                <span className="font-mono font-semibold">{num(castle.side.short ?? 0)}</span>
                <span className="ml-1.5 text-muted">short (O-O)</span>
              </span>
              <span>
                <span className="font-mono font-semibold">{num(castle.side.long ?? 0)}</span>
                <span className="ml-1.5 text-muted">long (O-O-O)</span>
              </span>
            </div>
          )}
        </ChartCard>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Calendar ----

export function CalendarSection({ data }: { data: Insights }) {
  const slots = data.calendar.time_of_day;
  const days = data.calendar.day_of_week;

  return (
    <div className="space-y-4">
      <ChartCard
        title="Time of day"
        hint="In your local timezone. Only games whose start time was recorded."
      >
        {slots.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">
            None of your games record a start time yet. Games synced from now on
            will carry one.
          </p>
        ) : (
          <div className="space-y-3">
            {["morning", "afternoon", "evening", "night"].map((slot) => {
              const s = slots.find((x) => x.slot === slot);
              if (!s) return null;
              return (
                <div key={slot}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-xs font-medium">{SLOT_LABELS[slot]}</span>
                    <span className="font-mono text-[11px] text-muted">
                      {num(s.games)} games
                    </span>
                  </div>
                  <WdlBar wins={s.wins} draws={s.draws} losses={s.losses} />
                </div>
              );
            })}
          </div>
        )}
      </ChartCard>

      <ChartCard title="Day of week" hint="Where your games — and your results — land.">
        {days.length === 0 ? (
          <p className="text-xs text-muted">No dated games yet.</p>
        ) : (
          <div className="space-y-2">
            {days.map((d) => (
              <div key={d.day} className="flex items-center gap-3">
                <span className="w-9 shrink-0 text-xs text-muted">{d.day}</span>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted/70">
                  {num(d.games)}
                </span>
                <div className="min-w-0 flex-1">
                  <WdlBar wins={d.wins} draws={d.draws} losses={d.losses} labels={false} />
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
