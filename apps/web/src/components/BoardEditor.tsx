"use client";

import { useEffect, useMemo, useState } from "react";
import { Chessboard, ChessboardDnDProvider, SparePiece } from "react-chessboard";
import { useBoardTheme } from "@/lib/boardTheme";
import {
  EMPTY_FEN,
  EditorState,
  PieceCode,
  START_FEN,
  enPassantSquares,
  parseFen,
  positionProblem,
  possibleCastling,
  swapColours,
  toFen,
} from "@/lib/boardEditor";

/**
 * Set up a position by hand.
 *
 * Pieces come off the trays either side of the board by drag, or by click:
 * pick a piece (or the eraser) and every square you click gets it. Clicking
 * works on a phone, where a drag out of a tray is fiddly; dragging is what a
 * mouse wants. Pieces already on the board drag between squares freely, and
 * off the board to remove them.
 *
 * The FEN box under the board is live in both directions: edit the board and
 * it changes, paste a FEN and the board follows - as soon as what is in the
 * box parses.
 */

const WHITE: PieceCode[] = ["wK", "wQ", "wR", "wB", "wN", "wP"];
const BLACK: PieceCode[] = ["bK", "bQ", "bR", "bB", "bN", "bP"];

/** The board's id, which the trays name so the drag layer knows where they drop. */
const DND_ID = "position-editor";

type Tool = PieceCode | "erase" | null;

interface Props {
  initialFen?: string;
  /** What the confirm button says - "Use this position", "Create chapter". */
  doneLabel?: string;
  onDone: (fen: string) => void;
  onCancel?: () => void;
  /** Board width in px; the trays are sized from it. */
  size?: number;
}

