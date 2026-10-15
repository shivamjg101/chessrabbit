// Exercise the installed native runtime, not a development server or mock engine.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const backup = require("./backup.cjs");
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
  // These reads exercise migrations 017 and 018 on both fresh and upgraded databases.
  assert(Array.isArray(await request("/puzzles/themes")));
  assert(Array.isArray(await request("/analysis/snapshots")));
  const marker = path.join(data, "smoke-game.json");
  const restoreSmoke = process.argv.includes("--smoke-backup-restore");
  const restoreStateFile = path.join(data, "smoke-restore.json");
  const restoreState = restoreSmoke && fs.existsSync(restoreStateFile)
    ? JSON.parse(fs.readFileSync(restoreStateFile, "utf8")) : null;
  if (restoreState?.phase === "await_restore") {
    assert.equal((await request(`/games/${restoreState.original}`)).id, restoreState.original);
    const removed = await fetch(`${origin}/api/games/${restoreState.extra}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(removed.status, 404, "The post-backup game survived restore");
    fs.writeFileSync(restoreStateFile, JSON.stringify({ ...restoreState, phase: "verified" }));
    console.log("Encrypted snapshot restored across launches; post-backup game is absent");
  }
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
  const imported = await request("/games", { pgn: '[White "Desktop"]\n[Black "Installer smoke test"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *' }, "POST");
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
  if (restoreSmoke && !restoreState) {
    const dump = (await control("backup", undefined, 660000)).dump;
    assert.equal(path.dirname(path.resolve(dump)), path.resolve(data));
    const destination = path.join(data, "smoke-restore.crbackup");
    try {
      await backup.encryptDump(dump, destination, backup.localKey(path.dirname(data)),
        { format: 1, tablebases: {} });
    } finally { await fs.promises.unlink(dump).catch(() => {}); }
    fs.writeFileSync(restoreStateFile, JSON.stringify({ phase: "snapshot", original: JSON.parse(fs.readFileSync(marker, "utf8")).game }));
    console.log("Encrypted restore smoke: snapshot saved; run again with the same data directory");
  } else if (restoreSmoke && restoreState.phase === "snapshot") {
    const extra = (await request("/games", { pgn: '[White "After backup"]\n[Black "Restore smoke"]\n\n1. d4 d5 *' }, "POST")).game_ids[0];
    await backup.stageRestore(path.join(data, "smoke-restore.crbackup"),
      backup.localKey(path.dirname(data)), data);
    fs.writeFileSync(restoreStateFile, JSON.stringify({ ...restoreState, phase: "await_restore", extra }));
    console.log("Encrypted restore smoke: restore staged; run once more to verify");
  }
};
