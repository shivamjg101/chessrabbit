"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Chessboard } from "react-chessboard";
import { api, GameDetail, GameLine, ReviewSummary } from "@/lib/api";
import { useBoardTheme } from "@/lib/boardTheme";

function SavedGame() {
  const id = Number(useSearchParams().get("game"));
  const skin = useBoardTheme();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [line, setLine] = useState<GameLine | null>(null);
  const [ply, setPly] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError("Choose a saved game from your library.");
      return;
    }
    Promise.all([api.getGame(id), api.getGameLine(id)]).then(([details, moves]) => {
      if (details.variant !== "chess960" || moves.variant !== "chess960") {
        setError("This is not a Chess960 game.");
        return;
      }
      setGame(details);
      setLine(moves);
    }).catch(() => setError("Could not load that game."));
  }, [id]);

  async function review() {
    if (!game || reviewing) return;
    setReviewing(true);
    setError("");
    try {
      const started = await api.analyseGame(game.id);
      let result: ReviewSummary | null = null;
      for (let attempt = 0; attempt < 300; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const job = await api.getJob(started.job_id);
        if (job.status === "failed" || job.status === "canceled") {
          throw new Error("Review stopped. Check that the selected engine supports UCI_Chess960.");
        }
        if (job.status === "done") {
          result = job.result as ReviewSummary;
          break;
        }
      }
      if (!result) throw new Error("Review is still running. Reopen this game to check its annotations.");
      setSummary(result);
      setGame(await api.getGame(game.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    } finally { setReviewing(false); }
  }

  const shown = game?.annotations.find((item) => item.ply === ply - 1);
  const position = ply === 0 ? line?.start_fen : line?.moves[ply - 1]?.fen;

  return <main className="mx-auto max-w-5xl p-4 pb-12 sm:p-8">
    <Link href="/app" className="text-sm text-accent">← My games</Link>
    <h1 className="mt-3 font-display text-3xl">Chess960 game</h1>
    {game && <p className="mt-1 text-sm text-muted">{game.white} vs {game.black} · {game.result}</p>}
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
      <div className="space-y-4">
        {position && <div className="board-frame w-[min(90vw,440px)]">
          <Chessboard position={position} arePiecesDraggable={false} {...skin.props} animationDuration={skin.animationMs} />
        </div>}
        <div className="flex gap-2">
          <button className="btn" disabled={!ply} onClick={() => setPly(0)}>Start</button>
          <button className="btn" disabled={!ply} onClick={() => setPly(ply - 1)}>Previous</button>
          <button className="btn" disabled={!line || ply >= line.moves.length} onClick={() => setPly(ply + 1)}>Next</button>
          <button className="btn" disabled={!line || ply >= line.moves.length} onClick={() => setPly(line?.moves.length ?? 0)}>End</button>
        </div>
        <p className="break-all font-mono text-[11px] text-muted">{position}</p>
      </div>
      <div className="space-y-4">
        <section className="card p-4">
          <h2 className="font-display text-xl">Moves</h2>
          <div className="mt-3 flex max-h-72 flex-wrap gap-1 overflow-y-auto">
            {line?.moves.map((move) => <button key={move.ply} className={`rounded px-2 py-1 font-mono text-xs ${ply === move.ply + 1 ? "bg-accent text-ebony" : "bg-ivory/10 hover:bg-ivory/20"}`} onClick={() => setPly(move.ply + 1)}>
              {move.ply % 2 === 0 ? `${Math.floor(move.ply / 2) + 1}.` : ""}{move.san}
            </button>)}
          </div>
          {shown && <p className="mt-3 text-sm">{shown.classification ? `${shown.classification} · ` : ""}{shown.review || ""}</p>}
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="font-display text-xl">Full-game review</h2>
          <button className="btn-primary" disabled={!game || reviewing} onClick={review}>{reviewing ? "Reviewing…" : game?.annotations.length ? "Re-run review" : "Review this game"}</button>
          {summary && <p className="text-sm text-muted">Accuracy · White {summary.accuracy.white}% · Black {summary.accuracy.black}%</p>}
          <p className="text-xs text-muted">Chess960 reviews are kept separate from standard opening drills and puzzle cards.</p>
        </section>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    </div>
  </main>;
}

export default function SavedChess960Page() {
  return <Suspense fallback={<main className="p-8 text-muted">Loading game…</main>}><SavedGame /></Suspense>;
}
