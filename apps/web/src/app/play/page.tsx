"use client";

/**
 * Play a full game against Stockfish. Pick a colour and a strength level (1-8),
 * then move by drag or click; the server replies with the engine's move at the
 * chosen Skill Level. chess.js enforces legality and detects game end.
 *
 * The page is laid out like the analysis workspace: the board owns the viewport
 * top to bottom, with a player on each side of it, and everything you can do to
 * the game lives in one panel beside it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { BOARD_FRAME, useBoardTheme } from "@/lib/boardTheme";
import { useSquareSize } from "@/hooks/useSquareSize";
import { api } from "@/lib/api";
import { useClickToMove } from "@/hooks/useClickToMove";
import PlayerPlate, { scoreOf } from "@/components/PlayerPlate";

type Status = "setup" | "playing" | "over";
type Color = "white" | "black";

/**
 * What each level actually feels like across the board. The numbers are
 * Stockfish Skill Levels behind the scenes, which mean nothing to a player, so
 * every level says what kind of opponent you are about to get instead.
 */
const LEVEL_META: Record<number, { name: string; blurb: string }> = {
  1: { name: "Beginner", blurb: "Leaves pieces hanging and misses simple threats." },
  2: { name: "Beginner", blurb: "Looks one move ahead, and not always." },
  3: { name: "Casual", blurb: "Takes free material, misses most tactics." },
  4: { name: "Casual", blurb: "Steady club-beginner opposition." },
  5: { name: "Intermediate", blurb: "Finds short tactics and punishes loose pieces." },
  6: { name: "Intermediate", blurb: "Plays a real game; slips are rare." },
  7: { name: "Strong", blurb: "Very few gifts — you have to earn every one." },
  8: { name: "Full strength", blurb: "Stockfish unrestrained. Good luck." },
};

/** Both rails of the wooden surround the board is seated in. */
const FRAME = 2 * BOARD_FRAME;

/**
 * Same reserve as the analysis board: two 32px plates plus their 6px gaps,
 * plus the frame's own two rails.
 */
const PLATE_STACK = 2 * 32 + 2 * 6 + FRAME;

/** Amber, so a hint arrow stays legible on both shades of every wood. */
const HINT_COLOR = "#FFD54F";
const HINT_FROM = { background: "rgba(255, 213, 79, 0.5)" };
const HINT_TO = { background: "rgba(255, 213, 79, 0.62)" };

function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || "q" };
}

function other(c: Color): Color {
  return c === "white" ? "black" : "white";
}

