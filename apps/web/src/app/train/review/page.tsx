"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { api, GameDetail } from "@/lib/api";
import { CLASS_META } from "@/lib/classification";
import { reviewChallenges } from "@/lib/reviewChallenges";
import { useClickToMove } from "@/hooks/useClickToMove";

interface Guess {
  san: string;
  uci: string;
  fen: string;
}

function ReviewTrainer() {
  const gameId = Number(useSearchParams().get("game"));
  const skin = useBoardTheme();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    if (!Number.isSafeInteger(gameId) || gameId < 1) {
      setError("Choose a reviewed game to practise.");
      return;
    }
    let alive = true;
    setGame(null);
    setError(null);
    setIndex(0);
    setGuess(null);
    setHits(0);
    api.getGame(gameId)
      .then((result) => { if (alive) setGame(result); })
      .catch(() => { if (alive) setError("Could not load this game."); });
    return () => { alive = false; };
  }, [gameId]);

  const challenges = useMemo(() => game ? reviewChallenges(game) : [], [game]);
  const challenge = challenges[index];
  const finished = !!game && challenges.length > 0 && index >= challenges.length;
  const position = guess?.fen ?? challenge?.fen ?? new Chess().fen();

  const onMove = useCallback((from: string, to: string): boolean => {
    if (!challenge || guess) return false;
    try {
      const board = new Chess(challenge.fen);
      const move = board.move({ from, to, promotion: "q" });
      if (!move) return false;
      const uci = move.from + move.to + (move.promotion ?? "");
      setGuess({ san: move.san, uci, fen: board.fen() });
      if (uci === challenge.bestUci) setHits((count) => count + 1);
      return true;
    } catch {
      return false;
    }
  }, [challenge, guess]);

  const { onSquareClick, squareStyles } = useClickToMove(
    position, onMove, !!challenge && !guess
  );

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Link href={game ? `/app?game=${game.id}` : "/app"} className="btn">← Board</Link>
        <h1 className="font-display text-2xl">Test yourself</h1>
        {game && <span className="ml-auto text-sm text-muted">{game.white} vs {game.black}</span>}
      </header>

      {error && <p role="alert" className="card p-4 text-bad">{error}</p>}
      {!error && !game && <p className="text-muted">Loading game…</p>}
      {game && challenges.length === 0 && (
        <div className="card max-w-xl p-6">
          <p className="font-display text-xl">No practice positions yet</p>
          <p className="mt-2 text-sm text-muted">
            This game needs an aligned engine review with at least one inaccuracy,
            mistake, or blunder. Run or re-run its review on the board.
          </p>
          <Link href={`/app?game=${game.id}`} className="btn-primary mt-4 inline-block">Open game</Link>
        </div>
      )}
      {finished && (
        <div className="card max-w-xl p-6">
          <p className="font-display text-2xl">Review complete</p>
          <p className="mt-2 text-sm">You found the engine&apos;s move in {hits} of {challenges.length} positions.</p>
          <button className="btn-primary mt-4" onClick={() => { setIndex(0); setGuess(null); setHits(0); }}>
            Practise again
          </button>
        </div>
      )}
      {challenge && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="board-frame w-[min(92vw,480px)] shrink-0">
            <Chessboard
              position={position}
              boardOrientation={challenge.fen.split(" ")[1] === "b" ? "black" : "white"}
              onPieceDrop={onMove}
              onSquareClick={onSquareClick}
              arePiecesDraggable={!guess}
              {...skin.props}
              animationDuration={skin.animationMs}
              customSquareStyles={squareStyles}
            />
          </div>
          <section className="min-w-[260px] flex-1 space-y-4" aria-live="polite">
            <div className="card p-4">
              <p className="eyebrow">Position {index + 1} of {challenges.length}</p>
              <p className="mt-2 text-lg">Move {Math.floor(challenge.ply / 2) + 1}: what would you play?</p>
              <p className="mt-1 text-sm text-muted">Play a move on the board to reveal the review.</p>
            </div>
            {guess && (
              <div className="card space-y-3 p-4">
                <p className={guess.uci === challenge.bestUci ? "text-accent" : "text-warn"}>
                  {guess.uci === challenge.bestUci ? `Correct: ${guess.san}` : `You played ${guess.san}`}
                </p>
                <p className="text-sm">Engine choice: <span className="san text-accent">{challenge.bestSan}</span></p>
                <p className="text-sm">In the game: <span className="san">{challenge.playedSan}</span>{" "}
                  <span className={CLASS_META[challenge.classification].color}>
                    ({CLASS_META[challenge.classification].label.toLowerCase()})
                  </span>
                </p>
                {challenge.explanation && <p className="text-sm text-muted">{challenge.explanation}</p>}
                <button className="btn-primary" onClick={() => { setIndex((i) => i + 1); setGuess(null); }} autoFocus>
                  {index + 1 === challenges.length ? "See result" : "Next position →"}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default function ReviewPage() {
  return <Suspense fallback={<p className="p-6 text-muted">Loading…</p>}><ReviewTrainer /></Suspense>;
}
