"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Secondary navigation.
 *
 * The header only has room for the handful of places you go every session;
 * everything else lives here rather than being cut. Every entry points at a
 * route that exists — a menu that lists things the app cannot do is worse than
 * a shorter menu.
 */
const GROUPS: {
  heading: string;
  items: { href: string; label: string; blurb: string }[];
}[] = [
  {
    heading: "Train",
    items: [
      {
        href: "/train",
        label: "Opening drills",
        blurb: "Spaced repetition on your repertoire",
      },
      {
        href: "/train/puzzles",
        label: "Puzzles",
        blurb: "Rated tactics and Puzzle Rush",
      },
      {
        href: "/train/intuition",
        label: "Intuition",
        blurb: "Guess the master's move",
      },
      {
        href: "/train/clock",
        label: "Time bank",
        blurb: "Drill your clock management",
      },
    ],
  },
  {
    heading: "Study",
    items: [
      {
        href: "/search",
        label: "Reference database",
        blurb: "Search master games by player, opening or position",
      },
      {
        href: "/study",
        label: "Studies",
        blurb: "Annotated chapters you can share",
      },
      {
        href: "/insights",
        label: "Insights",
        blurb: "How you actually play, across every game",
      },
      {
        href: "/prep",
        label: "Opponent prep",
        blurb: "Scout what your next opponent plays",
      },
      {
        href: "/chess960",
        label: "Chess960",
        blurb: "Play and analyse shuffled starting positions",
      },
    ],
  },
  {
    heading: "Project",
    items: [
      {
        href: "/download",
        label: "Download and setup",
        blurb: "Run ChessRabbit on your own computer",
      },
      {
        href: "/donate",
        label: "Donate",
        blurb: "Support free, open-source development",
      },
    ],
  },
];

export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Escape closes it, like every other menu on the platform.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`seg-item flex items-center gap-1 ${open ? "seg-item-on" : ""}`}
      >
        More
        <span
          aria-hidden
          className={`text-[9px] transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="card absolute left-0 top-full z-50 mt-2 w-72 animate-rise p-1.5 shadow-card"
          >
            {GROUPS.map((group, gi) => (
              <div
                key={group.heading}
                className={gi > 0 ? "mt-1 border-t border-line/35 pt-1" : ""}
              >
                <p className="eyebrow px-2 py-1">{group.heading}</p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-ink/[0.07]"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{item.label}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {item.blurb}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
