import Link from "next/link";
import Image from "next/image";
import SiteFooter from "@/components/SiteFooter";
import RecallRule from "@/components/RecallRule";
import DonateSection from "@/components/DonateSection";

/**
 * The landing page.
 *
 * The old one opened with a stat block and four feature cards, which is the
 * layout every product uses when it hasn't decided what it is. This one opens
 * with the claim the product actually makes — that it decides when you next see
 * a position — and proves it with the same Recall Rule that runs on /train.
 *
 * Everything here is static: no engine, no client JavaScript beyond the rule's
 * one animation frame. The donation QR code is served from the local bundle.
 */

/**
 * The Italian after 3.Bc4 — a real position a repertoire would actually hold,
 * rather than the starting array.
 */
const HERO_FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R";

/**
 * The filled ("black") glyph for each piece. Both sides use the filled shapes
 * and are told apart by colour: the outline glyphs render far too thin at
 * board size, and on a light square they nearly vanish.
 */
const GLYPH: Record<string, string> = {
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

/** FEN board field -> 64 squares, rank 8 first. */
function squares(fen: string): (string | null)[] {
  const out: (string | null)[] = [];
  for (const ch of fen) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") out.push(...Array(Number(ch)).fill(null));
    else out.push(ch);
  }
  return out;
}

function HeroBoard() {
  return (
    <div className="board-frame w-full max-w-[min(78vw,400px)] shrink-0" aria-hidden>
      <div className="grid aspect-square grid-cols-8 overflow-hidden rounded-[2px]">
        {squares(HERO_FEN).map((piece, i) => {
          const dark = ((i >> 3) + i) % 2 === 1;
          const white = piece !== null && piece === piece.toUpperCase();
          return (
            <div
              key={i}
              className={`grid place-items-center ${dark ? "bg-board-dark" : "bg-board-light"}`}
            >
              {piece && (
                <span
                  className="select-none leading-none"
                  style={{
                    fontSize: "min(7.2vw, 38px)",
                    color: white ? "#FBFAF6" : "#302318",
                    // The pieces are one flat glyph each, so the only thing
                    // separating a white piece from a light square is this
                    // outline. Without it the back rank disappears.
                    textShadow: white
                      ? "0 0 1px #302318, 0 1px 2px rgba(48,35,24,0.5)"
                      : "0 1px 2px rgba(48,35,24,0.3)",
                  }}
                >
                  {GLYPH[piece.toLowerCase()]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The three things the app does, in the order the data actually moves:
 * games come in, analysis finds the weak lines, the queue drills them. This is
 * a real pipeline, so it gets numbered — the sequence is the information.
 */
const PIPELINE = [
  {
    n: "01",
    title: "Import",
    body: "Pull your games from Lichess or Chess.com, or type in an over-the-board score.",
    href: "/insights",
    cta: "See what your games say",
  },
  {
    n: "02",
    title: "Find the leaks",
    body: "Your selected local engine reviews every move and binds each blunder to the position it happened in.",
    href: "/app",
    cta: "Open the board",
  },
  {
    n: "03",
    title: "Drill until they hold",
    body: "Weak lines become cards. SM-2 schedules each one for the day before you'd have forgotten it.",
    href: "/train",
    cta: "Start a drill",
  },
];

export default function LandingPage() {
  return (
    <>
      <header className="border-b border-brass/25">
        <div className="mx-auto flex max-w-6xl items-center gap-5 px-5 py-3">
          <span className="inline-flex items-center gap-2 font-display text-lg text-ink">
            <Image src="/chessrabbit-mark.svg" alt="" width={26} height={26} aria-hidden="true" />
            ChessRabbit
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn">Sign in</Link>
            <Link href="/download" className="btn-primary">Download</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* Hero: the claim, and the instrument that backs it. */}
        <section className="flex flex-col items-center gap-12 py-16 lg:flex-row lg:items-start lg:justify-between lg:gap-16 lg:py-24">
          <div className="animate-rise max-w-2xl">
            <p className="eyebrow mb-6">Opening repertoire trainer</p>
            {/* Each sentence balances on its own; without this the second one
                drops a lone "evenly." onto a fourth line. */}
            <h1 className="font-display text-[clamp(2.5rem,4.6vw,3.75rem)] leading-[1.02] text-ink [text-wrap:balance]">
              You don&apos;t forget openings evenly.
              <br />
              <span className="text-brassLit">So don&apos;t review them evenly.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted">
              ChessRabbit finds the lines you actually get wrong, turns them into
              cards, and puts each one back in front of you on the day before
              you&apos;d have lost it.
            </p>

            {/* The signature element, doing its job as the proof of the claim
                above: this is what happens to a card you just got right. */}
            <div className="mt-12 max-w-lg">
              <p className="eyebrow mb-3">One card, answered correctly</p>
              <RecallRule from={3} to={21} correct bare />
              <p className="mt-2 font-mono text-xs tracking-wide">
                <span className="san text-ink">Bc4</span>
                <span className="text-muted"> · held at 3 days · </span>
                <span className="text-accent">now due in three weeks</span>
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/download" className="btn-primary px-5 py-2.5">
                Download and run locally
              </Link>
              <Link href="/app" className="btn px-5 py-2.5">
                Open the board
              </Link>
            </div>
          </div>

          <div className="animate-rise" style={{ animationDelay: "0.1s" }}>
            <HeroBoard />
            <p className="mt-3 max-w-[400px] font-mono text-[11px] leading-relaxed text-muted">
              Italian Game, after <span className="text-ink">3. Bc4</span> — the
              kind of position a repertoire is made of, and the kind you lose
              first.
            </p>
          </div>
        </section>

        {/* The pipeline. Numbered because it genuinely is a sequence: nothing
            in step 3 exists until steps 1 and 2 have run. */}
        <section className="border-t border-line/60 py-16">
          <div className="grid gap-px overflow-hidden rounded-md bg-line/40 sm:grid-cols-3">
            {PIPELINE.map((s) => (
              <div key={s.n} className="flex flex-col gap-3 bg-night p-6">
                <span className="font-mono text-[11px] tracking-[0.2em] text-brass">
                  {s.n}
                </span>
                <h2 className="font-display text-2xl leading-tight text-ink">
                  {s.title}
                </h2>
                <p className="flex-1 text-sm leading-relaxed text-muted">{s.body}</p>
                <Link
                  href={s.href}
                  className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm text-brassLit
                             underline-offset-4 hover:underline"
                >
                  {s.cta}
                  <span aria-hidden>→</span>
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Scouting is the one feature that isn't in the main loop, so it gets
            its own quiet band rather than a fourth card pretending to be. */}
        <section className="border-t border-line/60 py-16">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-baseline sm:gap-12">
            <div className="sm:w-52 sm:shrink-0">
              <p className="eyebrow mb-2">Also</p>
              <h2 className="font-display text-2xl leading-tight text-ink">
                Know what they play
              </h2>
            </div>
            <div className="max-w-xl">
              <p className="text-sm leading-relaxed text-muted">
                Enter an opponent&apos;s Lichess or Chess.com name and
                ChessRabbit reads their real games — what they open with, how
                often, and how it goes for them. Build the counter-line, then
                drill it on the same schedule as everything else.
              </p>
              <Link
                href="/prep"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-brassLit
                           underline-offset-4 hover:underline"
              >
                Scout an opponent
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>
        <DonateSection />
      </main>
      <SiteFooter />
    </>
  );
}
