import { describe, expect, it } from "vitest";
import {
  EMPTY_FEN,
  START_FEN as EDITOR_START,
  enPassantSquares,
  parseFen,
  positionProblem,
  swapColours,
  toFen,
} from "@/lib/boardEditor";
import { chapterName, chapterTags, chaptersFromPgn, mergedChapter } from "@/lib/chapterImport";
import { diagramSvg } from "@/lib/diagram";
import { judge, movesFound, movesToFind } from "@/lib/lesson";
import {
  addMove,
  createTree,
  mainlinePath,
  mergeTree,
  nodeAt,
  stripAnnotations,
  truncateAfter,
} from "@/lib/moveTree";
import { parsePgn, splitPgnGames, toMovetext, toPgn } from "@/lib/pgn";
import { deserializeTree, serializeTree } from "@/lib/treeStorage";

const body = (pgn: string) => pgn.split("\n\n")[1].trim();

describe("glyphs in PGN", () => {
  it("keeps a move mark and position/observation glyphs apart", () => {
    const { tree } = parsePgn("1. e4 $1 $14 $36 e5 $7");
    const [e4, e5] = mainlinePath(tree);
    expect(e4.nag).toBe(1);
    expect(e4.nags).toEqual([14, 36]);
    expect(e5.nag).toBe(7);
  });

  it("writes them back: suffix where one exists, $n otherwise", () => {
    const out = body(toPgn(parsePgn("1. e4! $14 $36 e5 $7 2. Nf3 $22").tree));
    expect(out).toBe("1. e4! $14 $36 e5 $7 2. Nf3 $22 *");
  });

  it("survives the local tree store", () => {
    const { tree } = parsePgn("1. e4 $16 $146 e5");
    const back = deserializeTree(serializeTree(tree, 0)).tree;
    expect(mainlinePath(back)[0].nags).toEqual([16, 146]);
  });
});

describe("splitPgnGames", () => {
  it("splits a multi-game file at each tag section after movetext", () => {
    const text = `[Event "A"]\n[White "x"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *\n`;
    const games = splitPgnGames(text);
    expect(games).toHaveLength(2);
    expect(parsePgn(games[1]).headers.Event).toBe("B");
  });

  it("does not split on a tag-looking line inside a comment", () => {
    const text = `[Event "A"]\n\n1. e4 {a note that runs on\n[Event "not a tag"] and closes} e5 *`;
    expect(splitPgnGames(text)).toHaveLength(1);
  });

  it("handles Windows line endings and bare movetext", () => {
    expect(splitPgnGames("1. e4 e5 *\r\n")).toEqual(["1. e4 e5 *"]);
  });
});

