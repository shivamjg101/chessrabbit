"use client";

/**
 * Time Bank drill: ten puzzles, one shared 3:00 clock, difficulties
 * deliberately mixed and hidden. The skill being trained is allocation -
 * snap out the simple positions to bank time for the hard ones. The end
 * report shows where the clock actually went versus where it should have.
 * Runs outside the rating system (like Rush).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { api, ApiError, Puzzle } from "@/lib/api";
import { useClickToMove } from "@/hooks/useClickToMove";

const ROUNDS = 10;
const TOTAL_SECONDS = 180;
const TARGET_MIX = [850, 950, 1000, 1100, 900, 1600, 1750, 1850, 2000, 1500];
const EASY_CUTOFF = 1300;

type Phase = "idle" | "loading" | "intro" | "solving" | "opponent" | "flash" | "done";

interface RoundResult {
  rating: number;
  seconds: number;
  solved: boolean;
}

function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined };
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ClockDrillPage() {
  const skin = useBoardTheme();
  const router = useRouter();
  const game = useRef(new Chess());
  const puzzleRef = useRef<Puzzle | null>(null);
  const targetsRef = useRef<number[]>([]);
  const roundRef = useRef(0);
  const puzzleStart = useRef(0);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [fen, setFen] = useState(game.current.fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [solIdx, setSolIdx] = useState(0);
  const [round, setRound] = useState(0);
  const [clock, setClock] = useState(TOTAL_SECONDS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [lastVerdict, setLastVerdict] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().catch(() => router.push("/login"));
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [router]);

  const finishDrill = useCallback(() => {
    if (clockRef.current) clearInterval(clockRef.current);
    clockRef.current = null;
    setPhase("done");
  }, []);

  // Global clock: one interval for the whole drill.
  useEffect(() => {
    if (phase === "done" && clockRef.current) {
      clearInterval(clockRef.current);
      clockRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (clock <= 0 && phase !== "idle" && phase !== "done") finishDrill();
  }, [clock, phase, finishDrill]);

  const loadPuzzle = useCallback(async () => {
    const i = roundRef.current;
    if (i >= ROUNDS) {
      finishDrill();
      return;
    }
    setPhase("loading");
    try {
      const p = await api.nextPuzzle({ rating: targetsRef.current[i], mode: "clock" });
      const g = new Chess(p.fen);
      game.current = g;
      puzzleRef.current = p;
      setRound(i + 1);
      setOrientation(g.turn() === "w" ? "black" : "white");
      setFen(g.fen());
      setSolIdx(0);
      setPhase("intro");
      setTimeout(() => {
        g.move(uciToMove(p.moves[0]));
        setFen(g.fen());
        setSolIdx(1);
        puzzleStart.current = Date.now();
        setPhase("solving");
      }, 450);
    } catch {
      setError("Could not load a puzzle.");
      finishDrill();
    }
  }, [finishDrill]);

  const settleRound = useCallback(
    (solved: boolean) => {
      const p = puzzleRef.current;
      if (!p) return;
      const seconds = (Date.now() - puzzleStart.current) / 1000;
      setResults((rs) => [...rs, { rating: p.rating, seconds, solved }]);
      setLastVerdict(solved);
      setPhase("flash");
      roundRef.current += 1;
      setTimeout(() => void loadPuzzle(), solved ? 350 : 650);
    },
    [loadPuzzle]
  );

  const onMove = useCallback(
    (from: string, to: string): boolean => {
      if (phase !== "solving") return false;
      const p = puzzleRef.current;
      if (!p) return false;
      const g = game.current;
      let move;
      try {
        move = g.move({ from, to, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      const played = move.from + move.to + (move.promotion ?? "");
      const expected = p.moves[solIdx];
      const correct = played === expected || g.isCheckmate();

      if (!correct) {
        g.undo();
        setFen(g.fen());
        settleRound(false);
        return false;
      }

      setFen(g.fen());
      const nextIdx = solIdx + 1;
      if (g.isCheckmate() || nextIdx >= p.moves.length) {
        settleRound(true);
        return true;
      }
      setPhase("opponent");
      setSolIdx(nextIdx);
      setTimeout(() => {
        g.move(uciToMove(p.moves[nextIdx]));
        setFen(g.fen());
        setSolIdx(nextIdx + 1);
        setPhase("solving");
      }, 300);
      return true;
    },
    [phase, solIdx, settleRound]
  );

  const { onSquareClick, squareStyles } = useClickToMove(fen, onMove, phase === "solving");

  async function startDrill() {
    setError(null);
    try {
      await api.clockStart();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start this session");
      return;
    }
    targetsRef.current = shuffled(TARGET_MIX);
    roundRef.current = 0;
    setResults([]);
    setClock(TOTAL_SECONDS);
    if (clockRef.current) clearInterval(clockRef.current);
    clockRef.current = setInterval(() => setClock((c) => Math.max(0, c - 1)), 1000);
    void loadPuzzle();
  }

  // ---- report helpers ----
  const solved = results.filter((r) => r.solved).length;
  const easy = results.filter((r) => r.rating < EASY_CUTOFF);
  const hard = results.filter((r) => r.rating >= EASY_CUTOFF);
  const avg = (xs: RoundResult[]) =>
    xs.length ? xs.reduce((s, r) => s + r.seconds, 0) / xs.length : 0;

  function advice(): string[] {
    const out: string[] = [];
    const slowEasy = easy.filter((r) => r.seconds > 25);
    if (slowEasy.length > 0) {
      const worst = [...slowEasy].sort((a, b) => b.seconds - a.seconds)[0];
      out.push(
        `⚠ You spent ${Math.round(worst.seconds)}s on a ${worst.rating}-rated puzzle — ` +
        "snap the simple ones out and bank that time."
      );
    }
    if (hard.length > 0 && easy.length > 0 && avg(hard) < avg(easy)) {
      out.push("⚠ The hard puzzles got less of your clock than the easy ones — invert that.");
    }
    if (hard.length > 0 && easy.length > 0 && avg(hard) >= avg(easy) && hard.some((r) => r.solved)) {
      out.push("✓ Good allocation: quick on the simple positions, invested where it mattered.");
    }
    if (results.length < ROUNDS && clock <= 0) {
      out.push(`The clock beat you at puzzle ${results.length + 1} — earlier savings buy later thinking time.`);
    }
    if (results.length >= ROUNDS && clock > 30) {
      out.push(`✓ Finished with ${clock}s to spare — you could afford deeper thought on the hard ones.`);
    }
    if (out.length === 0) out.push("Balanced clock handling — keep it up.");
    return out;
  }

  const mins = Math.floor(clock / 60);
  const secs = clock % 60;

  return (
    <div className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/train" className="btn">← Training</Link>
        <h1 className="font-display text-xl">Time bank</h1>
        {phase !== "idle" && phase !== "done" && (
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-muted">Puzzle {round}/{ROUNDS}</span>
            <span className={`font-mono text-lg font-bold ${clock <= 30 ? "text-bad" : ""}`}>
              {mins}:{String(secs).padStart(2, "0")}
            </span>
          </span>
        )}
      </header>

      {error && (
        <p className="text-sm text-bad mb-3 cursor-pointer" onClick={() => setError(null)}>
          {error} (dismiss)
        </p>
      )}

      {phase === "idle" && (
        <div className="card p-8 text-center space-y-3 max-w-xl mx-auto">
          <p className="text-2xl font-display">One clock. Ten puzzles.</p>
          <p className="text-muted">
            3:00 for {ROUNDS} puzzles and the difficulties are hidden and wildly
            mixed. Spend seconds where they buy nothing and you&apos;ll have none
            left where they buy everything. A wrong move ends the puzzle.
          </p>
          <button className="btn-primary" onClick={startDrill} autoFocus>
            Start the clock
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="max-w-xl mx-auto space-y-4">
          <div className="card p-6 text-center">
            <p className="text-2xl font-display">
              {solved} / {ROUNDS} solved
            </p>
            <p className="text-sm text-muted mt-1">
              {TOTAL_SECONDS - clock}s used
              {easy.length > 0 && hard.length > 0 &&
                ` · avg ${avg(easy).toFixed(0)}s on easy, ${avg(hard).toFixed(0)}s on hard`}
            </p>
          </div>

          <div className="card p-4">
            <table className="w-full text-sm">
              <thead className="text-muted text-xs">
                <tr>
                  <th className="text-left font-normal">#</th>
                  <th className="text-left font-normal">Difficulty</th>
                  <th className="text-right font-normal">Time</th>
                  <th className="text-right font-normal">Result</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="py-0.5 text-muted">{i + 1}</td>
                    <td>{r.rating < EASY_CUTOFF ? "easy" : "hard"} ({r.rating})</td>
                    <td className="text-right">{r.seconds.toFixed(0)}s</td>
                    <td className={`text-right ${r.solved ? "text-accent" : "text-bad"}`}>
                      {r.solved ? "✓" : "✗"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4 space-y-1">
            {advice().map((a) => (
              <p key={a} className="text-sm">{a}</p>
            ))}
          </div>

          <button className="btn-primary w-full" onClick={startDrill}>
            Run it again
          </button>
        </div>
      )}

      {(phase === "solving" || phase === "opponent" || phase === "intro" ||
        phase === "loading" || phase === "flash") && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="board-frame w-[min(92vw,480px)] shrink-0">
            <Chessboard
              position={fen}
              onPieceDrop={onMove}
              onSquareClick={onSquareClick}
              boardOrientation={orientation}
              arePiecesDraggable={phase === "solving"}
              {...skin.props}
              animationDuration={skin.animationMs}
              customSquareStyles={squareStyles}
            />
          </div>

          <aside className="flex-1 space-y-3 min-w-[260px]">
            <div className="card p-4">
              <p className="text-lg font-semibold flex items-center gap-2">
                <span
                  className={`w-4 h-4 rounded-full border border-ivory/40 ${
                    orientation === "white" ? "bg-white" : "bg-black"
                  }`}
                />
                Your move — difficulty unknown
              </p>
              <p className="text-xs text-muted mt-1">
                {phase === "opponent"
                  ? "Opponent is replying…"
                  : phase === "solving"
                    ? "Cheap position or expensive one? Decide, then spend."
                    : "…"}
              </p>
            </div>
            {phase === "flash" && lastVerdict !== null && (
              <div className={`rounded-2xl p-3 ${lastVerdict ? "bg-accent/20" : "bg-bad/20"}`}>
                <p className="font-semibold">{lastVerdict ? "✓ Solved" : "✗ Missed"} — next…</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
