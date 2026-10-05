import { expect, it } from "vitest";
import { explorerView } from "./explorerView";

it("keeps loading distinct from a completed empty result", () => {
  expect(explorerView(true, null, 0, 0, "reference")).toEqual({
    status: "loading",
    summary: "Loading…",
    message: "Loading explorer statistics…",
  });

  expect(explorerView(false, null, 0, 0, "reference")).toEqual({
    status: "empty",
    summary: "0 games",
    message: "No reference games for this position.",
  });
});

it("presents explorer errors separately from loading and empty states", () => {
  expect(
    explorerView(
      false,
      "Could not load explorer statistics.",
      0,
      0,
      "reference"
    )
  ).toEqual({
    status: "error",
    summary: "—",
    message: "Could not load explorer statistics.",
  });
});

it("presents successful results with their total", () => {
  expect(explorerView(false, null, 2, 12, "reference")).toEqual({
    status: "results",
    summary: "12 games",
    message: null,
  });
});

it("keeps scope-specific empty messages", () => {
  expect(explorerView(false, null, 0, 0, "mine").message).toBe(
    "None of your games reached this position yet."
  );

  expect(explorerView(false, null, 0, 0, "lichess_live").message).toBe(
    "No master games have reached this position on Lichess."
  );
});
