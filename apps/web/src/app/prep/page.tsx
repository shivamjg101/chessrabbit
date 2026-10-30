"use client";

/**
 * Opponent preparation. Enter who you're facing and where they
 * play; we pull their recent games, show what they actually open with, and
 * build drills using the local master book or replies from those games.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, Me, PrepDossier, PrepLine } from "@/lib/api";

type Platform = "lichess" | "chesscom";

export default function PrepPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [platform, setPlatform] = useState<Platform>("lichess");
  const [username, setUsername] = useState("");
  const [myColor, setMyColor] = useState<"white" | "black">("white");
  const [dossier, setDossier] = useState<PrepDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(setMe).catch(() => router.push("/login"));
  }, [router]);


  async function scout() {
    setLoading(true);
    setError(null);
    setDossier(null);
    setBuilt(null);
    try {
      setDossier(await api.prepOpponent(platform, username.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not fetch that account");
    } finally {
      setLoading(false);
    }
  }

  async function buildPrep() {
    if (!dossier) return;
    setBuilding(true);
    setError(null);
    setBuilt(null);
    try {
      const rep = await api.prepRepertoire(dossier.platform as Platform, dossier.username, myColor);
      const gameBased = rep.prep_sources?.opponent_games ?? 0;
      setBuilt(`${rep.name} — ${rep.card_count} positions ready to drill${gameBased ? `. ${gameBased} use replies from their games; review these with an engine before adopting them` : ""}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not build the prep");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="min-h-screen p-4 max-w-4xl mx-auto">
      <header className="glass relative z-30 mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/app" className="btn">← Board</Link>
        <h1 className="font-display text-xl">🎯 Opponent Prep</h1>

      </header>


      {me && (
        <>
          <div className="card p-4 flex gap-2 flex-wrap items-end">
            <div>
              <label className="text-xs text-muted block mb-1">Platform</label>
              <select
                className="input w-36"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
              >
                <option value="lichess">Lichess</option>
                <option value="chesscom">Chess.com</option>
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted block mb-1">Opponent username</label>
              <input
                className="input"
                placeholder="MagnusCarlsen"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && username.trim() && scout()}
              />
            </div>
            <button
              className="btn-primary"
              disabled={!username.trim() || loading || building}
              onClick={scout}
            >
              {loading ? "Scouting…" : "Scout"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-bad mt-4 cursor-pointer" onClick={() => setError(null)}>
              {error} (dismiss)
            </p>
          )}

          {dossier && (
            <div className="mt-6 space-y-6">
              <p className="text-sm text-muted">
                <span className="text-ink font-semibold">{dossier.username}</span> ·{" "}
                {dossier.platform} · {dossier.games_analyzed} recent games analysed
              </p>

              <div className="grid md:grid-cols-2 gap-4">
                <LineTable title="When they play White" lines={dossier.as_white} />
                <LineTable title="When they play Black" lines={dossier.as_black} />
              </div>

              <div className="card p-4 flex gap-3 items-center flex-wrap">
                <span className="text-sm">Build a counter-repertoire — I&apos;ll play</span>
                <select
                  className="input w-28"
                  value={myColor}
                  disabled={building}
                  onChange={(e) => { setMyColor(e.target.value as "white" | "black"); setBuilt(null); }}
                >
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
                <button className="btn-primary" disabled={building} onClick={buildPrep}>
                  {building ? "Building…" : "Build prep drills"}
                </button>
                {built && (
                  <span className="text-sm text-accent2">
                    ✓ {built} —{" "}
                    <Link href="/train" className="underline">drill now</Link>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">
                Replies use your local master database when available. Otherwise, drills
                use the most common replies in this opponent&apos;s games. These game-based
                replies are practice material, not engine recommendations.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LineTable({ title, lines }: { title: string; lines: PrepLine[] }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-xs text-muted">No recent games with this colour.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l, i) => {
            const total = Math.max(1, l.wins + l.draws + l.losses);
            return (
              <li key={i} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-mono truncate">{l.moves.join(" ")}</span>
                  <span className="text-muted shrink-0">×{l.count}</span>
                </div>
                <div className="flex h-1.5 rounded-md overflow-hidden mt-1 bg-black/30">
                  <div className="bg-accent" style={{ width: `${(100 * l.wins) / total}%` }} />
                  <div className="bg-muted/60" style={{ width: `${(100 * l.draws) / total}%` }} />
                  <div className="bg-bad/70" style={{ width: `${(100 * l.losses) / total}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
