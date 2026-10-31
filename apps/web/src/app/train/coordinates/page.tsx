"use client";

/**
 * Coordinates drill: a square is named, you click it, as many as you can in
 * 30 seconds. The board's own coordinates are hidden for the round - reading
 * them off the edge is the habit this replaces. Best scores are kept per side
 * in this browser; nothing here needs the server or an engine.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { DrillSide, ROUND_SECONDS, nextTarget, readBest, saveBest } from "@/lib/coordinates";

type Phase = "idle" | "running" | "done";

const FLASH_MS = 220;

export default function CoordinatesDrillPage() {
  const skin = useBoardTheme();
  const deadline = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the round was played as, and its running score: read when the clock
  // runs out, by which time the controls may already show something else.
  const round = useRef<{ side: DrillSide; score: number; running: boolean }>({
    side: "white",
    score: 0,
    running: false,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [side, setSide] = useState<DrillSide>("white");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [showPieces, setShowPieces] = useState(false);
  const [target, setTarget] = useState<string>("e4");
  const [upNext, setUpNext] = useState<string>("d5");
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [left, setLeft] = useState(ROUND_SECONDS);
  const [best, setBest] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [playedAs, setPlayedAs] = useState<DrillSide>("white");
  const [flash, setFlash] = useState<{ square: string; ok: boolean } | null>(null);

  useEffect(() => setBest(readBest(side)), [side]);
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
      const { side: played, score: final } = round.current;
      const previous = readBest(played);
      setBest(saveBest(played, final));
      setNewBest(final > previous);
      setPhase("done");
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  const start = useCallback(() => {
    const first = nextTarget(null);
    round.current = { side, score: 0, running: true };
    setPlayedAs(side);
    setOrientation(side === "random" ? (Math.random() < 0.5 ? "white" : "black") : side);
    setTarget(first);
    setUpNext(nextTarget(first));
    setScore(0);
    setMisses(0);
    setFlash(null);
    setNewBest(false);
    setLeft(ROUND_SECONDS);
    deadline.current = Date.now() + ROUND_SECONDS * 1000;
    setPhase("running");
  }, [side]);

  const onSquareClick = useCallback(
    (square: string) => {
      if (phase !== "running") return;
      const ok = square === target;
      if (ok) {
        round.current.score += 1;
        setScore(round.current.score);
        setTarget(upNext);
        setUpNext(nextTarget(upNext));
      } else {
        setMisses((m) => m + 1);
      }
      setFlash({ square, ok });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    },
    [phase, target, upNext]
  );

  const squareStyles = flash
    ? { [flash.square]: { backgroundColor: flash.ok ? "rgba(112, 197, 134, 0.75)" : "rgba(230, 98, 80, 0.75)" } }
    : {};

  const sideLabel: Record<DrillSide, string> = { white: "White", black: "Black", random: "Random" };

  return (
    <div className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="glass relative z-30 mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <Link href="/train" className="btn">← Training</Link>
        <h1 className="font-display text-xl">Coordinates</h1>
        {phase === "running" && (
          <span className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-muted">Score {score}</span>
            <span className={`font-mono text-lg font-bold tabular-nums ${left <= 5 ? "text-bad" : ""}`}>
              0:{String(Math.ceil(left)).padStart(2, "0")}
            </span>
          </span>
        )}
      </header>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="relative board-frame w-[min(92vw,480px)] shrink-0">
          <Chessboard
            position={showPieces ? "start" : {}}
            onSquareClick={onSquareClick}
            boardOrientation={orientation}
            arePiecesDraggable={false}
            {...skin.props}
            showBoardNotation={phase !== "running"}
            animationDuration={0}
            customSquareStyles={squareStyles}
          />
          {phase === "running" && (
            // Big enough to read without looking away from the board; clicks
            // pass through to the squares underneath.
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="font-display text-[clamp(64px,16vw,120px)] leading-none text-ink/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                {target}
              </span>
            </div>
          )}
        </div>

        <aside className="flex-1 space-y-3 min-w-[260px]">
          {phase === "running" ? (
            <div className="card p-4 space-y-1">
              <p className="text-lg font-semibold">Click {target}</p>
              <p className="text-xs text-muted">
                Next: <span className="font-mono">{upNext}</span> · {misses} missed
              </p>
            </div>
          ) : (
            <div className="card p-5 space-y-4">
              {phase === "done" ? (
                <div className="space-y-1">
                  <p className="text-2xl font-display">
                    {score} {score === 1 ? "square" : "squares"} in {ROUND_SECONDS}s
                  </p>
                  <p className="text-sm text-muted">
                    {misses} missed · as {sideLabel[playedAs]}
                    {newBest && <span className="ml-2 text-accent">New best!</span>}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-2xl font-display">Find the square.</p>
                  <p className="text-sm text-muted">
                    A square is named; click it. As many as you can in {ROUND_SECONDS} seconds, with
                    the board&apos;s coordinates hidden.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  Play from · best {best}
                </p>
                <div className="seg w-full">
                  {(["white", "black", "random"] as const).map((s) => (
                    <button
                      key={s}
                      className={`seg-item flex-1 ${side === s ? "seg-item-on" : ""}`}
                      aria-pressed={side === s}
                      onClick={() => {
                        setSide(s);
                        if (s !== "random") setOrientation(s);
                      }}
                    >
                      {sideLabel[s]}
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={showPieces}
                    onChange={(e) => setShowPieces(e.target.checked)}
                  />
                  Show the starting position
                </label>
              </div>

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
