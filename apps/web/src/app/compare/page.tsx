"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { api, AnalysisSnapshot, EngineInfo, EvalLine } from "@/lib/api";
import { useBoardTheme } from "@/lib/boardTheme";
import { sanLine } from "@/lib/liveEval";

function score(line: EvalLine): string {
  if (line.mate != null) return `Mate ${line.mate > 0 ? "+" : ""}${line.mate}`;
  const cp = (line.cp ?? 0) / 100;
  return `${cp >= 0 ? "+" : ""}${cp.toFixed(2)}`;
}

async function waitForJob(jobId: number) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const job = await api.getJob(jobId);
    if (job.status === "done") return job;
    if (job.status === "failed" || job.status === "canceled") {
      throw new Error("The engine analysis did not finish.");
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Analysis is taking too long. You can try again later.");
}

function CompareScreen() {
  const params = useSearchParams();
  const skin = useBoardTheme();
  const [fen, setFen] = useState(() => params.get("fen") || new Chess().fen());
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [depth, setDepth] = useState(16);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<AnalysisSnapshot[]>([]);
  const [results, setResults] = useState<AnalysisSnapshot[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.listEngines().then((all) => {
      const available = all.filter((engine) => engine.available);
      setEngines(available);
      const primary = available.find((engine) => engine.id === "stockfish")?.id ?? available[0]?.id ?? "";
      setFirst(primary);
      setSecond(available.find((engine) => engine.id !== primary)?.id ?? "");
    }).catch(() => setError("Could not load installed engines."));
  }, []);

  useEffect(() => {
    const incoming = params.get("fen");
    if (incoming) setFen(incoming);
  }, [params]);

  useEffect(() => {
    try { new Chess(fen); } catch { setHistory([]); return; }
    api.analysisSnapshots(fen).then(setHistory).catch(() => setHistory([]));
  }, [fen]);

  async function compare() {
    let position: string;
    try { position = new Chess(fen).fen(); }
    catch { setError("Enter a legal FEN position."); return; }
    if (!first || !second || first === second) {
      setError("Select two different installed engines.");
      return;
    }
    setError("");
    setResults([]);
    const thought = note.trim();
    try {
      for (const engine of [first, second]) {
        setProgress(`Analysing with ${engines.find((item) => item.id === engine)?.name ?? engine}…`);
        const started = await api.analysePosition(position, depth, 1, engine);
        const completed = started.status === "done" ? started : await waitForJob(started.job_id);
        if (!completed.result?.lines?.length) throw new Error("The engine returned no candidate line.");
        const snapshot = await api.saveAnalysisSnapshot(started.job_id, thought);
        setResults((rows) => [...rows, snapshot]);
      }
      setHistory(await api.analysisSnapshots(position));
      setProgress("");
    } catch (cause) {
      setProgress("");
      setError(cause instanceof Error ? cause.message : "Comparison failed.");
    }
  }

  const ready = engines.length >= 2 && !progress;
  let validFen = false;
  try { new Chess(fen); validFen = true; } catch { /* input is being edited */ }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-6">
      <header className="mb-6 flex items-center gap-3">
        <Link href="/app" className="btn">← Board</Link>
        <h1 className="font-display text-2xl">Compare engines</h1>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-4">
          {validFen && (
            <div className="board-frame w-[min(90vw,420px)]">
              <Chessboard position={fen} arePiecesDraggable={false} {...skin.props} animationDuration={skin.animationMs} />
            </div>
          )}
          <label className="block text-sm">Position (FEN)
            <input className="input mt-1 w-full font-mono text-xs" value={fen} onChange={(event) => setFen(event.target.value)} />
          </label>
          <p className="text-xs text-muted">Write down your idea before revealing the engines&apos; choices.</p>
          <textarea className="input h-24 w-full text-sm" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What would you play, and why?" />
          <div className="grid grid-cols-2 gap-2">
            {[["First engine", first, setFirst], ["Second engine", second, setSecond]].map(([label, value, setValue]) => (
              <label key={label as string} className="text-xs text-muted">{label as string}
                <select className="input mt-1 w-full" value={value as string} onChange={(event) => (setValue as (value: string) => void)(event.target.value)}>
                  <option value="">Select engine</option>
                  {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <label className="block text-xs text-muted">Search depth
            <input className="input mt-1 w-24" type="number" min={12} max={30} value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
          </label>
          <button className="btn-primary" disabled={!ready || !validFen} onClick={compare}>Compare and save</button>
          {engines.length < 2 && <p className="text-sm text-muted">Add a second UCI engine in the Engines menu to compare it with Stockfish.</p>}
          {progress && <p className="text-sm text-accent" role="status">{progress}</p>}
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        </div>
        <div className="space-y-5">
          {results.length > 0 && (
            <section>
              <h2 className="font-display text-xl">This comparison</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {results.map((item) => <SnapshotCard key={item.id} snapshot={item} />)}
              </div>
            </section>
          )}
          <section>
            <h2 className="font-display text-xl">Saved analysis</h2>
            {history.length === 0 && <p className="mt-2 text-sm text-muted">No saved analysis for this position yet.</p>}
            <div className="mt-3 space-y-2">
              {history.filter((item) => !results.some((result) => result.id === item.id))
                .map((item) => <SnapshotCard key={item.id} snapshot={item} />)}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SnapshotCard({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const top = snapshot.lines[0];
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{snapshot.engine_id} <span className="text-xs text-muted">{snapshot.engine_version}</span></p>
        <span className="font-mono text-lg">{top ? score(top) : "—"}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{top ? sanLine(snapshot.fen, top.pv, 8) : "No line"}</p>
      {snapshot.note && <p className="mt-3 border-t border-ivory/10 pt-2 text-sm">Your thought: {snapshot.note}</p>}
      <p className="mt-3 text-[11px] text-faint">
        Depth {snapshot.depth} · {new Date(snapshot.created_at).toLocaleString()} · profile {snapshot.engine_cache_key}
      </p>
    </div>
  );
}

export default function ComparePage() {
  return <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}><CompareScreen /></Suspense>;
}