describe("tree editing", () => {
  it("merges another game's moves in as variations without duplicating shared ones", () => {
    const a = { ...parsePgn("1. e4 e5 2. Nf3 Nc6").tree, locked: false };
    const b = parsePgn("1. e4 c5 2. Nf3 {Sicilian} d6").tree;
    const merged = mergeTree(a, b);
    const e4 = mainlinePath(merged)[0];
    expect(e4.children).toHaveLength(2);
    const c5 = nodeAt(merged, e4.children[1])!;
    expect(c5.san).toBe("c5");
    const nf3 = nodeAt(merged, c5.children[0])!;
    expect(nf3.comment).toBe("Sicilian");
    // Main line untouched.
    expect(mainlinePath(merged).map((n) => n.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("refuses a game from another start position", () => {
    const a = parsePgn("1. e4 e5").tree;
    const b = createTree("8/8/8/4k3/8/8/4P3/4K3 w - - 0 1");
    const b2 = addMove(b, 0, "e4").tree;
    expect(mergeTree(a, b2)).toBe(a);
  });

  it("truncates after a position and strips annotations", () => {
    const t = { ...parsePgn("1. e4 {x} e5 $2 2. Nf3 (2. Bc4) Nc6").tree, locked: false };
    const e5 = mainlinePath(t)[1];
    const cut = truncateAfter(t, e5.id);
    expect(mainlinePath(cut).map((n) => n.san)).toEqual(["e4", "e5"]);
    const bare = stripAnnotations(t);
    expect([...bare.nodes.values()].some((n) => n.comment || n.nag != null)).toBe(false);
  });

  it("remembers a set-up start position across a reload", () => {
    const fen = "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1";
    const t = addMove(createTree(fen), 0, "e4").tree;
    const back = deserializeTree(serializeTree(t, 1)).tree;
    expect(nodeAt(back, back.root)!.fen).toBe(fen);
    expect(mainlinePath(back)[0].san).toBe("e4");
  });
});

describe("board editor", () => {
  it("round-trips a FEN", () => {
    const fen = "r3k2r/pppq1ppp/2n2n2/3pp3/3PP3/2N2N2/PPPQ1PPP/R3K2R w KQkq - 4 9";
    expect(toFen(parseFen(fen))).toBe(fen);
  });

  it("drops castling rights the placement cannot honour", () => {
    const s = parseFen(EDITOR_START);
    delete s.placement.h1; // the king's rook is gone
    expect(toFen(s).split(" ")[2]).toBe("Qkq");
  });

  it("offers only en passant squares a pawn could really be taken on", () => {
    const s = parseFen("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1");
    expect(enPassantSquares(s.placement, "w")).toEqual(["d6"]);
    expect(toFen({ ...s, enPassant: "d6" }).split(" ")[3]).toBe("d6");
    expect(toFen({ ...s, enPassant: "f6" }).split(" ")[3]).toBe("-");
  });

  it("says what is wrong with an impossible position", () => {
    expect(positionProblem(EMPTY_FEN)).toMatch(/king/i);
    expect(positionProblem("4k3/8/8/8/8/8/P7/4K3 w - - 0 1")).toBeNull();
    expect(positionProblem("P3k3/8/8/8/8/8/8/4K3 w - - 0 1")).toMatch(/pawn/i);
    // Black in check with White to move.
    expect(positionProblem("4k3/8/8/8/8/8/8/4KR2 w - - 0 1")).toBeNull();
    expect(positionProblem("4k3/4R3/8/8/8/8/8/4K3 w - - 0 1")).toMatch(/check/i);
  });

  it("swaps colours by mirroring the board", () => {
    const s = swapColours(parseFen("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"));
    expect(toFen(s)).toBe("4k3/4p3/8/8/8/8/8/4K3 b - - 0 1");
  });
});

describe("chapter import", () => {
  const two = `[Event "Club"]\n[White "Ann"]\n[Black "Bo"]\n[Result "1-0"]\n[Date "????.??.??"]\n\n1. e4 e5 1-0\n\n` +
    `[Event "Endgame"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n[Orientation "black"]\n[ChapterMode "lesson"]\n\n1. e4 *`;

  it("makes one chapter per game, named and tagged from its headers", () => {
    const drafts = chaptersFromPgn(two);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].name).toBe("Ann – Bo");
    expect(drafts[0].tags).toEqual({ Event: "Club", White: "Ann", Black: "Bo", Result: "1-0" });
    expect(drafts[0].starting_fen).toBeUndefined();
    expect(drafts[1].name).toBe("Endgame");
    expect(drafts[1].starting_fen).toBe("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
    expect(drafts[1].orientation).toBe("black");
    expect(drafts[1].mode).toBe("lesson");
    expect(drafts[1].tags).not.toHaveProperty("FEN");
  });

  it("keeps variations and comments in the stored movetext", () => {
    const [d] = chaptersFromPgn("1. e4 {best} e5 (1... c5 $1) 2. Nf3 *");
    expect(d.pgn).toBe(toMovetext(parsePgn("1. e4 {best} e5 (1... c5 $1) 2. Nf3").tree));
    expect(d.pgn).toContain("(1... c5!)");
  });

  it("names a chapter with nothing to go on by its number", () => {
    expect(chapterName({ White: "?", Black: "?" }, 2)).toBe("Chapter 3");
    expect(chapterTags({ Event: "?", Site: "x", "bad key": "y" })).toEqual({ Site: "x" });
  });

  it("merges games into one tree, skipping one from another start", () => {
    const { draft, merged, skipped } = mergedChapter(
      ["1. e4 e5 2. Nf3", "1. e4 c5", "1. d4 d5", `[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4`],
      "Tree"
    );
    expect(merged).toBe(3);
    expect(skipped).toBe(1);
    const tree = parsePgn(draft!.pgn ?? "").tree;
    expect(nodeAt(tree, tree.root)!.children).toHaveLength(2); // e4, d4
  });
});

describe("lessons", () => {
  const tree = parsePgn("1. e4 e5 2. Nf3 {develops with tempo} (2. Qh5 {too early}) Nc6 3. Bb5").tree;

  it("judges the main-line move correct, a side line refuted, anything else unknown", () => {
    const e5 = mainlinePath(tree)[1];
    const right = judge(tree, e5.id, "Nf3");
    expect(right.kind).toBe("correct");
    expect(right.kind === "correct" && right.explanation).toBe("develops with tempo");
    const wrong = judge(tree, e5.id, "Qh5");
    expect(wrong.kind === "refuted" && wrong.explanation).toBe("too early");
    expect(judge(tree, e5.id, "Bc4").kind).toBe("unknown");
    expect(judge(tree, mainlinePath(tree)[4].id, "a6").kind).toBe("over");
  });

  it("counts the moves the reader has to find, for their side only", () => {
    expect(movesToFind(tree, "w")).toBe(3);
    expect(movesToFind(tree, "b")).toBe(2);
    expect(movesFound(tree, mainlinePath(tree)[2].id, "w")).toBe(2);
  });
});

describe("diagram", () => {
  it("draws every piece and every arrow", () => {
    const svg = diagramSvg(EDITOR_START, {
      shapes: [{ from: "e2", to: "e4", brush: "green" }, { from: "d4", brush: "red" }],
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<text[^>]*>[♚-♟]/g) ?? []).length).toBe(32);
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<circle");
  });

  it("escapes a caption", () => {
    expect(diagramSvg(EDITOR_START, { caption: "<b>&" })).toContain("&#60;b&#62;&#38;");
  });
});
