"use client";

/**
 * Knight routes drill: a knight, a target, and exactly as many moves as the
 * shortest route takes. Hop the knight there by clicking squares; run out of
 * moves and the route is lost. As many routes as you can in a minute. Best
 * score is kept in this browser; nothing here needs the server or an engine.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { readScore, saveScore } from "@/lib/coordinates";
import {
  KNIGHT_BEST_KEY, KNIGHT_ROUND_SECONDS, KnightRoute, knightMoves, nextRoute,
} from "@/lib/knightRoutes";

type Phase = "idle" | "running" | "done";

const FLASH_MS = 220;
const TARGET = "rgba(201, 162, 39, 0.65)";
const TRAIL = "rgba(112, 197, 134, 0.35)";

export default function KnightRoutesPage() {
  const skin = useBoardTheme();
  const deadline = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read when the clock runs out, outside React's render cycle.
  const round = useRef({ score: 0, running: false });

  const [phase, setPhase] = useState<Phase>("idle");
  const [route, setRoute] = useState<KnightRoute>({ from: "g1", to: "e5", moves: 3 });
  const [at, setAt] = useState("g1");
  const [trail, setTrail] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [lost, setLost] = useState(0);
  const [left, setLeft] = useState(KNIGHT_ROUND_SECONDS);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [flash, setFlash] = useState<{ square: string; ok: boolean } | null>(null);

  useEffect(() => setBest(readScore(KNIGHT_BEST_KEY)), []);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // One interval per round, reading a deadline so a slow tab cannot stretch it.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, (deadline.current - Date.now()) / 1000);
      setLeft(remaining);
      if (remaining > 0 || !round.current.running) return;
      round.current.running = false;
      const previous = readScore(KNIGHT_BEST_KEY);
      setBest(saveScore(KNIGHT_BEST_KEY, round.current.score));
      setNewBest(round.current.score > previous);
      setPhase("done");
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const deal = useCallback(() => {
    const r = nextRoute();
    setRoute(r);
    setAt(r.from);
    setTrail([]);
  }, []);

  const start = useCallback(() => {
    round.current = { score: 0, running: true };
    deal();
    setScore(0);
    setLost(0);
    setFlash(null);
    setNewBest(false);
    setLeft(KNIGHT_ROUND_SECONDS);
    deadline.current = Date.now() + KNIGHT_ROUND_SECONDS * 1000;
    setPhase("running");
  }, [deal]);

  const showFlash = (square: string, ok: boolean) => {
    setFlash({ square, ok });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };

  const hop = useCallback(
    (square: string) => {
      if (phase !== "running") return;
      if (!knightMoves(at).includes(square)) {
        showFlash(square, false); // not a knight move: costs nothing, counts nothing
        return;
      }
      const hops = trail.length + 1;
      if (square === route.to) {
        round.current.score += 1;
        setScore(round.current.score);
        showFlash(square, true);
        deal();
      } else if (hops >= route.moves) {
        setLost((n) => n + 1);
        showFlash(square, false);
        deal();
      } else {
        setTrail([...trail, at]);
        setAt(square);
      }
    },
    [phase, at, trail, route, deal]
  );

  const squareStyles: Record<string, CSSProperties> = {
    ...Object.fromEntries(trail.map((s) => [s, { backgroundColor: TRAIL }])),
    [route.to]: { backgroundColor: TARGET },
    ...(flash && {
      [flash.square]: {
        backgroundColor: flash.ok ? "rgba(112, 197, 134, 0.75)" : "rgba(230, 98, 80, 0.75)",
      },
    }),
  };
  const movesLeft = route.moves - trail.length;

  return (
    <div className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/train" className="btn">← Training</Link>
        <h1 className="font-display text-xl">Knight routes</h1>
        {phase === "running" && (
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-muted">Score {score}</span>
            <span className={`font-mono text-lg font-bold tabular-nums ${left <= 10 ? "text-bad" : ""}`}>
              {Math.floor(Math.ceil(left) / 60)}:{String(Math.ceil(left) % 60).padStart(2, "0")}
            </span>
          </span>
        )}
      </header>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="board-frame w-[min(92vw,480px)] shrink-0">
          <Chessboard
            position={phase === "running" ? { [at]: "wN" } : { g1: "wN" }}
            onSquareClick={hop}
            onPieceDrop={(_from, to) => {
              hop(to);
              return false; // the board follows `at`, not the drag
            }}
            boardOrientation="white"
            arePiecesDraggable={phase === "running"}
            {...skin.props}
            animationDuration={120}
            customSquareStyles={phase === "running" ? squareStyles : {}}
          />
        </div>

        <aside className="flex-1 space-y-3 min-w-[260px]">
          {phase === "running" ? (
            <div className="card p-4 space-y-1">
              <p className="text-lg font-semibold">
                Knight to {route.to} in {route.moves}
              </p>
              <p className="text-xs text-muted">
                {movesLeft} move{movesLeft === 1 ? "" : "s"} left · {lost} lost
              </p>
            </div>
          ) : (
            <div className="card p-5 space-y-4">
              {phase === "done" ? (
                <div className="space-y-1">
                  <p className="text-2xl font-display">
                    {score} {score === 1 ? "route" : "routes"} in {KNIGHT_ROUND_SECONDS}s
                  </p>
                  <p className="text-sm text-muted">
                    {lost} lost
                    {newBest && <span className="ml-2 text-accent">New best!</span>}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-display">Find the shortest route.</p>
                  <p className="text-sm text-muted">
                    Hop the knight to the gold square using exactly the fewest moves
                    possible. Use one too many and the route is lost. As many as you can
                    in {KNIGHT_ROUND_SECONDS} seconds.
                  </p>
                </div>
              )}
              <p className="text-[10px] uppercase tracking-wider text-muted">Best {best}</p>
              <button className="btn-primary w-full" onClick={start} autoFocus>
                {phase === "done" ? "Go again" : "Start"}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
