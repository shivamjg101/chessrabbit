"use client";

import { MINOR, TICKS, intervalLabel, pos } from "@/lib/recallScale";

/**
 * The Recall Rule — a slide rule for memory.
 *
 * This is the one place in the app allowed to be loud, and it earns it by
 * showing the thing the product actually does. SM-2 does not "mark you right";
 * it decides when you will see this position again, and that decision is the
 * whole value of drilling. Everywhere else that number is a sentence in small
 * grey text ("next review in 6 days") which nobody reads twice. Here it is a
 * lit scale with a needle on it, and answering moves the needle.
 *
 * Correct, and the needle travels right to its new interval. Wrong, and it
 * drops back to the first tick, which is exactly what the algorithm did to the
 * card. One motion, once per answer — this is the app's entire motion budget,
 * spent in the one spot where the movement IS the information.
 *
 * The scale itself lives in lib/recallScale.ts, where it can be tested: a
 * needle three pixels off still looks like a needle, so the maths does not get
 * to rely on someone noticing.
 */

export interface RecallRuleProps {
  /** Where the card sits now, in days. */
  from: number;
  /** Where it lands once answered. Null until the answer is graded. */
  to?: number | null;
  /** Drives the needle's colour and the readout. Null until graded. */
  correct?: boolean | null;
  /** Suppresses the readout line — used on the landing page. */
  bare?: boolean;
  className?: string;
}

export default function RecallRule({
  from,
  to = null,
  correct = null,
  bare = false,
  className = "",
}: RecallRuleProps) {
  const settled = to !== null;
  const target = settled ? (to as number) : from;

  // Derived during render, with no state and no timer behind it: the CSS
  // transition on `left` animates whenever this value changes between renders,
  // which is exactly when the needle should move — the answer landing, and
  // nothing else.
  //
  // Two earlier versions of this held the start position in state and moved it
  // on mount, first with requestAnimationFrame and then with a timer. Both were
  // wrong in the same way: they made the travel an ENTRANCE rather than a
  // response, so the server-rendered markup showed the needle at the old
  // interval while the readout beside it already announced the new one. Anyone
  // whose JavaScript was still arriving read a rule that disagreed with its own
  // caption.
  //
  // For the travel to animate, the caller must keep ONE instance across the
  // answer rather than swapping between two — see the note on /train.
  const at = pos(target);

  const tone = correct === null ? "brass" : correct ? "accent" : "bad";
  const needleColor =
    tone === "brass" ? "#D6A05C" : tone === "accent" ? "#70C586" : "#E66250";

  return (
    <div className={className}>
      <div
        className="relative h-[4.5rem] select-none"
        // The rule is decorative geometry; the readout below carries the
        // meaning for anyone not looking at it.
        aria-hidden
      >
        {/* The edge itself. Lit through the travelled span and faint beyond
            it, so the scale reads as a measurement already taken rather than
            as an empty ruler. */}
        <div className="absolute inset-x-0 top-8 h-px bg-ivory/15" />
        <div
          className="absolute top-8 h-0.5 -translate-y-px rounded-full bg-brassLit
                     shadow-[0_0_10px_rgb(var(--c-brass)/0.85)]
                     motion-safe:transition-[width] motion-safe:duration-[620ms]"
          style={{
            width: `${at}%`,
            transitionTimingFunction: "cubic-bezier(0.34, 1.32, 0.42, 1)",
          }}
        />

        {MINOR.map((d) => (
          <span
            key={d}
            className="absolute top-8 h-2 w-px bg-ivory/25"
            style={{ left: `${pos(d)}%` }}
          />
        ))}

        {TICKS.map((t) => {
          const reached = pos(t.days) <= at + 0.5;
          return (
            <span
              key={t.days}
              className="absolute top-8 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${pos(t.days)}%` }}
            >
              <span
                className={`transition-colors duration-300 ${
                  reached ? "h-4 w-0.5 bg-brassLit" : "h-3 w-px bg-ivory/35"
                }`}
              />
              <span
                className={`mt-1.5 font-mono text-[11px] tracking-wider transition-colors duration-300 ${
                  reached ? "text-brassLit" : "text-muted"
                }`}
              >
                {t.label}
              </span>
            </span>
          );
        })}

        {/* The needle. `left` is transitioned rather than transform, so the
            travel follows the log scale the ticks are drawn on. The curve
            overshoots slightly and comes back — a needle finding its reading. */}
        <span
          className="absolute top-0 -translate-x-1/2 motion-safe:transition-[left] motion-safe:duration-[620ms]"
          style={{
            left: `${at}%`,
            transitionTimingFunction: "cubic-bezier(0.34, 1.32, 0.42, 1)",
          }}
        >
          <span
            className="block h-8 w-0.5 rounded-full transition-colors duration-300"
            style={{ backgroundColor: needleColor, boxShadow: `0 0 12px ${needleColor}` }}
          />
          <span
            className="absolute -top-1.5 left-1/2 block h-3 w-3 -translate-x-1/2 rounded-full
                       border border-white/60 transition-colors duration-300"
            style={{ backgroundColor: needleColor, boxShadow: `0 0 14px ${needleColor}` }}
          />
        </span>
      </div>

      {!bare && (
        <p
          className="mt-1 font-mono text-[11px] tracking-wide text-muted"
          aria-live="polite"
        >
          {settled ? (
            <>
              <span style={{ color: needleColor }}>
                {correct ? "Retained" : "Lapsed"}
              </span>
              {" · back in "}
              <span className="text-ink">{intervalLabel(target)}</span>
            </>
          ) : (
            <>
              {"Last seen at an interval of "}
              <span className="text-ink">
                {from <= 0 ? "never — this is a new card" : intervalLabel(from)}
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
