"use client";

import { useMemo } from "react";
import { Chess } from "chess.js";
import { formatEval } from "@/hooks/useEngine";
import type { EvalLine } from "@/lib/api";

interface Props {
  lines: EvalLine[];
  /** The position the lines were found in - what turns UCI into readable SAN. */
  fen: string;
  depth: number;
  connected: boolean;
  thinking: boolean;
  error: string | null;
  autoAnalyse: boolean;
  onToggleAuto: (on: boolean) => void;
  /** Put a line on the board as a variation, starting from this position. */
  onPlayLine: (sans: string[], evalCp: number | null) => void;
}

/** How much of a candidate line is worth showing in a panel this narrow. */
const PV_PLIES = 8;

/**
 * Stockfish speaks UCI, which reads like a serial number: "e2e4 e7e5 g1f3".
 * Replaying it through the position gives back the notation a player actually
 * thinks in - and gives back the SAN the move tree needs to accept the line,
 * so the same conversion pays for the display and the click.
 */
function readable(fen: string, pv: string[]): { san: string; num?: string }[] {
  const g = new Chess(fen);
  const whiteFirst = fen.split(" ")[1] === "w";
  const firstNo = parseInt(fen.split(" ")[5] ?? "1", 10) || 1;
  const out: { san: string; num?: string }[] = [];

  pv.slice(0, PV_PLIES).forEach((uci, i) => {
    let mv;
    try {
      mv = g.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined,
      });
    } catch {
      return;
    }
    if (!mv) return;
    const white = whiteFirst ? i % 2 === 0 : i % 2 === 1;
    const no = firstNo + Math.floor((i + (whiteFirst ? 0 : 1)) / 2);
    out.push({ san: mv.san, num: white ? `${no}.` : i === 0 ? `${no}...` : undefined });
  });
  return out;
}

/** Live engine lines: the top candidate moves for the position on the board. */
export default function EnginePane({
  lines,
  fen,
  depth,
  connected,
  thinking,
  error,
  autoAnalyse,
  onToggleAuto,
  onPlayLine,
}: Props) {
  const readableLines = useMemo(
    () => lines.map((line) => ({ line, moves: readable(fen, line.pv) })),
    [lines, fen]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          {connected && thinking && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2/70" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              connected ? "bg-accent2" : "bg-bad"
            }`}
          />
        </span>
        <span className="text-xs text-muted">
          {connected ? (thinking ? "Thinking…" : "Ready") : "Reconnecting…"}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted">depth {depth}</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={autoAnalyse}
            onChange={(e) => onToggleAuto(e.target.checked)}
          />
          Auto
        </label>
      </div>

      {error && <p className="text-xs text-bad">{error}</p>}

      <ol className="space-y-1">
        {readableLines.map(({ line, moves }, i) => (
          <li key={line.multipv}>
            {/* The whole line goes on at once. A candidate you have to click
                eight times to see is a candidate nobody explores. */}
            <button
              onClick={() => onPlayLine(moves.map((m) => m.san), line.cp)}
              disabled={moves.length === 0}
              title="Put this line on the board"
              className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left
                         transition-colors hover:bg-ink/[0.07] disabled:hover:bg-transparent"
            >
              <span
                className={`w-12 shrink-0 font-mono text-xs font-semibold ${
                  i === 0 ? "text-accent2" : "text-muted"
                }`}
              >
                {formatEval(line)}
              </span>
              <span className="truncate font-mono text-xs text-ink/70">
                {moves.map((m) => (m.num ? `${m.num} ${m.san}` : m.san)).join(" ")}
              </span>
            </button>
          </li>
        ))}
        {lines.length === 0 && (
          <li className="px-1.5 py-1 text-xs text-muted">
            {connected ? "Analysing…" : "Waiting for the engine."}
          </li>
        )}
      </ol>
    </div>
  );
}
