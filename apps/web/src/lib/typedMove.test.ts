import { describe, expect, it } from "vitest";
import { typedMoveSan } from "@/lib/typedMove";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("typed moves", () => {
  it("reads SAN, lower-case SAN and UCI", () => {
    expect(typedMoveSan(START, "e4")).toBe("e4");
    expect(typedMoveSan(START, "Nf3")).toBe("Nf3");
    expect(typedMoveSan(START, " nf3 ")).toBe("Nf3");
    expect(typedMoveSan(START, "g1f3")).toBe("Nf3");
    expect(typedMoveSan(START, "Nf3!?")).toBe("Nf3");
  });

  it("rejects illegal, empty and nonsense input", () => {
    expect(typedMoveSan(START, "e5")).toBeNull();
    expect(typedMoveSan(START, "")).toBeNull();
    expect(typedMoveSan(START, "hello")).toBeNull();
    expect(typedMoveSan("not a fen", "e4")).toBeNull();
  });

  it("lets case tell a pawn capture from a bishop move", () => {
    // White: bishop on f1 and pawn on b3 can both reach c4 (black pawn there).
    const fen = "4k3/8/8/8/2p5/1P6/8/4KB2 w - - 0 1";
    expect(typedMoveSan(fen, "bxc4")).toBe("bxc4");
    expect(typedMoveSan(fen, "bc4")).toBe("bxc4");
    expect(typedMoveSan(fen, "Bxc4")).toBe("Bxc4");
    expect(typedMoveSan(fen, "Bc4")).toBe("Bxc4");
  });

  it("reads castling with zeros or letters", () => {
    const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
    expect(typedMoveSan(fen, "O-O")).toBe("O-O");
    expect(typedMoveSan(fen, "0-0")).toBe("O-O");
    expect(typedMoveSan(fen, "o-o")).toBe("O-O");
  });

  it("needs the piece for a promotion", () => {
    const fen = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
    expect(typedMoveSan(fen, "e8=N")).toBe("e8=N");
    expect(typedMoveSan(fen, "e8q")).toBe("e8=Q");
    expect(typedMoveSan(fen, "e7e8r")).toBe("e8=R");
    expect(typedMoveSan(fen, "e8")).toBeNull();
  });

  it("refuses a move that names two pieces", () => {
    // Knights on b1 and f1 both reach d2.
    const fen = "4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1";
    expect(typedMoveSan(fen, "Nd2")).toBeNull();
    expect(typedMoveSan(fen, "Nbd2")).toBe("Nbd2");
  });
});