export default function BoardEditor({
  initialFen,
  doneLabel = "Use this position",
  onDone,
  onCancel,
  size = 336,
}: Props) {
  const skin = useBoardTheme();
  const [state, setState] = useState<EditorState>(() => parseFen(initialFen || START_FEN));
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tool, setTool] = useState<Tool>(null);
  const fen = useMemo(() => toFen(state), [state]);
  const [fenText, setFenText] = useState(fen);

  // Board changes write the box; the box writes the board only once it reads.
  useEffect(() => setFenText(fen), [fen]);

  const problem = useMemo(() => positionProblem(fen), [fen]);
  const canCastle = possibleCastling(state.placement);
  const epOptions = enPassantSquares(state.placement, state.turn);

  const place = (square: string, piece: PieceCode | null) =>
    setState((s) => {
      const placement = { ...s.placement };
      if (piece) placement[square] = piece;
      else delete placement[square];
      return { ...s, placement };
    });

  function onSquareClick(square: string) {
    if (tool === "erase") place(square, null);
    else if (tool) {
      // Clicking a square that already holds the selected piece takes it
      // off again, so a misclick is undone by the same click.
      place(square, state.placement[square] === tool ? null : tool);
    }
  }

  function onPieceDrop(from: string, to: string, piece: string) {
    setState((s) => {
      const placement = { ...s.placement };
      delete placement[from];
      placement[to] = piece as PieceCode;
      return { ...s, placement };
    });
    return true;
  }

  function onSparePieceDrop(piece: string, square: string) {
    place(square, piece as PieceCode);
    return true;
  }

  function onFenText(text: string) {
    setFenText(text);
    const parsed = parseFen(text);
    // Only adopt a FEN whose placement parsed into something; half-typed text
    // stays in the box without blanking the board under it.
    if (text.trim().split(/\s+/)[0]?.split("/").length === 8) setState(parsed);
  }

  const tray = (pieces: PieceCode[]) => (
    <div className="flex gap-1 sm:flex-col">
      {pieces.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setTool((t) => (t === p ? null : p))}
          aria-pressed={tool === p}
          title="Drag onto the board, or select and click squares"
          className={`rounded-lg p-0.5 transition-colors ${
            tool === p ? "bg-brass/25 ring-1 ring-brass" : "hover:bg-ivory/10"
          }`}
        >
          <SparePiece piece={p} width={Math.round(size / 9)} dndId={DND_ID} />
        </button>
      ))}
    </div>
  );

  return (
    // `context={window}` is what lets this editor open over another board.
    // Every <Chessboard> keys its drag-and-drop manager on `window`, so they
    // all share one; without the same key this provider would start a second
    // HTML5 backend beside the board underneath, which react-dnd refuses
    // with "Cannot have two HTML5 backends at the same time".
    <ChessboardDnDProvider context={typeof window === "undefined" ? undefined : window}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start">
          {tray(orientation === "white" ? BLACK : WHITE)}
          <div style={{ width: size }} className="shrink-0">
            <Chessboard
              id={DND_ID}
              position={state.placement}
              boardWidth={size}
              boardOrientation={orientation}
              arePiecesDraggable
              onPieceDrop={onPieceDrop}
              onSparePieceDrop={onSparePieceDrop}
              onSquareClick={(sq) => onSquareClick(sq)}
              onSquareRightClick={(sq) => place(sq, null)}
              dropOffBoardAction="trash"
              animationDuration={0}
              areArrowsAllowed={false}
              {...skin.props}
            />
          </div>
          {tray(orientation === "white" ? WHITE : BLACK)}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setTool((t) => (t === "erase" ? null : "erase"))}
            aria-pressed={tool === "erase"}
            className={`btn px-2 py-1 text-xs ${tool === "erase" ? "ring-1 ring-bad text-bad" : ""}`}
          >
            ⌫ Eraser
          </button>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setState(parseFen(START_FEN))}>
            Start position
          </button>
          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setState(parseFen(EMPTY_FEN))}>
            Clear
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          >
            ⟳ Flip
          </button>
          <button
            type="button"
            className="btn px-2 py-1 text-xs"
            title="Mirror the position and swap the colours"
            onClick={() => setState((s) => swapColours(s))}
          >
            ⇅ Swap colours
          </button>
        </div>

        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <p className="eyebrow mb-1">To move</p>
            <div className="seg">
              {(["w", "b"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, turn: t, enPassant: "-" }))}
                  className={`seg-item ${state.turn === t ? "seg-item-on" : ""}`}
                >
                  {t === "w" ? "White" : "Black"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-1">Castling</p>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {(
                [
                  ["K", "White O-O"],
                  ["Q", "White O-O-O"],
                  ["k", "Black O-O"],
                  ["q", "Black O-O-O"],
                ] as const
              ).map(([k, label]) => (
                <label
                  key={k}
                  className={`flex items-center gap-1 ${canCastle[k] ? "" : "opacity-40"}`}
                  title={canCastle[k] ? label : `${label}: king or rook is not on its home square`}
                >
                  <input
                    type="checkbox"
                    disabled={!canCastle[k]}
                    checked={state.castling[k] && canCastle[k]}
                    onChange={(e) =>
                      setState((s) => ({ ...s, castling: { ...s.castling, [k]: e.target.checked } }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <label className="flex-1">
              <span className="eyebrow mb-1 block">En passant</span>
              <select
                className="input py-1 text-xs"
                value={epOptions.includes(state.enPassant) ? state.enPassant : "-"}
                onChange={(e) => setState((s) => ({ ...s, enPassant: e.target.value }))}
                disabled={epOptions.length === 0}
              >
                <option value="-">None</option>
                {epOptions.map((sq) => (
                  <option key={sq} value={sq}>
                    {sq}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-16">
              <span className="eyebrow mb-1 block">Move</span>
              <input
                type="number"
                min={1}
                className="input py-1 text-xs"
                value={state.fullmove}
                onChange={(e) =>
                  setState((s) => ({ ...s, fullmove: Math.max(1, parseInt(e.target.value, 10) || 1) }))
                }
              />
            </label>
          </div>
        </div>

        <label className="block">
          <span className="eyebrow mb-1 block">FEN</span>
          <input
            className="input font-mono text-[11px]"
            value={fenText}
            spellCheck={false}
            onChange={(e) => onFenText(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2">
          <p className={`min-w-0 flex-1 text-xs ${problem ? "text-bad" : "text-muted"}`}>
            {problem ?? "Legal position."}
          </p>
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!!problem}
            onClick={() => onDone(fen)}
          >
            {doneLabel}
          </button>
        </div>
      </div>
    </ChessboardDnDProvider>
  );
}
