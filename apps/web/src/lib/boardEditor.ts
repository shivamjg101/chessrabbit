import { Chess, validateFen } from "chess.js";

/**
 * Setting up a position by hand - ChessBase's "Setup position", Lichess's
 * board editor - as pure functions over a FEN's six fields.
 *
 * The editor UI holds an `EditorState`, lets you push pieces around it, and
 * only ever turns it back into a FEN through `toFen`, which is the one place
 * that decides what castling and en passant rights the placement can still
 * honour. A right the placement cannot support (a king off e1, a rook gone
 * from h8, an en passant square with no pawn that could have just made the
 * double step) is dropped there rather than refused, because nobody setting
 * up a study position wants to be told about castling rights before they
 * have finished putting the pieces down.
 */

export type PieceCode =
  | "wP" | "wN" | "wB" | "wR" | "wQ" | "wK"
  | "bP" | "bN" | "bB" | "bR" | "bQ" | "bK";

export type Placement = Partial<Record<string, PieceCode>>;

export interface EditorState {
  placement: Placement;
  turn: "w" | "b";
  /** Which of K, Q, k, q the author wants, before the placement has its say. */
  castling: { K: boolean; Q: boolean; k: boolean; q: boolean };
  /** "-" or a square on rank 3 / 6. */
  enPassant: string;
  halfmove: number;
  fullmove: number;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const EMPTY_FEN = "8/8/8/8/8/8/8/8 w - - 0 1";

const FILES = "abcdefgh";

const LETTER: Record<PieceCode, string> = {
  wP: "P", wN: "N", wB: "B", wR: "R", wQ: "Q", wK: "K",
  bP: "p", bN: "n", bB: "b", bR: "r", bQ: "q", bK: "k",
};
const CODE: Record<string, PieceCode> = Object.fromEntries(
  Object.entries(LETTER).map(([code, letter]) => [letter, code as PieceCode])
);

/** Read a FEN into an editor state. Lenient: missing fields take defaults. */
export function parseFen(fen: string): EditorState {
  const [board = "", turn = "w", castle = "-", ep = "-", half = "0", full = "1"] = fen
    .trim()
    .split(/\s+/);
  const placement: Placement = {};
  board.split("/").forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else if (CODE[ch] && file < 8 && r < 8) {
        placement[`${FILES[file]}${8 - r}`] = CODE[ch];
        file++;
      }
    }
  });
  return {
    placement,
    turn: turn === "b" ? "b" : "w",
    castling: {
      K: castle.includes("K"),
      Q: castle.includes("Q"),
      k: castle.includes("k"),
      q: castle.includes("q"),
    },
    enPassant: /^[a-h][36]$/.test(ep) ? ep : "-",
    halfmove: Math.max(0, parseInt(half, 10) || 0),
    fullmove: Math.max(1, parseInt(full, 10) || 1),
  };
}

export function placementString(placement: Placement): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let gap = 0;
    for (const f of FILES) {
      const p = placement[`${f}${rank}`];
      if (p) {
        if (gap) row += gap;
        gap = 0;
        row += LETTER[p];
      } else {
        gap++;
      }
    }
    if (gap) row += gap;
    rows.push(row);
  }
  return rows.join("/");
}

/** The castling rights the placement can actually support right now. */
export function possibleCastling(placement: Placement): EditorState["castling"] {
  return {
    K: placement.e1 === "wK" && placement.h1 === "wR",
    Q: placement.e1 === "wK" && placement.a1 === "wR",
    k: placement.e8 === "bK" && placement.h8 === "bR",
    q: placement.e8 === "bK" && placement.a8 === "bR",
  };
}

/**
 * Squares a pawn could be captured on en passant, given whose move it is: the
 * square behind an enemy pawn on its fourth rank, with the two squares it
 * crossed empty.
 */
export function enPassantSquares(placement: Placement, turn: "w" | "b"): string[] {
  const out: string[] = [];
  // White to move means Black just pushed two: pawn on rank 5, target rank 6.
  const [pawn, pawnRank, targetRank, fromRank] =
    turn === "w" ? (["bP", 5, 6, 7] as const) : (["wP", 4, 3, 2] as const);
  for (const f of FILES) {
    if (
      placement[`${f}${pawnRank}`] === pawn &&
      !placement[`${f}${targetRank}`] &&
      !placement[`${f}${fromRank}`]
    ) {
      out.push(`${f}${targetRank}`);
    }
  }
  return out;
}

export function toFen(state: EditorState): string {
  const can = possibleCastling(state.placement);
  const rights =
    (["K", "Q", "k", "q"] as const).filter((k) => state.castling[k] && can[k]).join("") || "-";
  const ep = enPassantSquares(state.placement, state.turn).includes(state.enPassant)
    ? state.enPassant
    : "-";
  return [
    placementString(state.placement),
    state.turn,
    rights,
    ep,
    String(state.halfmove),
    String(state.fullmove),
  ].join(" ");
}

/**
 * Why this position cannot be played from, or null when it can.
 *
 * chess.js checks the FEN's shape and the king count. The rest are the
 * mistakes people actually make when setting up a diagram by hand, in words
 * that say which square to fix.
 */
export function positionProblem(fen: string): string | null {
  const state = parseFen(fen);
  const pieces = Object.entries(state.placement);
  const count = (code: PieceCode) => pieces.filter(([, p]) => p === code).length;

  if (count("wK") !== 1) return count("wK") ? "White has more than one king." : "White needs a king.";
  if (count("bK") !== 1) return count("bK") ? "Black has more than one king." : "Black needs a king.";

  for (const [square, p] of pieces) {
    if ((p === "wP" || p === "bP") && (square[1] === "1" || square[1] === "8")) {
      return `A pawn cannot stand on ${square}.`;
    }
  }
  if (count("wP") > 8 || count("bP") > 8) return "A side cannot have more than eight pawns.";

  const shape = validateFen(fen);
  if (!shape.ok) return shape.error ?? "That is not a valid position.";

  // The side not to move must not be in check: it would mean the side to move
  // could take the king.
  try {
    const flipped = fen.split(" ");
    flipped[1] = flipped[1] === "w" ? "b" : "w";
    flipped[3] = "-";
    if (new Chess(flipped.join(" ")).inCheck()) {
      return `${state.turn === "w" ? "Black" : "White"} is in check, but it is not their move.`;
    }
  } catch {
    return "That is not a valid position.";
  }
  return null;
}

/** Mirror the position top to bottom and swap the colours - "same position, other side". */
export function swapColours(state: EditorState): EditorState {
  const placement: Placement = {};
  for (const [square, p] of Object.entries(state.placement)) {
    if (!p) continue;
    const mirrored = `${square[0]}${9 - Number(square[1])}`;
    placement[mirrored] = ((p[0] === "w" ? "b" : "w") + p[1]) as PieceCode;
  }
  return {
    ...state,
    placement,
    turn: state.turn === "w" ? "b" : "w",
    castling: { K: state.castling.k, Q: state.castling.q, k: state.castling.K, q: state.castling.Q },
    enPassant: "-",
  };
}
