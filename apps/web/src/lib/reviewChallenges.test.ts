import { describe, expect, it } from "vitest";
import { GameDetail } from "@/lib/api";
import { reviewChallenges } from "@/lib/reviewChallenges";

const game: GameDetail = {
  id: 1, variant: "standard", start_fen: null, white: "White", black: "Black", white_elo: null, black_elo: null,
  result: "*", event: "", played_on: null, eco: null, opening: null,
  ply_count: 2, movetext: "1. e4 e5 *",
  annotations: [{
    ply: 1, nag: 2, comment: null, eval_cp: 0, best_uci: "c7c5",
    move_uci: "e7e5", move_san: "e5", classification: "mistake",
    review: "Try the Sicilian.",
  }],
};

describe("reviewChallenges", () => {
  it("builds the position before an aligned mistake", () => {
    const [challenge] = reviewChallenges(game);
    expect(challenge.bestSan).toBe("c5");
    expect(challenge.playedSan).toBe("e5");
    expect(challenge.fen.split(" ")[1]).toBe("b");
  });

  it("does not quiz against mismatched or incomplete game reviews", () => {
    expect(reviewChallenges({ ...game, variant: "chess960" })).toEqual([]);
    expect(reviewChallenges({ ...game, ply_count: 3 })).toEqual([]);
    expect(reviewChallenges({ ...game, annotations: [{ ...game.annotations[0], move_uci: "e7e6" }] })).toEqual([]);
    expect(reviewChallenges({ ...game, annotations: [{ ...game.annotations[0], best_uci: "a1a8" }] })).toEqual([]);
  });
});
