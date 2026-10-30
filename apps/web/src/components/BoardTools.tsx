"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import BoardEditor from "@/components/BoardEditor";
import { Overlay } from "@/components/Modal";
import type { MoveTreeApi } from "@/hooks/useMoveTree";
import { api, ApiError, Novelty, NoveltyScope, saveTextFile } from "@/lib/api";
import { diagramSvg, saveDiagram } from "@/lib/diagram";
import { MoveNode, mainlinePath, nodeAt } from "@/lib/moveTree";
import { splitPgnGames } from "@/lib/pgn";

/**
 * Everything you can do *with* the position or the game on the board, as
 * opposed to things you do *on* it: copy it out, draw it as a diagram, set up
 * a different one, paste one in, prune or merge the tree.
 *
 * A menu rather than a toolbar because a database program has dozens of
 * these, and a panel 352px wide has room for none of them as buttons.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Dialog = null | "setup" | "paste" | "merge" | "diagram" | "novelty";

interface Props {
  mt: MoveTreeApi;
  orientation: "white" | "black";
  /** The name a download or caption goes by. */
  label?: string;
  /** May the tree be changed - false only for somebody else's study. */
  canEdit: boolean;
  /** May the whole board be replaced - only the free analysis board. */
  canLoad: boolean;
  /** The game on the board, when it is one of yours: not its own precedent. */
  gameId?: number;
  /** The squares of the theme in use, so a diagram looks like the board. */
  light?: string;
  dark?: string;
}

