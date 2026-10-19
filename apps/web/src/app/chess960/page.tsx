"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Chessboard } from "react-chessboard";
import { api, Chess960Position, EngineInfo, EvalLine } from "@/lib/api";
import { useBoardTheme } from "@/lib/boardTheme";

export default function Chess960Page() {
  const router = useRouter();
  const skin = useBoardTheme();
  const [index, setIndex] = useState(518);
  const [activeIndex, setActiveIndex] = useState(518);
  const [position, setPosition] = useState<Chess960Position | null>(null);
  const [history, setHistory] = useState<Chess960Position[]>([]);
  const [played, setPlayed] = useState<string[]>([]);
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [engine, setEngine] = useState("stockfish");
  const [evaluation, setEvaluation] = useState<EvalLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const analysisJob = useRef<number | null>(null);

  function invalidateAnalysis() {
    generation.current++;
    if (analysisJob.current !== null) api.cancelJob(analysisJob.current).catch(() => {});
    analysisJob.current = null;
    setAnalysing(false);
    setEvaluation(null);
  }

  useEffect(() => {
    api.chess960Start(518).then(setPosition).catch(() => setError("Could not load Chess960 position."));
    api.listEngines().then((all) => setEngines(all.filter((item) => item.available))).catch(() => {});
    return () => {
      if (analysisJob.current !== null) api.cancelJob(analysisJob.current).catch(() => {});
    };
  }, []);

  async function start(nextIndex: number) {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex > 959) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.chess960Start(nextIndex);
      invalidateAnalysis();
      setIndex(nextIndex);
      setActiveIndex(nextIndex);
      setPosition(next);
      setHistory([]);
      setPlayed([]);
    } catch { setError("Could not start that position."); }
    finally { setBusy(false); }
  }

  async function play(uci: string) {
    if (!position || busy || saving) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.chess960Move(position.fen, uci);
      invalidateAnalysis();
      setHistory((items) => [...items, position]);
      setPlayed((items) => [...items, uci]);
      setPosition(next);
    } catch { setError("That move is no longer legal. Try again."); }
    finally { setBusy(false); }
  }

  function undo() {
    if (!history.length) return;
    invalidateAnalysis();
    setPosition(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setPlayed(played.slice(0, -1));
  }

  async function save() {
    if (!played.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.chess960Save(activeIndex, played);
      router.push(`/chess960/game?game=${result.game_id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save game.");
    } finally { setSaving(false); }
  }

  async function analyse() {
    if (!position || analysing) return;
    const version = ++generation.current;
    setAnalysing(true);
    setEvaluation(null);
    setError("");
    try {
      const started = await api.analysePosition(position.fen, 16, 1, engine, "chess960");
      if (version !== generation.current) {
        api.cancelJob(started.job_id).catch(() => {});
        return;
      }
      analysisJob.current = started.job_id;
      let result = started.result;
      for (let attempt = 0; !result && attempt < 90; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (version !== generation.current) return;
        const job = await api.getJob(started.job_id);
        if (job.status === "failed" || job.status === "canceled") throw new Error("Engine could not analyse Chess960. Choose an engine with UCI_Chess960 support.");
        if (job.status === "done") result = job.result;
      }
      if (!result) throw new Error("Analysis timed out.");
      if (version === generation.current) setEvaluation(result.lines?.[0] ?? null);
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "Analysis failed.");
    } finally {
      if (version === generation.current) {
        analysisJob.current = null;
        setAnalysing(false);
      }
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4 pb-12 sm:p-8">
      <Link href="/app" className="text-sm text-accent">← Analysis board</Link>
      <h1 className="mt-3 font-display text-3xl">Chess960</h1>
      <p className="mt-1 text-sm text-muted">Explore any of the 960 legal starting arrays. Moves, including unusual castling, are validated by the server.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
        <div className="space-y-4">
          {position && <div className="board-frame w-[min(90vw,440px)]">
            <Chessboard position={position.fen} arePiecesDraggable={false} {...skin.props} animationDuration={skin.animationMs} />
          </div>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted">Start number
              <input className="input mt-1 w-24" type="number" min={0} max={959} value={index} onChange={(event) => setIndex(Number(event.target.value))} />
            </label>
            <button className="btn" disabled={busy || saving} onClick={() => start(index)}>Set up</button>
            <button className="btn" disabled={busy || saving} onClick={() => start(Math.floor(Math.random() * 960))}>Random</button>
            <button className="btn" disabled={!history.length || busy || saving} onClick={undo}>Undo</button>
            <button className="btn-primary" disabled={!played.length || busy || saving} onClick={save}>{saving ? "Saving…" : "Save game"}</button>
          </div>
          <p className="break-all font-mono text-[11px] text-muted">{position?.fen}</p>
        </div>
        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="font-display text-xl">{position?.result ? `Game over · ${position.result}` : `${position?.turn ?? "White"} to move`}</h2>
            <p className="mt-1 text-xs text-muted">Choose a legal move below. Castling is shown as O-O or O-O-O.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {position?.moves.map((move) => <button key={move.uci} className="btn px-2 py-1 font-mono text-xs" disabled={busy || saving} onClick={() => play(move.uci)}>{move.san}</button>)}
            </div>
          </section>
          <section className="card space-y-3 p-4">
            <h2 className="font-display text-xl">Engine</h2>
            <select className="input" value={engine} onChange={(event) => setEngine(event.target.value)}>
              {engines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="btn-primary" disabled={!position || analysing || !engines.length} onClick={analyse}>{analysing ? "Analysing…" : "Analyse this position"}</button>
            {evaluation && <p className="font-mono text-sm">Depth {evaluation.depth} · {evaluation.mate != null ? `Mate ${evaluation.mate}` : `${((evaluation.cp ?? 0) / 100).toFixed(2)} pawns for White`}</p>}
            {evaluation?.pv?.length ? <p className="break-all font-mono text-xs text-muted">{evaluation.pv.join(" ")}</p> : null}
          </section>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        </div>
      </div>
    </main>
  );
}
