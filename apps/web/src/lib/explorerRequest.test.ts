import { expect, it } from "vitest";
import {
  settleExplorerRequest,
  type ExplorerResponse,
} from "./explorerRequest";

const empty: ExplorerResponse = {
  fen: "start",
  total_games: 0,
  moves: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

it("settles a successful explorer request", async () => {
  const controller = new AbortController();

  const result = await settleExplorerRequest(
    Promise.resolve({ ...empty, total_games: 12 }),
    controller.signal
  );

  expect(result).toEqual({
    status: "success",
    result: { ...empty, total_games: 12 },
  });
});

it("keeps a successful empty result distinct from loading", async () => {
  const controller = new AbortController();

  const result = await settleExplorerRequest(
    Promise.resolve(empty),
    controller.signal
  );

  expect(result).toEqual({ status: "success", result: empty });
});

it("reports a non-aborted request failure", async () => {
  const controller = new AbortController();
  const error = new Error("explorer failed");

  const result = await settleExplorerRequest(
    Promise.reject(error),
    controller.signal
  );

  expect(result).toEqual({ status: "error", error });
});

it("ignores a rejection from an aborted request", async () => {
  const controller = new AbortController();
  const pending = deferred<ExplorerResponse>();

  const resultPromise = settleExplorerRequest(
    pending.promise,
    controller.signal
  );

  controller.abort();
  pending.reject(new DOMException("Aborted", "AbortError"));

  await expect(resultPromise).resolves.toEqual({ status: "aborted" });
});

it("ignores a late success from a superseded request", async () => {
  const controller = new AbortController();
  const pending = deferred<ExplorerResponse>();

  const resultPromise = settleExplorerRequest(
    pending.promise,
    controller.signal
  );

  controller.abort();
  pending.resolve(empty);

  await expect(resultPromise).resolves.toEqual({ status: "aborted" });
});

it("allows a fresh request to succeed after an error", async () => {
  const first = await settleExplorerRequest(
    Promise.reject(new Error("temporary failure")),
    new AbortController().signal
  );

  const retry = await settleExplorerRequest(
    Promise.resolve(empty),
    new AbortController().signal
  );

  expect(first.status).toBe("error");
  expect(retry).toEqual({ status: "success", result: empty });
});
