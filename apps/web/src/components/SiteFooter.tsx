"use client";

import Link from "next/link";

/** Public navigation and engine attribution. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-line/35 px-4 py-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <span>© {new Date().getFullYear()} ChessRabbit</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/download" className="hover:text-ink hover:underline">
            Download
          </Link>
          <Link href="/donate" className="hover:text-ink hover:underline">
            Donate
          </Link>
          <Link href="/terms" className="hover:text-ink hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Privacy
          </Link>
          <Link href="/open-source" className="hover:text-ink hover:underline">
            Open source
          </Link>
        </nav>
        <span className="w-full text-[11px] leading-relaxed sm:w-auto sm:flex-1 sm:text-right">
          Analysis by{" "}
          <a
            href="https://github.com/official-stockfish/Stockfish"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-ink"
          >
            Stockfish
          </a>{" "}
          and Leela Chess Zero (GPL-3.0), run locally. Not affiliated with ChessBase, Lichess or
          Chess.com.
        </span>
      </div>
    </footer>
  );
}
