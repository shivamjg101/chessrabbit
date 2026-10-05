import type { ExplorerMove } from "./api";

export interface ExplorerResponse {
  fen: string;
  total_games: number;
  moves: ExplorerMove[];
}

export type ExplorerRequestOutcome =
  | { status: "success"; result: ExplorerResponse }
  | { status: "error"; error: unknown }
  | { status: "aborted" };

/**
 * Resolve an explorer request without letting a superseded response mutate
 * the current position's UI.
 */
export async function settleExplorerRequest(
  request: Promise<ExplorerResponse>,
  signal: AbortSignal
): Promise<ExplorerRequestOutcome> {
  try {
    const result = await request;
    if (signal.aborted) return { status: "aborted" };
    return { status: "success", result };
  } catch (error) {
    if (signal.aborted) return { status: "aborted" };
    return { status: "error", error };
  }
}
