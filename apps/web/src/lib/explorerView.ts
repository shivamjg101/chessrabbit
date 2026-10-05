import type { ExplorerScope } from "./api";

export type ExplorerView =
  | { status: "loading"; summary: string; message: string }
  | { status: "error"; summary: string; message: string }
  | { status: "empty"; summary: string; message: string }
  | { status: "results"; summary: string; message: null };

function emptyText(scope: ExplorerScope): string {
  if (scope === "mine") {
    return "None of your games reached this position yet.";
  }
  if (scope === "lichess_live") {
    return "No master games have reached this position on Lichess.";
  }
  return "No reference games for this position.";
}

export function explorerView(
  loading: boolean,
  error: string | null,
  moveCount: number,
  total: number,
  scope: ExplorerScope
): ExplorerView {
  if (loading) {
    return {
      status: "loading",
      summary: "Loading…",
      message: "Loading explorer statistics…",
    };
  }

  if (error) {
    return {
      status: "error",
      summary: "—",
      message: error,
    };
  }

  const summary = `${total.toLocaleString()} games`;

  if (moveCount === 0) {
    return {
      status: "empty",
      summary,
      message: emptyText(scope),
    };
  }

  return {
    status: "results",
    summary,
    message: null,
  };
}