export default function PlayPage() {
  const skin = useBoardTheme();
  const router = useRouter();
  const game = useRef(new Chess());
  // The async truth for the game in progress: an engine reply landing after a
  // re-render must judge the position by the seat and level it was started
  // with, not by whatever the setup form is showing now.
  const colorRef = useRef<Color>("white");
  const levelRef = useRef(4);

  const [fen, setFen] = useState(game.current.fen());
  const [moves, setMoves] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("setup");
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<{ text: string; pgn: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The seat and level of the game being played, for everything on screen.
  const [userColor, setUserColor] = useState<Color>("white");
  const [gameLevel, setGameLevel] = useState(4);
  const [flipped, setFlipped] = useState(false);

  /**
   * A hint arrives in two presses: the first names the piece to move, the
   * second shows where it goes. Being told which piece is usually enough to
   * find the move yourself, which is the part worth keeping.
   */
  const [hint, setHint] = useState<{ from: string; to: string; san: string } | null>(null);
  const [hintStage, setHintStage] = useState<0 | 1 | 2>(0);
  const [hinting, setHinting] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);

  // Setup form
  const [color, setColor] = useState<Color | "random">("white");
  const [level, setLevel] = useState(4);

  const [stageRef, boardSize] = useSquareSize(FRAME, PLATE_STACK);
  const moveListRef = useRef<HTMLDivElement>(null);

  /**
   * Where the game starts. `?fen=` arrives from the analysis board's "Play
   * from here", which is how a position you are studying gets played out
   * against an opponent rather than only analysed. Read once from the URL
   * rather than through useSearchParams, which would need a Suspense boundary
   * around the whole page in an exported build.
   */
  const [startFen, setStartFen] = useState<string | undefined>();

  useEffect(() => {
    api.me().catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    const fen = new URLSearchParams(window.location.search).get("fen");
    if (!fen) return;
    try {
      game.current = new Chess(fen);
    } catch {
      setError("That position cannot be played from — starting from the beginning instead.");
      return;
    }
    setStartFen(fen);
    // You take the side whose move it is: that is the side you were studying.
    setColor(game.current.turn() === "w" ? "white" : "black");
    setFen(game.current.fen());
    setMoves([]);
  }, []);

  // A hint belongs to one position - drop it as soon as the board changes.
  useEffect(() => {
    setHint(null);
    setHintStage(0);
  }, [fen]);

  // Keep the newest move in view; a long game otherwise scrolls out of sight.
  useEffect(() => {
    const el = moveListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  const sync = useCallback(() => {
    setFen(game.current.fen());
    setMoves(game.current.history());
  }, []);

  const finishIfOver = useCallback((): boolean => {
    const g = game.current;
    if (!g.isGameOver()) return false;
    const mine = colorRef.current;
    let text: string;
    let pgn: string;
    if (g.isCheckmate()) {
      // Whoever is to move has been mated.
      const userIsLoser = g.turn() === (mine === "white" ? "w" : "b");
      text = userIsLoser ? "Checkmate — Stockfish wins." : "Checkmate — you win! 🎉";
      const winner: Color = userIsLoser ? other(mine) : mine;
      pgn = winner === "white" ? "1-0" : "0-1";
    } else {
      pgn = "1/2-1/2";
      if (g.isStalemate()) text = "Draw — stalemate.";
      else if (g.isThreefoldRepetition()) text = "Draw — threefold repetition.";
      else if (g.isInsufficientMaterial()) text = "Draw — insufficient material.";
      else text = "Draw — fifty-move rule.";
    }
    setResult({ text, pgn });
    setStatus("over");
    setThinking(false);
    return true;
  }, []);

  const requestEngineMove = useCallback(async () => {
    setThinking(true);
    try {
      const res = await api.playMove(game.current.fen(), levelRef.current);
      if (!res.move || res.game_over) {
        if (!finishIfOver()) setThinking(false);
        return;
      }
      game.current.move(uciToMove(res.move));
      sync();
      if (!finishIfOver()) setThinking(false);
    } catch {
      setError("The engine could not respond. Check the connection and try again.");
      setThinking(false);
    }
  }, [finishIfOver, sync]);

  const onMove = useCallback(
    (from: string, to: string): boolean => {
      if (status !== "playing" || thinking) return false;
      const g = game.current;
      if (g.turn() !== (colorRef.current === "white" ? "w" : "b")) return false;
      let move;
      try {
        move = g.move({ from, to, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;
      sync();
      if (!finishIfOver()) void requestEngineMove();
      return true;
    },
    [status, thinking, sync, finishIfOver, requestEngineMove],
  );

  const isUserTurn = game.current.turn() === (userColor === "white" ? "w" : "b");
  const canMove = status === "playing" && !thinking && isUserTurn;
  const { onSquareClick, squareStyles } = useClickToMove(fen, onMove, canMove);

  /**
   * A hint is the engine's best move for the position on the board, asked at
   * full strength however weak the opponent is - a hint you cannot trust is
   * worse than none.
   */
  const revealHint = useCallback(async () => {
    if (!canMove || hinting) return;
    if (hint) {
      setHintStage(2); // already held: the second press gives up the square
      return;
    }
    const atFen = game.current.fen();
    setHinting(true);
    try {
      const res = await api.playMove(atFen, 8);
      // The board may have moved on while we waited; a hint for a position
      // that is no longer on screen points at the wrong squares.
      if (res.move && game.current.fen() === atFen) {
        const probe = new Chess(atFen);
        const mv = probe.move(uciToMove(res.move));
        setHint({
          from: res.move.slice(0, 2),
          to: res.move.slice(2, 4),
          san: mv?.san ?? res.move,
        });
        setHintStage(1);
        setHintsUsed((n) => n + 1);
      }
    } catch {
      setError("Could not get a hint right now.");
    } finally {
      setHinting(false);
    }
  }, [canMove, hinting, hint]);

  const flip = useCallback(() => setFlipped((f) => !f), []);

  // Keyboard, matching the analysis board: f flips, h asks for the hint.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "f") flip();
      if (e.key === "h") void revealHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, revealHint]);

  // Which side sits at the bottom: the colour you chose, or - while the form is
  // still open - the colour you are about to choose, so the board previews it.
  const seatColor: Color =
    status === "setup" ? (color === "random" ? "white" : color) : userColor;
  const orientation: Color = flipped ? other(seatColor) : seatColor;
  const topSide = other(orientation);
  const sideToMove: Color = fen.split(" ")[1] === "b" ? "black" : "white";
  const shownLevel = status === "setup" ? level : gameLevel;

  const boardSquareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (hint && hintStage >= 1) styles[hint.from] = HINT_FROM;
    if (hint && hintStage === 2) styles[hint.to] = HINT_TO;
    return { ...styles, ...squareStyles };
  }, [hint, hintStage, squareStyles]);

  const boardArrows = useMemo(
    () =>
      hint && hintStage === 2
        ? ([[hint.from as Square, hint.to as Square, HINT_COLOR]] as [Square, Square, string][])
        : [],
    [hint, hintStage],
  );

  function startGame() {
    const c: Color = color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
    colorRef.current = c;
    levelRef.current = level;
    game.current = new Chess(startFen);
    setUserColor(c);
    setGameLevel(level);
    setFlipped(false);
    setResult(null);
    setError(null);
    setHintsUsed(0);
    setStatus("playing");
    sync();
    // The engine opens whenever it is its move - from the initial position
    // that means you took Black, from a set-up one it depends on the FEN.
    if (game.current.turn() !== (c === "white" ? "w" : "b")) void requestEngineMove();
  }

  function newGame() {
    game.current = new Chess(startFen);
    sync();
    setResult(null);
    setError(null);
    setThinking(false);
    setHintsUsed(0);
    setStatus("setup");
  }

  function resign() {
    setResult({
      text: "You resigned — Stockfish wins.",
      pgn: userColor === "white" ? "0-1" : "1-0",
    });
    setStatus("over");
    setThinking(false);
  }

  /** Name, rating and score for whichever colour sits on a given side. */
  const seatOf = (side: Color) =>
    side === seatColor
      ? { name: "You", elo: null }
      : { name: `Stockfish · Level ${shownLevel}`, elo: null };

  const hintLabel = hinting
    ? "Thinking…"
    : hintStage === 0
      ? "Hint"
      : hintStage === 1
        ? "Show the move"
        : `Hint: ${hint?.san}`;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* ---------- Top bar ---------- */}
      <header className="glass-bar z-40 flex h-14 shrink-0 items-center gap-3 px-3">
        <Link href="/app" className="btn">
          ← Board
        </Link>
        <h1 className="font-display text-lg">Play vs Stockfish</h1>

        <div className="ml-auto flex items-center gap-2">
          {status !== "setup" && (
            <>
              <span className="chip bg-ivory/10 text-muted">
                {userColor} · level {gameLevel}
              </span>
              {hintsUsed > 0 && (
                <span className="chip bg-gold/15 text-gold" title="Hints used this game">
                  {hintsUsed} hint{hintsUsed === 1 ? "" : "s"}
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {error && (
        <button
          className="glass mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-xl border-bad/30 bg-bad/10 px-4 py-2 text-left text-sm"
          onClick={() => setError(null)}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" />
          {error} <span className="ml-auto text-xs text-muted">dismiss</span>
        </button>
      )}

      {/* ---------- Workspace ---------- */}
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* Board stage: fills the workspace, top to bottom. Its height is
            stated rather than taken from the content, so measuring the box the
            board sits in never feeds the board's own size back into itself. */}
        <div
          className="h-[calc(100vw_+_76px)] w-full px-3 lg:h-full lg:min-h-0
                     lg:w-auto lg:min-w-0 lg:flex-1 lg:px-3"
        >
          <div
            ref={stageRef}
            className="relative flex h-full w-full items-center justify-center"
          >
            <div
              className="flex flex-col gap-1.5"
              style={{ width: boardSize ? boardSize + FRAME : undefined }}
            >
              <PlayerPlate
                name={seatOf(topSide).name}
                elo={seatOf(topSide).elo}
                side={topSide}
                score={scoreOf(result?.pgn, topSide)}
                toMove={status === "playing" && sideToMove === topSide}
              />

              {/* The frame takes its size from the board it wraps, so the board
                  keeps the exact square it was measured into. */}
              <div className="board-frame">
                <div
                  className="relative"
                  style={{ width: boardSize || undefined, height: boardSize || undefined }}
                >
                  {boardSize > 0 && (
                    <Chessboard
                      position={fen}
                      boardWidth={boardSize}
                      onPieceDrop={onMove}
                      onSquareClick={onSquareClick}
                      boardOrientation={orientation}
                      arePiecesDraggable={canMove}
                      customArrows={boardArrows}
                      customArrowColor={HINT_COLOR}
                      animationDuration={skin.animationMs}
                      {...skin.props}
                      customSquareStyles={boardSquareStyles}
                    />
                  )}
                </div>
              </div>

              <PlayerPlate
                name={seatOf(orientation).name}
                elo={seatOf(orientation).elo}
                side={orientation}
                score={scoreOf(result?.pgn, orientation)}
                toMove={status === "playing" && sideToMove === orientation}
              />
            </div>
          </div>
        </div>

        {/* ---------- Game panel ---------- */}
        <aside
          className="glass mt-3 flex w-full shrink-0 flex-col rounded-t-3xl lg:my-2 lg:mr-2 lg:mt-2
                     lg:h-[calc(100%-1rem)] lg:w-[352px] lg:rounded-2xl xl:w-[400px]"
        >
          <div className="shrink-0 border-b border-ivory/[0.06] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="eyebrow">{status === "setup" ? "New game" : "Your game"}</span>
              {status !== "setup" && (
                <span className="ml-auto font-mono text-[11px] text-muted">
                  move {fen.split(" ")[5]}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm font-medium">
              {status === "setup"
                ? "Choose a side and how hard it should be"
                : `You play ${userColor} · ${LEVEL_META[gameLevel].name}`}
            </p>
          </div>

          {/* Scrolling body */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {status === "setup" && (
              <>
                <div>
                  <p className="eyebrow mb-2">Play as</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: "white", glyph: "♔", label: "White" },
                        { id: "black", glyph: "♚", label: "Black" },
                        { id: "random", glyph: "⇄", label: "Random" },
                      ] as const
                    ).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setColor(c.id)}
                        aria-pressed={color === c.id}
                        className={`rounded-2xl border px-2 py-3 transition-colors ${
                          color === c.id
                            ? "border-brass/50 bg-brass/15 text-brassLit"
                            : "border-ivory/[0.07] bg-ivory/[0.04] text-muted hover:bg-ivory/[0.08] hover:text-ink"
                        }`}
                      >
                        <span className="block text-2xl leading-none">{c.glyph}</span>
                        <span className="mt-1.5 block text-xs font-medium">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card-tight p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="eyebrow">Strength</span>
                    <span className="ml-auto font-mono text-sm font-semibold text-brassLit">
                      {level}
                    </span>
                    <span className="text-xs text-muted">{LEVEL_META[level].name}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value))}
                    aria-label="Engine strength"
                    className="mt-2 w-full accent-accent"
                  />
                  <div className="flex justify-between px-0.5 font-mono text-[10px] text-muted">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <span key={n}>{n}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink/70">
                    {LEVEL_META[level].blurb}
                  </p>
                </div>

                <div className="card-tight p-3">
                  <p className="text-xs leading-relaxed text-muted">
                    <span className="text-gold">Stuck mid-game?</span> The Hint
                    button — or <kbd className="rounded-md bg-ivory/10 px-1">H</kbd> —
                    names the piece to move. Press it again to see the whole move.
                    Hints always come from a full-strength engine, whatever level
                    you are playing.
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    <kbd className="rounded-md bg-ivory/10 px-1">F</kbd> flips the board.
                  </p>
                </div>
              </>
            )}

            {status !== "setup" && (
              <>
                <div className="card-tight p-3">
                  {status === "over" ? (
                    <p className="text-base font-semibold">{result?.text}</p>
                  ) : thinking ? (
                    <p className="flex items-center gap-2 text-base font-semibold">
                      <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
                      Stockfish is thinking…
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-base font-semibold">
                      <span
                        className={`h-4 w-4 rounded-full border border-ivory/40 ${
                          userColor === "white" ? "bg-ivory" : "bg-ebony"
                        }`}
                      />
                      Your move
                    </p>
                  )}
                  {status === "over" && hintsUsed > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      {hintsUsed} hint{hintsUsed === 1 ? "" : "s"} used.
                    </p>
                  )}
                </div>

                {hint && (
                  <div className="animate-rise rounded-2xl border border-gold/30 bg-gold/10 px-3 py-2.5">
                    <p className="text-sm">
                      {hintStage === 1 ? (
                        <>
                          Move the piece on{" "}
                          <span className="font-mono font-semibold text-gold">
                            {hint.from}
                          </span>
                          .
                        </>
                      ) : (
                        <>
                          Stockfish plays{" "}
                          <span className="font-mono font-semibold text-gold">
                            {hint.san}
                          </span>
                          .
                        </>
                      )}
                    </p>
                    {hintStage === 1 && (
                      <p className="mt-1 text-xs text-muted">
                        Try to find the move yourself, or ask again for the square.
                      </p>
                    )}
                  </div>
                )}

                <div className="min-h-0">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="eyebrow">Moves</span>
                    <span className="ml-auto font-mono text-[11px] text-muted">
                      {moves.length}
                    </span>
                  </div>
                  <div
                    ref={moveListRef}
                    className="max-h-[40vh] overflow-y-auto rounded-2xl bg-ivory/[0.04] p-2 ring-1 ring-ivory/[0.07] lg:max-h-none"
                  >
                    {moves.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted">
                        No moves yet — play one on the board.
                      </p>
                    ) : (
                      <div className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-0.5 font-mono text-sm">
                        {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => (
                          <div key={i} className="contents">
                            <span className="text-right text-muted">{i + 1}.</span>
                            <span className="rounded-md px-1">{moves[i * 2]}</span>
                            <span className="rounded-md px-1">{moves[i * 2 + 1] ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Actions: pinned to the panel on a desktop, stuck to the bottom of
              the viewport while scrolling on a phone. */}
          <div className="glass-bar sticky bottom-0 shrink-0 space-y-2 p-2.5 lg:static lg:rounded-b-2xl lg:bg-transparent lg:shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] lg:backdrop-blur-none">
            {status === "setup" ? (
              <button className="btn-primary w-full" onClick={startGame}>
                Start game
              </button>
            ) : (
              <>
                {status === "playing" && (
                  <button
                    className="btn-go w-full text-sm"
                    onClick={revealHint}
                    disabled={!canMove || hinting || hintStage === 2}
                    title="Hint (h)"
                  >
                    {hintLabel}
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {status === "playing" && (
                    <button className="btn flex-1" onClick={resign}>
                      Resign
                    </button>
                  )}
                  <button className="btn-primary flex-1" onClick={newGame}>
                    New game
                  </button>
                  <button
                    onClick={flip}
                    title="Flip board (f)"
                    aria-label="Flip board"
                    className="rounded-xl border border-ivory/10 bg-ivory/[0.05] px-3 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-ivory/10 hover:text-ink"
                  >
                    ⟳
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
