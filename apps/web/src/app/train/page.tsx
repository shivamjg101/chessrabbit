"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { Chess, Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import { useClickToMove } from "@/hooks/useClickToMove";
import RecallRule from "@/components/RecallRule";
import {
  api, ApiError, Opening, Repertoire, TrainingCard, TrainingResult,
} from "@/lib/api";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * The repertoire move, drawn on the board when you did not find it.
 *
 * Verdigris, because in this app verdigris means "right" — and unlike the
 * engine arrows on the analysis board, which are a suggestion, this arrow is
 * the answer.
 */
const ANSWER_ARROW = "#58B373";

type Feedback = (TrainingResult & { answered: string }) | null;

/** The position a UCI move leads to, or null if it was not a legal move. */
function positionAfter(fen: string, uci: string): string | null {
  try {
    const game = new Chess(fen);
    game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] ?? "q",
    });
    return game.fen();
  } catch {
    // An illegal answer is still an answer — the server grades it wrong. There
    // is no position to show for it, so the board stays on the question.
    return null;
  }
}

/**
 * The drill screen. Its single job is "what do you play here?", so the board
 * column carries the question, the Recall Rule underneath carries what the
 * answer costs or buys, and everything else is a rail that recedes.
 */
export default function TrainPage() {
  const skin = useBoardTheme();
  const router = useRouter();
  const [reps, setReps] = useState<Repertoire[]>([]);
  const [queue, setQueue] = useState<TrainingCard[]>([]);
  const [card, setCard] = useState<TrainingCard | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [session, setSession] = useState({ right: 0, wrong: 0 });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", color: "white" as "white" | "black", pgn: "" });
  const [error, setError] = useState<string | null>(null);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [showOpenings, setShowOpenings] = useState(false);
  const [addingOpening, setAddingOpening] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, due] = await Promise.all([api.listRepertoires(), api.dueCards(20)]);
      setReps(r);
      setQueue(due);
      setCard(due[0] ?? null);
    } catch {
      router.push("/login");
    }
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDrop = useCallback(
    (from: string, to: string) => {
      if (!card || feedback) return false;
      const uci = `${from}${to}`;
      api
        .answerCard(card.id, uci)
        .then((res) => {
          setFeedback({ ...res, answered: uci });
          setSession((s) =>
            res.correct
              ? { ...s, right: s.right + 1 }
              : { ...s, wrong: s.wrong + 1 }
          );
        })
        .catch(() => setError("The answer did not reach the server. Play the move again."));
      // Accept the move locally; the board is re-rendered from the answered
      // position once the verdict lands, and the panel says what it was.
      return true;
    },
    [card, feedback]
  );

  const { onSquareClick, squareStyles } = useClickToMove(
    card?.fen ?? START_FEN, onDrop, !!card && !feedback
  );

  /**
   * What the board shows once the answer is in: the position your move led to.
   *
   * Before this, the board stayed on the question. Dragging a piece happened to
   * leave it on its new square because react-chessboard does not snap a dragged
   * piece back on its own — but answering by CLICKING left the board completely
   * untouched, so you were told "the repertoire plays Bc4" while looking at a
   * position where nothing had been played at all. The move you make is the
   * whole answer; the board has to show it however you made it.
   */
  const answeredFen = useMemo(
    () => (card && feedback ? positionAfter(card.fen, feedback.answered) : null),
    [card, feedback]
  );

  /** Your move's squares, tinted the same way a last move is anywhere else. */
  const answeredSquares = useMemo(() => {
    if (!feedback) return squareStyles;
    return {
      [feedback.answered.slice(0, 2)]: skin.lastMoveFrom,
      [feedback.answered.slice(2, 4)]: skin.lastMoveTo,
    };
  }, [feedback, squareStyles, skin.lastMoveFrom, skin.lastMoveTo]);

  /**
   * The move you should have played, drawn only when you did not play it.
   * Naming it in the sentence below is not the same as being shown it on the
   * board — the point of a repertoire drill is the square, not the word.
   */
  const answerArrow = useMemo(() => {
    if (!feedback || feedback.correct) return [];
    const uci = feedback.expected_uci;
    return [
      [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square, ANSWER_ARROW] as [
        Square,
        Square,
        string,
      ],
    ];
  }, [feedback]);

  /**
   * Drop a repertoire from the list now, and put it back if the server says no.
   *
   * The old handler waited for the DELETE and then re-fetched the repertoire
   * list AND the due queue, so removing one line cost two round trips before
   * the row disappeared. The queue is left alone here: cards from a deleted
   * repertoire stop being served on the next refresh, and pulling the rug out
   * from under the card on screen would lose an answer in progress.
   */
  async function removeRepertoire(rep: Repertoire) {
    const before = reps;
    setReps((r) => r.filter((x) => x.id !== rep.id));
    setError(null);
    try {
      await api.deleteRepertoire(rep.id);
    } catch (err) {
      setReps(before);
      setError(
        (err instanceof ApiError ? err.message : "That repertoire could not be deleted") +
          ` — "${rep.name}" is still here.`
      );
    }
  }

  function next() {
    const rest = queue.slice(1);
    setQueue(rest);
    setCard(rest[0] ?? null);
    setFeedback(null);
    if (rest.length === 0) refresh();
  }

  async function createRep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createRepertoire(form.name, form.color, form.pgn);
      setCreating(false);
      setForm({ name: "", color: "white", pgn: "" });
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "That PGN could not be read. Check the move numbering and try again."
      );
    }
  }

  function toggleOpenings() {
    setShowOpenings((s) => !s);
    setCreating(false);
    if (openings.length === 0) {
      api
        .listOpenings()
        .then(setOpenings)
        .catch(() => setError("The opening list did not load. Reload the page to try again."));
    }
  }

  async function trainOpening(o: Opening) {
    setAddingOpening(o.id);
    setError(null);
    try {
      await api.trainOpening(o.id);
      setShowOpenings(false);
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `${o.name} could not be added. Try again.`
      );
    } finally {
      setAddingOpening(null);
    }
  }

  const dueTotal = reps.reduce((n, r) => n + r.due_count, 0);
  const answered = session.right + session.wrong;

  return (
    <div className="min-h-screen">
      {/* Chrome: one strip of glass, and the only number that matters pushed
          to the far end. */}
      <header className="glass-bar sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-2.5">
          <Wordmark />
          <nav className="seg text-sm">
            <Link href="/app" className="seg-item">Board</Link>
            <span className="seg-item seg-item-on">Train</span>
            <Link href="/prep" className="seg-item">Prep</Link>
            <Link href="/insights" className="seg-item">Insights</Link>
          </nav>
          <span className="ml-auto flex items-baseline gap-2">
            <span className="font-display text-2xl leading-none text-brassLit">
              {dueTotal}
            </span>
            <span className="eyebrow">due</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2"
          >
            <span className="mt-px font-mono text-xs text-bad">!</span>
            <p className="flex-1 text-sm text-ink">{error}</p>
            <button
              className="font-mono text-xs text-muted hover:text-ink"
              onClick={() => setError(null)}
            >
              dismiss
            </button>
          </div>
        )}

        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
          {/* ---- The question ---- */}
          <section className="flex-1">
            {card ? (
              <>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="font-display text-2xl leading-tight text-ink">
                    {card.repertoire_name}
                  </h1>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                    you are {card.color} · seen {card.reps}×
                  </span>
                </div>

                <div className="board-frame w-[min(92vw,460px)]">
                  <Chessboard
                    position={answeredFen ?? card.fen}
                    onPieceDrop={onDrop}
                    onSquareClick={onSquareClick}
                    boardOrientation={card.color}
                    arePiecesDraggable={!feedback}
                    {...skin.props}
                    animationDuration={skin.animationMs}
                    customSquareStyles={answeredSquares}
                    customArrows={answerArrow}
                  />
                </div>

                <div className="mt-5 w-[min(92vw,460px)]">
                  <p className="text-[15px] text-ink">
                    {feedback ? (
                      feedback.correct ? (
                        <>
                          Correct — the repertoire move is{" "}
                          <span className="san text-accent">{feedback.expected_san}</span>.
                        </>
                      ) : (
                        <>
                          Not the line. The repertoire plays{" "}
                          <span className="san text-bad">{feedback.expected_san}</span>.
                        </>
                      )
                    ) : (
                      "What do you play here?"
                    )}
                  </p>

                  {/* ONE instance, deliberately outside the answered/unanswered
                      branch. Rendering a separate rule in each branch would
                      unmount this one and mount another the moment the answer
                      lands, and a fresh element has nothing to travel from —
                      the needle would simply appear at its destination and the
                      one piece of motion in the app would never play. */}
                  <RecallRule
                    from={card.interval_days}
                    to={feedback ? feedback.next_due_days : null}
                    correct={feedback ? feedback.correct : null}
                    className="mt-3"
                  />

                  {feedback && (
                    <button className="btn-go mt-4 animate-rise" onClick={next} autoFocus>
                      Next position
                      <span className="ml-2 font-mono text-xs opacity-70">
                        {queue.length - 1} left
                      </span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="card-brass max-w-md p-8">
                {reps.length === 0 ? (
                  <>
                    <h1 className="mb-2 font-display text-3xl leading-tight text-ink">
                      No lines yet.
                    </h1>
                    <p className="mb-5 text-sm leading-relaxed text-muted">
                      Add an opening and ChessRabbit turns every position where
                      it&apos;s your move into a card. Variations in parentheses
                      become the branches your opponent gets to choose.
                    </p>
                    <button className="btn-primary" onClick={toggleOpenings}>
                      Browse openings
                    </button>
                  </>
                ) : (
                  <>
                    <h1 className="mb-2 font-display text-3xl leading-tight text-ink">
                      Nothing due.
                    </h1>
                    <p className="text-sm leading-relaxed text-muted">
                      Every card in your repertoire is scheduled past today. The
                      next one comes back on its own — that&apos;s the point of
                      spacing them.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>

          {/* ---- The rail: queue, tally, actions. Quiet on purpose. ---- */}
          <aside className="w-full shrink-0 space-y-7 lg:w-72">
            <div>
              <p className="rule-label mb-3">Queue</p>
              {reps.length === 0 ? (
                <p className="text-sm text-faint">
                  No repertoires yet — add your first opening below.
                </p>
              ) : (
                <ul className="space-y-px">
                  {reps.map((r) => (
                    <li
                      key={r.id}
                      className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors
                                 hover:bg-raise/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{r.name}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                          {r.color} · {r.card_count} card{r.card_count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-sm tabular-nums ${
                          r.due_count ? "text-brassLit" : "text-faint"
                        }`}
                        title={`${r.due_count} due now`}
                      >
                        {r.due_count}
                      </span>
                      <button
                        className="font-mono text-xs text-faint opacity-0 transition-opacity
                                   hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => removeRepertoire(r)}
                        title={`Delete ${r.name}`}
                        aria-label={`Delete ${r.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {answered > 0 && (
              <div>
                <p className="rule-label mb-3">This session</p>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-raise/60">
                  <span
                    className="bg-accent transition-[width] duration-300"
                    style={{ width: `${(session.right / answered) * 100}%` }}
                  />
                  <span
                    className="bg-bad transition-[width] duration-300"
                    style={{ width: `${(session.wrong / answered) * 100}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] tabular-nums text-muted">
                  <span className="text-accent">{session.right}</span> right ·{" "}
                  <span className="text-bad">{session.wrong}</span> wrong
                </p>
              </div>
            )}

            <div>
              <p className="rule-label mb-3">Add lines</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={toggleOpenings}>
                  {showOpenings ? "Close openings" : "Browse openings"}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setCreating((c) => !c);
                    setShowOpenings(false);
                  }}
                >
                  {creating ? "Cancel" : "Paste a PGN"}
                </button>
                <button
                  className="btn"
                  title="Turn engine-tagged mistakes from your analysed games into cards"
                  onClick={() =>
                    api
                      .syncBlunders()
                      .then((r) => {
                        setError(null);
                        refresh();
                        if (r.cards_created === 0 && r.mistakes_found === 0)
                          setError(
                            "No analysed mistakes to import. Run a full-game analysis on the board first, then sync again."
                          );
                      })
                      .catch(() =>
                        setError("Blunder import failed. Try again in a moment.")
                      )
                  }
                >
                  Import blunders
                </button>
              </div>
            </div>

            {showOpenings && (
              <div className="card max-h-[28rem] space-y-4 overflow-auto p-3">
                <p className="text-xs leading-relaxed text-muted">
                  Pick an opening to drill. It becomes a repertoire scheduled
                  like any other.
                </p>
                {openings.length === 0 && (
                  <p className="font-mono text-xs text-faint">Loading…</p>
                )}
                {(["white", "black"] as const).map((side) => {
                  const list = openings.filter((o) => o.color === side);
                  if (list.length === 0) return null;
                  return (
                    <div key={side}>
                      <p className="rule-label mb-2">Play as {side}</p>
                      <ul className="space-y-1">
                        {list.map((o) => (
                          <li
                            key={o.id}
                            className="rounded-md p-2 hover:bg-raise/40"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-ink">{o.name}</span>
                              <span className="font-mono text-[10px] text-faint">{o.eco}</span>
                              <button
                                  className="btn ml-auto px-2 py-1 text-xs"
                                  disabled={addingOpening !== null}
                                  onClick={() => trainOpening(o)}
                                >
                                  {addingOpening === o.id ? "Adding…" : "Add"}
                                </button>
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted">
                              {o.description}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {creating && (
              <form onSubmit={createRep} className="card space-y-2 p-3">
                <input
                  className="input text-sm"
                  placeholder="Name (e.g. Italian for White)"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
                <select
                  className="input text-sm"
                  value={form.color}
                  onChange={(e) =>
                    setForm({ ...form, color: e.target.value as "white" | "black" })
                  }
                >
                  <option value="white">I play White</option>
                  <option value="black">I play Black</option>
                </select>
                <textarea
                  className="input h-32 font-mono text-xs"
                  placeholder={"1. e4 e5 ( 1... c6 2. d4 ) 2. Nf3 *"}
                  value={form.pgn}
                  onChange={(e) => setForm({ ...form, pgn: e.target.value })}
                  required
                />
                <button className="btn-primary w-full">Save repertoire</button>
              </form>
            )}

            <div>
              <p className="rule-label mb-3">Other drills</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/train/puzzles" className="btn">Puzzles</Link>
                <Link href="/train/intuition" className="btn">Intuition</Link>
                <Link href="/train/clock" className="btn">Time bank</Link>
                <Link href="/train/coordinates" className="btn">Coordinates</Link>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
