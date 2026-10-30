import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import RecallRule from "@/components/RecallRule";
import DonateSection from "@/components/DonateSection";
import Wordmark from "@/components/Wordmark";

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
      <div className="grid aspect-square grid-cols-8 overflow-hidden rounded-[4px]">
        {squares(HERO_FEN).map((piece, i) => {
          const dark = ((i >> 3) + i) % 2 === 1;
          const white = piece !== null && piece === piece.toUpperCase();
          return (
            <div
              key={i}
              className="grid place-items-center"
              // The Walnut board from lib/boardTheme.ts.
              style={{ background: dark ? "#9A7550" : "#E4D9C4" }}
            >
              {piece && (
                <span
                  className="select-none leading-none"
                  style={{
                    fontSize: "min(7.2vw, 38px)",
                    color: white ? "#FFFBF2" : "#1A120C",
                    // The pieces are one flat glyph each, so the only thing
                    // separating a white piece from a light square is this
                    // outline. Without it the back rank disappears.
                    textShadow: white
                      ? "0 0 1px #1A120C, 0 0 1px #1A120C, 0 1px 2px rgba(6,3,1,0.55)"
                      : "0 1px 2px rgba(6,3,1,0.3)",
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
 * The board with two panes of glass laid over its corners: the verdict on the
 * move just played, and where the card goes next. They show the material doing
 * its job - the squares underneath blur through them - and both say something
 * true about the position. This board is a static picture, so unlike a
 * playable one it can sit under a filter.
 */
function HeroStage() {
  return (
    <div className="relative">
      <HeroBoard />
      <div
        aria-hidden
        className="glass absolute -left-6 top-10 hidden items-center gap-2.5 rounded-2xl bg-night/60 px-3.5 py-2.5 sm:flex"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-bold text-[#0E2414] shadow-glow">
          ★
        </span>
        <span className="leading-tight">
          <span className="san block text-sm">3. Bc4</span>
          <span className="block text-[11px] text-muted">Best move · book</span>
        </span>
      </div>
      <div
        aria-hidden
        className="glass absolute -bottom-7 -right-5 hidden rounded-2xl bg-night/60 px-4 py-3 sm:block"
      >
        <span className="eyebrow block">Next review</span>
        <span className="font-display block text-2xl leading-tight text-ink">21 days</span>
        <span className="block font-mono text-[11px] text-accent">↑ from 3 days</span>
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
      {/* A floating pill of glass rather than a bar: on the landing page
          nothing else is chrome, so the nav can afford to hover. */}
      <header className="sticky top-3 z-40 px-3">
        <div className="glass mx-auto flex max-w-6xl items-center gap-3 rounded-full py-2 pl-3 pr-2">
          <Wordmark href="/" />
          <nav className="ml-6 hidden items-center gap-5 text-sm text-muted md:flex">
            <Link href="/insights" className="transition-colors hover:text-ink">Insights</Link>
            <Link href="/train" className="transition-colors hover:text-ink">Drills</Link>
            <Link href="/prep" className="transition-colors hover:text-ink">Opponent prep</Link>
            <Link href="/open-source" className="transition-colors hover:text-ink">Open source</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn rounded-full px-4">Sign in</Link>
            <Link href="/download" className="btn-primary rounded-full px-4 py-1.5">Download</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* Hero: the claim, and the instrument that backs it. */}
        <section className="flex flex-col items-center gap-16 py-16 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:py-24">
          <div className="animate-rise max-w-2xl">
            <p className="glass mb-7 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-brass shadow-[0_0_8px_rgb(var(--c-brass))]" />
              Opening repertoire trainer · free and local
            </p>
            {/* Each sentence balances on its own; without this the second one
                drops a lone "evenly." onto a fourth line. */}
            <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-[1.02] text-ink [text-wrap:balance]">
              You don&apos;t forget openings evenly.
              <br />
              <span className="text-gilded">So don&apos;t review them evenly.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted">
              ChessRabbit finds the lines you actually get wrong, turns them into
              cards, and puts each one back in front of you on the day before
              you&apos;d have lost it.
            </p>

            {/* The signature element, doing its job as the proof of the claim
                above: this is what happens to a card you just got right. */}
            <div className="glass mt-10 max-w-lg rounded-2xl px-5 py-4">
              <p className="eyebrow mb-3">One card, answered correctly</p>
              <RecallRule from={3} to={21} correct bare />
              <p className="mt-2 font-mono text-xs tracking-wide">
                <span className="san text-ink">Bc4</span>
                <span className="text-muted"> · held at 3 days · </span>
                <span className="text-accent">now due in three weeks</span>
              </p>
            </div>

            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/download" className="btn-primary px-5 py-2.5">
                Download and run locally
              </Link>
              <Link href="/app" className="btn px-5 py-2.5">
                Open the board
              </Link>
            </div>
          </div>

          <div className="animate-rise" style={{ animationDelay: "0.1s" }}>
            <HeroStage />
            <p className="mt-10 max-w-[400px] font-mono text-[11px] leading-relaxed text-muted">
              Italian Game, after <span className="text-ink">3. Bc4</span> — the
              kind of position a repertoire is made of, and the kind you lose
              first.
            </p>
          </div>
        </section>

        {/* The pipeline. Numbered because it genuinely is a sequence: nothing
            in step 3 exists until steps 1 and 2 have run. */}
        <section className="py-14">
          <div className="grid gap-4 sm:grid-cols-3">
            {PIPELINE.map((s) => (
              <div key={s.n} className="card flex flex-col gap-3 p-6">
                <span
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/20
                             bg-gradient-to-br from-brassLit/35 to-copper/45 font-mono text-xs
                             text-white shadow-edge"
                >
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
        <section className="pb-14">
          <div className="card flex flex-col gap-6 p-6 sm:flex-row sm:items-baseline sm:gap-12 sm:p-8">
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
