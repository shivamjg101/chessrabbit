"use client";

import { Fragment, useEffect, useRef } from "react";
import { Annotation, Classification } from "@/lib/api";
import { CLASS_META } from "@/lib/classification";
import { LiveVerdict, formatCp } from "@/lib/liveEval";
import { MoveNode, MoveTree, NodeId, nodeAt } from "@/lib/moveTree";
import { Row, Token } from "@/lib/moveTreeRender";
import { glyphOf, glyphSymbol } from "@/lib/nags";
import { splitComment } from "@/lib/shapes";

interface Props {
  tree: MoveTree;
  rows: Row[];
  annByPly: Map<number, Annotation>;
  /** Verdicts the engine reached live, for moves no server review covers. */
  liveByNode: Map<NodeId, LiveVerdict>;
  cursorId: NodeId;
  onSeek: (id: NodeId) => void;
  /**
   * Hide every move deeper than this ply - a chapter read as "guess the
   * move", where the next move only appears once you step onto it.
   */
  revealPly?: number | null;
}

/** How far a side line is allowed to walk right before it stops indenting. */
const MAX_INDENT = 3;

/**
 * The colour a move mark is printed in. The marks borrow the verdict scale
 * rather than inventing one: "!" reads as the same "right" as a best move,
 * "??" as the same "lost" as a blunder. Everything else stays ink.
 */
const MARK_TONE: Record<number, string> = {
  1: "text-accent",
  3: "text-accent",
  5: "text-good",
  6: "text-[#F2D177]",
  2: "text-brass",
  4: "text-bad",
};

/** The glyphs printed after a move: its mark attached, the rest spaced. */
function Marks({ node }: { node: MoveNode }) {
  if (node.nag == null && !node.nags?.length) return null;
  return (
    <>
      {node.nag != null && (
        <span className={MARK_TONE[node.nag] ?? "text-ink"} title={glyphOf(node.nag)?.name}>
          {glyphSymbol(node.nag)}
        </span>
      )}
      {node.nags?.map((g) => (
        <span key={g} className="ml-0.5 text-muted" title={glyphOf(g)?.name}>
          {glyphSymbol(g)}
        </span>
      ))}
    </>
  );
}

/** The prose of a comment, with any drawn shapes taken out. */
function prose(node?: MoveNode): string {
  return node ? splitComment(node.comment).text : "";
}

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
  revealPly,
}: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const concealing = revealPly != null;
  const visible = (n?: MoveNode) => !!n && (!concealing || n.ply <= revealPly!);

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
    if (!n || !visible(n)) return <span />;
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
        className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left font-mono text-[13px]
                    transition-colors ${
                      active
                        ? "bg-ivory/[0.14] text-ink font-semibold shadow-edge ring-1 ring-brass/50"
                        : "hover:bg-ivory/[0.07]"
                    }`}
      >
        {cls && badge(cls, !!live)}
        <span className={meta && !active ? meta.color : undefined}>{n.san}</span>
        <Marks node={n} />
      </button>
    );
  };

  /**
   * What was written about a main-line move, under the pair it belongs to.
   * The pair layout has nowhere inline to put prose, and a comment is the
   * part of an annotated game people actually read.
   */
  const commentRow = (id?: NodeId) => {
    const n = id == null ? undefined : nodeAt(tree, id);
    const text = visible(n) ? prose(n) : "";
    if (!n || !text) return null;
    return (
      <p
        key={`c${n.id}`}
        className="col-span-3 mb-1 ml-7 whitespace-pre-wrap border-l-2 border-brass/30 pl-2
                   text-[12px] leading-relaxed text-ink/80"
      >
        <span className="mr-1 font-mono text-[10px] text-muted">
          {Math.floor(n.ply / 2) + 1}
          {n.ply % 2 === 0 ? "." : "..."}
          {n.san}
        </span>
        {text}
      </p>
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
    const n = nodeAt(tree, t.id);
    const said = prose(n);
    return (
      <Fragment key={i}>
        <button
          ref={active ? activeRef : undefined}
          onClick={() => onSeek(t.id)}
          title={live ? liveTitle(live) : undefined}
          aria-current={active ? "true" : undefined}
          className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors ${
            active ? "bg-ivory/[0.14] font-semibold text-ink shadow-edge ring-1 ring-brass/50" : "hover:bg-ivory/[0.07]"
          }`}
        >
          {t.num && <span className="mr-0.5 text-muted">{t.num}</span>}
          <span className={live && !active ? CLASS_META[live.cls].color : undefined}>{t.san}</span>
          {n && <Marks node={n} />}
          {live && badge(live.cls, true)}
        </button>
        {/* Inside a side line the prose sits inline, the way it reads in a
            printed book: the move, then what the annotator said about it. */}
        {said && (
          <span className="mx-0.5 whitespace-pre-wrap font-sans text-[11.5px] italic text-ink/65">
            {said}
          </span>
        )}
      </Fragment>
    );
  };

  /**
   * A side line's tokens with everything past the reveal point taken out, and
   * any bracket left with nothing in it dropped along with it.
   */
  const shown = (tokens: Token[]): Token[] => {
    if (!concealing) return tokens;
    const kept = tokens.filter((t) => t.t === "paren" || visible(nodeAt(tree, t.id)));
    const out: Token[] = [];
    for (const t of kept) {
      const prev = out[out.length - 1];
      if (t.t === "paren" && t.text === ")" && prev?.t === "paren" && prev.text === "(") {
        out.pop();
        continue;
      }
      out.push(t);
    }
    return out;
  };

  const root = nodeAt(tree, tree.root);
  const preface = prose(root);
  const hidden = concealing
    ? [...tree.nodes.values()].filter((n) => n.parent !== null && n.ply > revealPly!).length
    : 0;

  return (
    <div className="grid grid-cols-[1.75rem_1fr_1fr] items-center gap-x-1 gap-y-0.5">
      {preface && (
        <p className="col-span-3 mb-2 whitespace-pre-wrap rounded-xl bg-ivory/[0.04] px-2.5 py-2 text-[12px] leading-relaxed text-ink/85">
          {preface}
        </p>
      )}
      {rows.map((row) => {
        if (row.kind === "pair") {
          const w = nodeAt(tree, row.white ?? -1);
          if (concealing && !visible(w)) return null;
          return (
            <Fragment key={row.key}>
              <div className="contents">
                <span className="text-right pr-1 font-mono text-[11px] text-muted">
                  {row.moveNo}.
                </span>
                {cell(row.white)}
                {cell(row.black)}
              </div>
              {commentRow(row.white)}
              {commentRow(row.black)}
            </Fragment>
          );
        }
        const tokens = shown(row.tokens);
        if (!tokens.some((t) => t.t === "move")) return null;
        return (
          <div
            key={row.key}
            // The rail is what tells you at a glance that these moves were
            // never played. Indenting stops after a few levels so a deep line
            // stays readable in a panel this narrow.
            className="col-span-3 my-0.5 flex flex-wrap items-center border-l-2 border-accent/25
                       py-0.5 pl-1.5 font-mono text-[12px] text-ink/70"
            style={{ marginLeft: `${Math.min(row.depth, MAX_INDENT) * 10}px` }}
          >
            {tokens.map(token)}
          </div>
        );
      })}
      {hidden > 0 && (
        <p className="col-span-3 mt-2 text-[11px] text-muted">
          {hidden} move{hidden === 1 ? "" : "s"} hidden until you step onto them. Find
          the next move on the board, or press → to reveal it.
        </p>
      )}
    </div>
  );
}
