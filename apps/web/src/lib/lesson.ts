import { MoveNode, MoveTree, NodeId, mainlinePath, nodeAt } from "@/lib/moveTree";
import { splitComment } from "@/lib/shapes";

/**
 * The rules of an interactive lesson - Lichess's "gamebook" - over an ordinary
 * chapter tree, so an author writes one the same way they write any chapter.
 *
 *   - The reader plays the side the chapter is read from.
 *   - The main line is the answer. Finding its next move moves the lesson on,
 *     and the author's comment on that move is the explanation.
 *   - A side line from the same position is a wrong answer the author saw
 *     coming; its comment says why it fails. The move is taken back.
 *   - Any other move is simply not it.
 *   - The other side's moves are played automatically: the main line's reply,
 *     with its comment as the next prompt.
 *
 * No new storage and no new format: a lesson is a chapter with mode
 * "lesson", and exports as the plain annotated PGN it is.
 */

export type Side = "w" | "b";

export type Attempt =
  /** The main-line move: the lesson moves on to it. */
  | { kind: "correct"; node: MoveNode; explanation: string }
  /** A side line the author wrote: a known wrong answer, with the reason. */
  | { kind: "refuted"; node: MoveNode; explanation: string }
  /** A move the author did not consider. */
  | { kind: "unknown" }
  /** Nothing left to find. */
  | { kind: "over" };

/** The prose of a node's comment, drawings taken out. */
export function prose(node?: MoveNode): string {
  return node ? splitComment(node.comment).text : "";
}

export function sideToMove(node: MoveNode): Side {
  return node.fen.split(" ")[1] === "b" ? "b" : "w";
}

/** What the lesson wants played from here, if anything. */
export function expected(tree: MoveTree, at: NodeId): MoveNode | undefined {
  const n = nodeAt(tree, at);
  return n?.children.length ? nodeAt(tree, n.children[0]) : undefined;
}

/** Judge a move the reader played from `at`, given as SAN. */
export function judge(tree: MoveTree, at: NodeId, san: string): Attempt {
  const n = nodeAt(tree, at);
  if (!n || n.children.length === 0) return { kind: "over" };
  const [main, ...others] = n.children.map((id) => nodeAt(tree, id)!);
  if (main.san === san) return { kind: "correct", node: main, explanation: prose(main) };
  const known = others.find((o) => o.san === san);
  if (known) return { kind: "refuted", node: known, explanation: prose(known) };
  return { kind: "unknown" };
}

/** How many moves the reader has to find over the whole main line. */
export function movesToFind(tree: MoveTree, side: Side): number {
  return mainlinePath(tree).filter((n) => n.ply % 2 === (rootSide(tree) === side ? 0 : 1)).length;
}

/** How many of them lie before `at` on the main line - the reader's progress. */
export function movesFound(tree: MoveTree, at: NodeId, side: Side): number {
  const n = nodeAt(tree, at);
  if (!n || !n.mainline) return 0;
  return mainlinePath(tree).filter(
    (m) => m.ply <= n.ply && m.ply % 2 === (rootSide(tree) === side ? 0 : 1)
  ).length;
}

/** Whose move it is in the position the chapter starts from. */
function rootSide(tree: MoveTree): Side {
  return sideToMove(nodeAt(tree, tree.root)!);
}
