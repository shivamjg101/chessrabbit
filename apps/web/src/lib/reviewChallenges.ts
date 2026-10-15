import { Chess } from "chess.js";
import { GameDetail } from "@/lib/api";
import { mainlinePath, nodeAt } from "@/lib/moveTree";
import { parsePgn } from "@/lib/pgn";

export interface ReviewChallenge {
  ply: number;
  fen: string;
  playedSan: string;
  bestSan: string;
  bestUci: string;
  classification: "inaccuracy" | "mistake" | "blunder";
  explanation: string | null;
}

/** Use only review rows that match the imported game's actual main line. */
export function reviewChallenges(game: GameDetail): ReviewChallenge[] {
  if (game.variant !== "standard") return [];
  const tree = parsePgn(game.movetext).tree;
  const moves = mainlinePath(tree);
  if (moves.length !== game.ply_count) return [];

  const challenges: ReviewChallenge[] = [];
  for (const annotation of game.annotations) {
    if (
      annotation.classification !== "inaccuracy" &&
      annotation.classification !== "mistake" &&
      annotation.classification !== "blunder"
    ) continue;
    const move = moves[annotation.ply];
    if (!move || !annotation.best_uci ||
        (annotation.move_uci && annotation.move_uci !== move.uci)) continue;
    const before = nodeAt(tree, move.parent ?? tree.root);
    if (!before) continue;
    try {
      const board = new Chess(before.fen);
      const uci = annotation.best_uci;
      const best = board.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] ?? "q",
      });
      if (!best) continue;
      challenges.push({
        ply: annotation.ply,
        fen: before.fen,
        playedSan: move.san,
        bestSan: best.san,
        bestUci: uci,
        classification: annotation.classification,
        explanation: annotation.review,
      });
    } catch {
      // Old or stale annotations can contain a move that is not legal here.
    }
  }
  return challenges.sort((a, b) => a.ply - b.ply);
}