export default function BoardTools({ mt, orientation, label, canEdit, canLoad, gameId, light, dark }: Props) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2200);
    return () => clearTimeout(timer);
  }, [note]);

  // Closed by Escape or by a press anywhere outside it. A listener rather than
  // a full-screen click-catcher: inside the blurred panel a `fixed` catcher
  // only covers the panel, so clicks on the board would leave the menu open.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const name = (label ?? "position").replace(/[^\w-]+/g, "_").slice(0, 40) || "position";

  async function copy(what: string, value: string) {
    setOpen(false);
    setNote((await copyText(value)) ? `${what} copied` : "Copying was blocked by the browser");
  }

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  const item = (text: string, onClick: () => void, hint?: string) => (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-ivory/[0.07]"
    >
      <span className="flex-1">{text}</span>
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </button>
  );

  return (
    <div className="relative" ref={root}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Tools: copy, export, set up, merge"
        className="rounded-lg border border-ivory/10 px-2 py-0.5 text-[11px] text-muted hover:bg-ivory/10 hover:text-ink"
      >
        Tools ▾
      </button>
      {note && (
        <span className="menu-pane absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px]">
          {note}
        </span>
      )}

      {open && (
        <>
          <div
            role="menu"
            className="menu-pane absolute right-0 top-full z-50 mt-1.5 w-64 animate-rise p-1.5"
          >
            <p className="eyebrow px-2.5 py-1">Copy</p>
            {item("Copy FEN", () => copy("FEN", mt.fen))}
            {item("Copy PGN", () => copy("PGN", mt.exportPgn()), "with variations")}
            {item("Copy this line", () => copy("Line", mt.lineMovetext()), "start → here")}

            <p className="eyebrow mt-1 border-t border-ivory/[0.06] px-2.5 pb-1 pt-2">Export</p>
            {item("Download PGN", () => run(() => saveTextFile(mt.exportPgn(), `${name}.pgn`)))}
            {item("Diagram image…", () => run(() => setDialog("diagram")), "PNG / SVG")}

            <p className="eyebrow mt-1 border-t border-ivory/[0.06] px-2.5 pb-1 pt-2">Position</p>
            <Link
              role="menuitem"
              href={`/search/?fen=${encodeURIComponent(mt.fen)}`}
              className="block rounded-lg px-2.5 py-1.5 text-xs hover:bg-ivory/[0.07]"
            >
              Find games with this position
            </Link>
            <Link
              role="menuitem"
              href={`/search/?fen=${encodeURIComponent(mt.fen)}&scope=mine`}
              className="block rounded-lg px-2.5 py-1.5 text-xs hover:bg-ivory/[0.07]"
            >
              …in my games
            </Link>
            {mainlinePath(mt.tree).length > 0 &&
              item("Find the novelty…", () => run(() => setDialog("novelty")), "first new move")}
            <Link
              role="menuitem"
              href={`/play/?fen=${encodeURIComponent(mt.fen)}`}
              className="block rounded-lg px-2.5 py-1.5 text-xs hover:bg-ivory/[0.07]"
            >
              Play from here against the computer
            </Link>
            {canLoad && item("Set up a position…", () => run(() => setDialog("setup")))}
            {canLoad && item("Paste FEN or PGN…", () => run(() => { setText(""); setDialog("paste"); }))}

            {canEdit && (
              <>
                <p className="eyebrow mt-1 border-t border-ivory/[0.06] px-2.5 pb-1 pt-2">Edit</p>
                {item("Delete moves after this one", () => run(mt.truncate))}
                {item("Merge games into this tree…", () =>
                  run(() => {
                    setText("");
                    setDialog("merge");
                  })
                )}
                {item("Remove all annotations", () =>
                  run(() => {
                    if (confirm("Remove every comment, glyph and drawing from this tree? The moves stay.")) {
                      mt.clearAnnotations();
                    }
                  })
                )}
              </>
            )}
          </div>
        </>
      )}

      {dialog && (
        // Out of the panel and into <body>: see Overlay for why it has to be.
        <Overlay>
        <div
          className="scrim fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
          onClick={() => setDialog(null)}
        >
          <div
            // The editor needs room for a board with a piece tray either side.
            className={`card-float my-auto w-full animate-fade space-y-3 p-5 ${
              dialog === "setup" ? "max-w-3xl" : "max-w-xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {dialog === "setup" && (
              <>
                <h2 className="font-semibold">Set up a position</h2>
                <BoardEditor
                  initialFen={mt.fen}
                  onCancel={() => setDialog(null)}
                  onDone={(fen) => {
                    mt.load(fen);
                    setDialog(null);
                  }}
                />
              </>
            )}

            {(dialog === "paste" || dialog === "merge") && (
              <>
                <h2 className="font-semibold">
                  {dialog === "paste" ? "Paste a FEN or a PGN" : "Merge games into this tree"}
                </h2>
                <p className="text-xs leading-relaxed text-muted">
                  {dialog === "paste"
                    ? "A FEN sets up that position on an empty board. A PGN loads the game with its variations and comments. This replaces what is on the board."
                    : "Every game in the PGN is played into this tree from the start: moves already here are reused, new ones become variations. Comments only fill gaps — nothing already written is overwritten. Games from a different start position are skipped."}
                </p>
                <textarea
                  className="input h-48 font-mono text-xs"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={dialog === "paste" ? "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" : '[Event "..."]\n\n1. e4 e5 2. Nf3 ...'}
                />
                <div className="flex items-center justify-end gap-2">
                  <button className="btn" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    disabled={!text.trim()}
                    onClick={() => {
                      if (dialog === "paste") {
                        if (mt.load(text)) setDialog(null);
                        else setNote("That is neither a FEN nor a PGN");
                      } else {
                        const n = mt.merge(splitPgnGames(text));
                        setNote(n ? `Merged ${n} game${n === 1 ? "" : "s"}` : "Nothing could be merged");
                        if (n) setDialog(null);
                      }
                    }}
                  >
                    {dialog === "paste" ? "Load" : "Merge"}
                  </button>
                </div>
              </>
            )}

            {dialog === "novelty" && (
              <NoveltyDialog mt={mt} canEdit={canEdit} gameId={gameId} onClose={() => setDialog(null)} />
            )}

            {dialog === "diagram" && (
              <DiagramDialog
                fen={mt.fen}
                orientation={orientation}
                shapes={mt.shapes}
                lastMove={mt.lastMove ?? null}
                light={light}
                dark={dark}
                name={name}
                onClose={() => setDialog(null)}
              />
            )}
          </div>
        </div>
        </Overlay>
      )}
    </div>
  );
}

function DiagramDialog({
  fen,
  orientation,
  shapes,
  lastMove,
  light,
  dark,
  name,
  onClose,
}: {
  fen: string;
  orientation: "white" | "black";
  shapes: MoveTreeApi["shapes"];
  lastMove: { from: string; to: string } | null;
  light?: string;
  dark?: string;
  name: string;
  onClose: () => void;
}) {
  const [caption, setCaption] = useState("");
  const [withShapes, setWithShapes] = useState(true);
  const [withLast, setWithLast] = useState(true);
  const [coords, setCoords] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const svg = diagramSvg(fen, {
    orientation,
    shapes: withShapes ? shapes : [],
    lastMove: withLast ? lastMove : null,
    light,
    dark,
    coordinates: coords,
    caption: caption.trim() || undefined,
  });

  async function save(format: "png" | "svg") {
    setError(null);
    try {
      await saveDiagram(svg, name, format);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The diagram could not be saved");
    }
  }

  return (
    <>
      <h2 className="font-semibold">Diagram</h2>
      <div
        className="mx-auto w-full max-w-sm overflow-hidden rounded-lg bg-white"
        // The SVG is generated here from the FEN, never from user markup; the
        // caption is escaped inside diagramSvg.
        dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg style="width:100%;height:auto" ') }}
      />
      <input
        className="input text-sm"
        placeholder="Caption (optional) — e.g. White to play and win"
        value={caption}
        maxLength={80}
        onChange={(e) => setCaption(e.target.value)}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={withShapes} onChange={(e) => setWithShapes(e.target.checked)} />
          Arrows and circles
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={withLast} onChange={(e) => setWithLast(e.target.checked)} />
          Last move
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={coords} onChange={(e) => setCoords(e.target.checked)} />
          Coordinates
        </label>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => save("svg")}>
          Save SVG
        </button>
        <button className="btn-primary" onClick={() => save("png")}>
          Save PNG
        </button>
      </div>
    </>
  );
}

/** "12." or "12..." for the move played from `fen`. */
function moveNumber(fen: string): string {
  const [, side, , , , full] = fen.split(" ");
  return `${full ?? "1"}${side === "b" ? "..." : "."}`;
}

/**
 * The first move of the game nobody in the database had played in its
 * position - ChessBase's novelty, the N glyph. Checked against the reference
 * database or your own games; the board's main line is the game.
 */
function NoveltyDialog({
  mt,
  canEdit,
  gameId,
  onClose,
}: {
  mt: MoveTreeApi;
  canEdit: boolean;
  gameId?: number;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<NoveltyScope>("reference");
  const [result, setResult] = useState<Novelty | null>(null);
  const [error, setError] = useState<string | null>(null);

  const line = mainlinePath(mt.tree);
  const startFen = nodeAt(mt.tree, mt.tree.root)?.fen ?? "";
  const key = line.map((n) => n.uci).join(" ");

  useEffect(() => {
    setResult(null);
    setError(null);
    api
      .findNovelty(startFen, key.split(" ").filter(Boolean), scope, gameId)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError ? err.message : "The novelty search could not be run"));
  }, [startFen, key, scope, gameId]);

  const where = scope === "mine" ? "your games" : "the reference database";
  const node: MoveNode | undefined = result?.ply != null ? line[result.ply] : undefined;
  const fenBefore = (ply: number) => (ply > 0 ? line[ply - 1].fen : startFen);
  const marked = node ? (node.nags ?? []).includes(146) : false;
  const lastChecked = result && result.checked_plies > 0 ? result.checked_plies - 1 : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Find the novelty</h2>
        <div className="seg ml-auto" role="group" aria-label="Which games to compare with">
          {(["reference", "mine"] as NoveltyScope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={`seg-item text-xs ${scope === s ? "seg-item-on" : ""}`}
            >
              {s === "reference" ? "Reference" : "My games"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}
      {!result && !error && <p className="text-sm text-muted">Comparing the game with {where}…</p>}

      {result?.status === "no_games" && (
        <p className="text-sm">
          {scope === "mine" ? "None of your other games starts" : "The reference database has no game starting"}{" "}
          from this position, so there is nothing to compare with.
          {scope === "reference" && (
            <button className="btn ml-2 px-2 py-0.5 text-xs" onClick={() => setScope("mine")}>
              Try my games
            </button>
          )}
        </p>
      )}

      {result?.status === "known" && (
        <p className="text-sm">
          Every move
          {lastChecked != null && line[lastChecked]
            ? ` through ${moveNumber(fenBefore(lastChecked))}${line[lastChecked].san}`
            : ""}{" "}
          has been played before in {where}. Only the first 20 moves of each game are indexed, so a later novelty
          is not visible here.
        </p>
      )}

      {result?.status === "novelty" && node && (
        <>
          <p className="text-sm">
            <span className="font-mono font-semibold text-accent">
              {moveNumber(fenBefore(result.ply ?? 0))}
              {result.san}
            </span>{" "}
            is new: {result.position_games} game{result.position_games === 1 ? "" : "s"} in {where} reached the
            position before it, and none played it.
          </p>
          {result.known_moves.length > 0 && (
            <div>
              <p className="eyebrow mb-1">Played there instead</p>
              <ul className="space-y-0.5 text-xs">
                {result.known_moves.map((m) => (
                  <li key={m.uci} className="flex items-baseline gap-2">
                    <span className="w-16 font-mono">{m.san}</span>
                    <span className="flex-1 text-muted">
                      {m.games} game{m.games === 1 ? "" : "s"}
                    </span>
                    <span className="font-mono text-muted">{m.score_pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        {node && canEdit && (
          <button className="btn" onClick={() => mt.toggleGlyph(node.id, 146)}>
            {marked ? "Remove N" : "Mark it N"}
          </button>
        )}
        {node && (
          <button
            className="btn-primary"
            onClick={() => {
              mt.seek(node.id);
              onClose();
            }}
          >
            Go to the move
          </button>
        )}
      </div>
    </>
  );
}
