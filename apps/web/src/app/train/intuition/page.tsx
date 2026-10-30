"use client";

/**
 * Intuition trainer: guess the master's move.
 *
 * Ten real positions from master games. A short countdown pushes you to
 * answer on pattern recognition, not calculation. You score when you match
 * the move the master played - or the engine's top choice, because finding
 * something even better than the game move is exactly the point.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { api, ApiError, IntuitionPosition } from "@/lib/api";
import { useClickToMove } from "@/hooks/useClickToMove";

const ROUNDS = 10;
const SECONDS = 15;

type Phase = "idle" | "loading" | "answer" | "feedback" | "done";

interface RoundResult {
  hit: boolean;
  label: string;      // what happened, for the feedback panel
  seconds: number;
}

export default function IntuitionPage() {
  const skin = useBoardTheme();
  const router = useRouter();
  const game = useRef(new Chess());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [pos, setPos] = useState<IntuitionPosition | null>(null);
  const [fen, setFen] = useState(game.current.fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [round, setRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SECONDS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [feedback, setFeedback] = useState<RoundResult | null>(null);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.me().catch(() => router.push("/login"));
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [router]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const settle = useCallback(
    (r: RoundResult) => {
      stopTimer();
      setFeedback(r);
      setResults((rs) => [...rs, r]);
      setPhase("feedback");
    },
    [stopTimer]
  );

  const loadRound = useCallback(async () => {
    setPhase("loading");
    setFeedback(null);
    try {
      const p = await api.intuitionNext();
      const g = new Chess(p.fen);
      game.current = g;
      setPos(p);
      setFen(p.fen);
      setOrientation(g.turn() === "w" ? "white" : "black");
      setTimeLeft(SECONDS);
      startedAt.current = Date.now();
      setPhase("answer");
      stopTimer();
      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 0.1) return 0;
          return Math.round((t - 0.1) * 10) / 10;
        });
      }, 100);
    } catch {
      setError("Could not load a position. Is the master database loaded?");
      setPhase("idle");
    }
  }, [stopTimer]);

  // Countdown expiry -> reveal the master move, no point.
  useEffect(() => {
    if (phase === "answer" && timeLeft <= 0 && pos) {
      settle({
        hit: false,
        label: `Time! The master played ${pos.master_san}.`,
        seconds: SECONDS,
      });
    }
  }, [phase, timeLeft, pos, settle]);

  const onMove = useCallback(
    (from: string, to: string): boolean => {
      if (phase !== "answer" || !pos || judging) return false;
      const g = game.current;
      let move;
      try {
        move = g.move({ from, to, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      const seconds = Math.min(SECONDS, (Date.now() - startedAt.current) / 1000);
      const played = move.from + move.to + (move.promotion ?? "");
      setFen(g.fen());
      stopTimer();

      if (played === pos.master_uci) {
        settle({
          hit: true,
          label: `You played ${move.san} — exactly the master's move.`,
          seconds,
        });
        return true;
      }

      // Not the game move - maybe it's the engine's first choice, which
      // deserves the point just as much.
      setJudging(true);
      void (async () => {
        let label = `Master played ${pos.master_san}.`;
        let hit = false;
        try {
          const res = await api.playMove(pos.fen, 8);
          if (res.move === played) {
            hit = true;
            label = `You played ${move.san} — Stockfish's top choice (the master chose ${pos.master_san}).`;
          } else if (res.move && res.move !== pos.master_uci) {
            const probe = new Chess(pos.fen);
            const em = probe.move({
              from: res.move.slice(0, 2),
              to: res.move.slice(2, 4),
              promotion: res.move.slice(4) || "q",
            });
            label = `Master played ${pos.master_san} · engine prefers ${em?.san ?? res.move}.`;
          }
        } catch {
          /* engine unavailable - master comparison already shown */
        }
        setJudging(false);
        settle({ hit, label, seconds });
      })();
      return true;
    },
    [phase, pos, judging, settle, stopTimer]
  );

  const { onSquareClick, squareStyles } = useClickToMove(
    fen,
    onMove,
    phase === "answer" && !judging
  );

  async function startSession() {
    setError(null);
    try {
      await api.intuitionStart();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start this session");
      return;
    }
    setResults([]);
    setRound(1);
    void loadRound();
  }

  function next() {
    if (round >= ROUNDS) {
      setPhase("done");
      return;
    }
    setRound((r) => r + 1);
    void loadRound();
  }

  const hits = results.filter((r) => r.hit).length;
  const avgTime =
    results.length > 0
      ? results.reduce((s, r) => s + r.seconds, 0) / results.length
      : 0;
  const toMove = game.current.turn() === "w" ? "White" : "Black";

  return (
    <div className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/train" className="btn">← Training</Link>
        <h1 className="font-display text-xl">Intuition</h1>
        {phase !== "idle" && phase !== "done" && (
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-muted">Round {round}/{ROUNDS}</span>
            <span>
              <span className="text-muted">Hits </span>
              <span className="text-accent font-bold font-mono">{hits}</span>
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
          <p className="text-2xl font-display">Guess the master&apos;s move</p>
          <p className="text-muted">
            Ten positions from real master games. {SECONDS} seconds each — no
            time to calculate, only to feel. You score by matching the move the
            master played, or Stockfish&apos;s top choice.
          </p>
          <button className="btn-primary" onClick={startSession} autoFocus>
            Start session
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="card p-8 text-center space-y-3 max-w-xl mx-auto">
          <p className="text-2xl font-display">
            {hits >= 7 ? "Sharp instincts! 🎯" : hits >= 4 ? "Solid feel for the game" : "Keep training that gut"}
          </p>
          <p className="text-lg">
            <span className="font-mono font-bold text-accent">{hits}</span>
            <span className="text-muted"> / {ROUNDS} matched</span>
          </p>
          <p className="text-sm text-muted">
            Average decision time {avgTime.toFixed(1)}s
          </p>
          <button className="btn-primary" onClick={startSession}>
            Train again
          </button>
        </div>
      )}

      {(phase === "answer" || phase === "feedback" || phase === "loading") && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="board-frame w-[min(92vw,480px)] shrink-0">
            <Chessboard
              position={fen}
              onPieceDrop={onMove}
              onSquareClick={onSquareClick}
              boardOrientation={orientation}
              arePiecesDraggable={phase === "answer" && !judging}
              {...skin.props}
              animationDuration={skin.animationMs}
              customSquareStyles={squareStyles}
            />
          </div>

          <aside className="flex-1 space-y-3 min-w-[260px]">
            {pos && (
              <div className="card p-4">
                <p className="text-xs text-muted">
                  {pos.white} ({pos.white_elo ?? "?"}) vs {pos.black} ({pos.black_elo ?? "?"})
                  · move {Math.floor(pos.ply / 2) + 1}
                </p>
                <p className="text-lg font-semibold mt-1">
                  What would {toMove.toLowerCase()} play here?
                </p>
              </div>
            )}

            {phase === "answer" && (
              <div className="card p-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted">Trust your gut</span>
                  <span className={`font-mono font-bold ${timeLeft <= 5 ? "text-bad" : ""}`}>
                    {timeLeft.toFixed(1)}s
                  </span>
                </div>
                <div className="h-2 bg-black/30 rounded-md overflow-hidden">
                  <div
                    className={`h-full ${timeLeft <= 5 ? "bg-bad" : "bg-accent"}`}
                    style={{ width: `${(100 * timeLeft) / SECONDS}%`, transition: "width 0.1s linear" }}
                  />
                </div>
                {judging && (
                  <p className="text-xs text-muted mt-2 animate-pulse">Checking with the engine…</p>
                )}
              </div>
            )}

            {phase === "feedback" && feedback && (
              <div className={`rounded-2xl p-4 ${feedback.hit ? "bg-accent/20 ring-1 ring-accent/30" : "card"}`}>
                <p className="text-lg font-semibold">
                  {feedback.hit ? "✓ Hit!" : "✗ Miss"}
                </p>
                <p className="text-sm mt-1">{feedback.label}</p>
                <button className="btn-primary w-full mt-3" onClick={next} autoFocus>
                  {round >= ROUNDS ? "See results" : "Next position →"}
                </button>
              </div>
            )}

            {phase === "loading" && (
              <p className="text-sm text-muted animate-pulse">Finding a position…</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
