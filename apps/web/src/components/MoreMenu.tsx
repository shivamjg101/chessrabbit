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
        href: "/database",
        label: "My database",
        blurb: "Filter, sort, file and export your games",
      },
      {
        href: "/search",
        label: "Reference database",
        blurb: "Search master games by player, opening or position",
      },
      {
        href: "/study",
        label: "Studies",
        blurb: "Chapters, interactive lessons, public studies",
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

  // Escape closes it, like every other menu on the platform, and so does a
  // press anywhere outside it. A listener rather than a full-screen
  // click-catcher: the menu lives in glass headers, and inside a blurred pane a
  // `fixed` catcher only covers the pane.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
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
          <div
            role="menu"
            className="menu-pane absolute left-0 top-full z-50 mt-2 w-72 animate-rise p-1.5"
          >
            {GROUPS.map((group, gi) => (
              <div
                key={group.heading}
                className={gi > 0 ? "mt-1 border-t border-ivory/[0.06] pt-1" : ""}
              >
                <p className="eyebrow px-2 py-1">{group.heading}</p>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-ivory/[0.08]"
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
