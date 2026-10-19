"use client";

import { useEffect, useRef } from "react";
import { Annotation, Classification } from "@/lib/api";
import { CLASS_META } from "@/lib/classification";
import { LiveVerdict, formatCp } from "@/lib/liveEval";
import { MoveTree, NodeId, nodeAt } from "@/lib/moveTree";
import { Row, Token } from "@/lib/moveTreeRender";

interface Props {
  tree: MoveTree;
  rows: Row[];
  annByPly: Map<number, Annotation>;
  /** Verdicts the engine reached live, for moves no server review covers. */
  liveByNode: Map<NodeId, LiveVerdict>;
  cursorId: NodeId;
  onSeek: (id: NodeId) => void;
}

/** How far a side line is allowed to walk right before it stops indenting. */
const MAX_INDENT = 3;

/** Nearest ancestor that actually scrolls, or null if the page is the scroller. */
function scrollingParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * The game in numbered pairs, with every line you tried instead of it indented
 * beneath the move it answers. The row for the current move is kept in view so
 * stepping through a long game never leaves you hunting for your place.
 *
 * Two kinds of verdict appear here, and they are never mixed. A filled badge is
 * the server's, from a review of the game that was actually played, keyed by
 * ply and checked against the move the board holds. An outlined badge is one
 * the engine reached live, while you explored, for a move no review covers.
 *
 * What is still forbidden is what always was: a variation may not borrow the
 * badge belonging to the move it replaced. That would label one move with an
 * opinion of a different one - the failure this whole panel is built to avoid.
 * A live verdict is about the move it sits on, or it is not shown at all.
 */
export default function MoveList({
  tree,
  rows,
  annByPly,
  liveByNode,
  cursorId,
  onSeek,
}: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Centre the current move inside the panel. Deliberately not
  // scrollIntoView: on a phone the panel does not scroll, and the browser
  // would drag the whole page - board and all - to chase the move.
  useEffect(() => {
    const el = activeRef.current;
    const box = scrollingParent(el);
    if (!el || !box) return;
    const e = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollBy({
      top: e.top + e.height / 2 - (b.top + b.height / 2),
      behavior: "smooth",
    });
  }, [cursorId]);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted px-1 py-3">
        Drag a piece — or click it — to start a line. Arrow keys walk the moves.
      </p>
    );
  }

  /** How a live verdict reads on hover: the word, then the score behind it. */
  const liveTitle = (v: LiveVerdict) =>
    `${CLASS_META[v.cls].label} — engine, live · ${formatCp(v.cp)} at depth ${v.depth}`;

  const badge = (cls: Classification, live: boolean) => (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-bold"
      style={
        live
          ? // Outlined, so a verdict on a line you invented can never be read
            // as part of the reviewed game. Same glyph, same colour, no fill.
            { color: CLASS_META[cls].bg, boxShadow: `inset 0 0 0 1.5px ${CLASS_META[cls].bg}` }
          : { background: CLASS_META[cls].bg, color: "#fff" }
      }
    >
      {CLASS_META[cls].glyph}
    </span>
  );

  const cell = (id?: NodeId) => {
    const n = id == null ? undefined : nodeAt(tree, id);
    if (!n) return <span />;
    const ann = annByPly.get(n.ply);
    // The server's verdict wins wherever it has one. The live one only fills
    // the gaps: an unreviewed game, or a row the alignment check dropped.
    const live = ann?.classification ? undefined : liveByNode.get(n.id);
    const cls = ann?.classification ?? live?.cls;
    const meta = cls ? CLASS_META[cls] : null;
    const active = cursorId === n.id;
    return (
      <button
        ref={active ? activeRef : undefined}
        onClick={() => onSeek(n.id)}
        title={ann?.review ?? (live ? liveTitle(live) : undefined)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left font-mono text-[13px]
                    transition-colors ${
                      active
                        ? "bg-accent/25 text-ink font-semibold ring-1 ring-accent/50"
                        : "hover:bg-ink/[0.07]"
                    }`}
      >
        {cls && badge(cls, !!live)}
        <span className={meta && !active ? meta.color : undefined}>{n.san}</span>
      </button>
    );
  };

  const token = (t: Token, i: number) => {
    if (t.t === "paren") {
      return (
        <span key={i} className="px-0.5 text-muted/70">
          {t.text}
        </span>
      );
    }
    const active = cursorId === t.id;
    const live = liveByNode.get(t.id);
    return (
      <button
        key={i}
        ref={active ? activeRef : undefined}
        onClick={() => onSeek(t.id)}
        title={live ? liveTitle(live) : undefined}
        aria-current={active ? "true" : undefined}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${
          active ? "bg-accent/25 font-semibold text-ink ring-1 ring-accent/50" : "hover:bg-ink/[0.07]"
        }`}
      >
        {t.num && <span className="mr-0.5 text-muted">{t.num}</span>}
        <span className={live && !active ? CLASS_META[live.cls].color : undefined}>{t.san}</span>
        {live && badge(live.cls, true)}
      </button>
    );
  };

  return (
    <div className="grid grid-cols-[1.75rem_1fr_1fr] items-center gap-x-1 gap-y-0.5">
      {rows.map((row) =>
        row.kind === "pair" ? (
          <div key={row.key} className="contents">
            <span className="text-right pr-1 font-mono text-[11px] text-muted">
              {row.moveNo}.
            </span>
            {cell(row.white)}
            {cell(row.black)}
          </div>
        ) : (
          <div
            key={row.key}
            // The rail is what tells you at a glance that these moves were
            // never played. Indenting stops after a few levels so a deep line
            // stays readable in a panel this narrow.
            className="col-span-3 my-0.5 flex flex-wrap items-center border-l-2 border-accent/25
                       py-0.5 pl-1.5 font-mono text-[12px] text-ink/70"
            style={{ marginLeft: `${Math.min(row.depth, MAX_INDENT) * 10}px` }}
          >
            {row.tokens.map(token)}
          </div>
        )
      )}
    </div>
  );
}
