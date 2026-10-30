// Exercise the installed native runtime, not a development server or mock engine.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

exports.run = async function run(origin, data, control) {
  let token;
  async function request(endpoint, body, method = "GET", authenticated = true) {
    const response = await fetch(`${origin}/api${endpoint}`, {
      method, headers: { "Content-Type": "application/json", Origin: origin,
        ...(token && authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    assert(response.ok, `${endpoint}: ${response.status} ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
  }
  assert.equal((await fetch(`${origin}/app/`)).status, 200);
  assert.equal((await request("/health")).status, "ok");
  const denied = await fetch(`${origin}/desktop/engines`, { method: "POST", body: "{}" });
  assert.equal(denied.status, 403);
  const invalidOrigin = await fetch(`${origin}/api/auth/local-session`, { method: "POST", headers: { Origin: "https://example.com" } });
  assert.equal(invalidOrigin.status, 403);
  token = (await request("/auth/local-session", undefined, "POST" )).access_token;
  const me = await request("/me");
  assert.equal(me.daily_limit, null);
  assert.equal(me.local_mode, true);
  assert(!("plan" in me));
  assert((await request("/engines")).some((engine) => engine.id === "stockfish" && engine.available));
  const marker = path.join(data, "smoke-game.json");
  if (fs.existsSync(marker)) {
    const previous = JSON.parse(fs.readFileSync(marker, "utf8"));
    assert.equal((await request(`/games/${previous.game}`)).id, previous.game);
    console.log("Existing game and database survived restart");
  }
  async function waitForJob(id) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await request(`/analysis/jobs/${id}`);
      if (job.status === "done") return job.result;
      assert(!["failed", "canceled"].includes(job.status), JSON.stringify(job));
      await sleep(500);
    }
    throw new Error("Stockfish analysis timed out");
  }
  const position = await request("/analysis/position", { fen: FEN, engine: "stockfish", depth: 8, multipv: 2 }, "POST");
  assert.equal((await waitForJob(position.job_id)).lines.length, 2);
  // A different game each run: the same game imported again is a duplicate,
  // which the API leaves out - and this suite runs twice on one workspace.
  const pgn = `[White "Desktop"]\n[Black "Installer smoke test ${randomUUID().slice(0, 8)}"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *`;
  const imported = await request("/games", { pgn }, "POST");
  assert.equal(imported.imported, 1);
  assert.equal((await request("/games", { pgn }, "POST")).duplicates, 1);
  const game = imported.game_ids[0];
  const review = await request(`/analysis/game/${game}?engine=stockfish&depth=8`, undefined, "POST");
  assert((await waitForJob(review.job_id)).accuracy);
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ game }));
  else await request(`/games/${game}`, undefined, "DELETE");
  // Configuring a second trusted native profile exercises the engine-menu endpoint.
  const profiles = JSON.parse(fs.readFileSync(path.join(data, "engines.json"), "utf8"));
  await control("engines", { id: "smoke-uci", name: "UCI smoke", binary: profiles.find((p) => p.id === "stockfish").binary });
  const custom = await request("/analysis/position", { fen: FEN, engine: "smoke-uci", depth: 6, multipv: 1 }, "POST");
  assert.equal((await waitForJob(custom.job_id)).lines.length, 1);
  // Relative WS URLs must reach the same random localhost port as HTTP.
  await new Promise((resolve, reject) => {
    let streamed = false;
    const ws = new WebSocket(`${origin.replace("http:", "ws:")}/api/ws/analysis?token=${encodeURIComponent(token)}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket analysis timed out")); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({ op: "start", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", engine: "stockfish", depth: 8, multipv: 2 }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "info") streamed = true;
      if (message.type === "done") {
        clearTimeout(timer); ws.close();
        if (message.cached || streamed) resolve();
        else reject(new Error("Engine did not stream evaluations"));
      }
      if (message.type === "error") { clearTimeout(timer); ws.close(); reject(new Error(JSON.stringify(message))); }
    };
  });
};
