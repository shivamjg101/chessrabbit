"use client";

import Link from "next/link";

/**
 * The chrome around Terms, Privacy and the credits page.
 *
 * One component for all three so they read as one document set rather than
 * three pages written on different days — the same measure, the same heading
 * scale, the same footer. Long-form prose is the only place in this app that
 * needs a reading column, so the typography lives here instead of in the
 * global stylesheet.
 */

interface Props {
  title: string;
  /** Rendered under the title: what this document is, in one line. */
  standfirst?: string;
  updated?: string;
  children: React.ReactNode;
}

export default function LegalDoc({
  title,
  standfirst,
  updated,
  children,
}: Props) {
  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="btn rounded-full px-3 text-xs">
          ← ChessRabbit
        </Link>
        <h1 className="mt-5 font-display text-4xl">{title}</h1>
        {standfirst && (
          <p className="mt-2 text-sm leading-relaxed text-muted">{standfirst}</p>
        )}
        {updated && (
          <p className="mt-2 font-mono text-[11px] text-muted">Last updated {updated}</p>
        )}
      </header>

      {/* The reading column is one pane of glass, darkened a little so long
          prose never sits over the brightest part of the aurora. */}
      <div className="legal card bg-night/30 p-6 sm:p-8">{children}</div>

      <footer className="mt-6 px-2">
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <Link href="/terms" className="hover:text-ink hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Privacy
          </Link>
          <Link href="/open-source" className="hover:text-ink hover:underline">
            Open source
          </Link>
          <Link href="/download" className="hover:text-ink hover:underline">
            Download
          </Link>
        </nav>
      </footer>
    </div>
  );
}
