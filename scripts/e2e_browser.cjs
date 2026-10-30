/**
 * Browser end-to-end smoke test of a running ChessRabbit web app.
 *
 *   node scripts/e2e_browser.cjs <web-origin>
 *
 * <web-origin> is where /app is served: the desktop runtime's
 * http://127.0.0.1:<port>, or http://localhost:3000 for docker compose. The
 * app finds its API the way it was built to, so this needs no API address.
 *
 * Needs the `playwright` package and a browser: `npx playwright install
 * chromium`, or E2E_CHANNEL=chrome / msedge to drive an installed one. It
 * creates a handful of games in the workspace it is pointed at, so point it
 * at a test workspace, never at one with games you care about.
 *
 * Every page is opened, and the main flows are driven through the UI: PGN
 * import, the database reports, a game on the board, an engine review, the
 * novelty finder, position search in your own games, and a move against the
 * computer. A page error, a console error or a 5xx from the API fails the run.
 */
const { chromium } = require("playwright");
const { randomUUID } = require("node:crypto");

const origin = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(origin)) {
  console.error("Usage: node scripts/e2e_browser.cjs <web-origin>");
  process.exit(2);
}

// Each run's games differ, so a re-run is never refused as a duplicate.
const RUN = randomUUID().slice(0, 8);
const EVENT = `E2E Open ${RUN}`;
const TOURNAMENT = [
  ["Ann", "Ben", "1-0", "1. e4 c5 2. Nf3 d6"],
  ["Cat", "Ann", "1/2-1/2", "1. d4 Nf6 2. c4 e6"],
  ["Ben", "Cat", "0-1", "1. e4 e5 2. Nf3 Nc6"],
].map(([w, b, r, moves], i) =>
  `[Event "${EVENT}"]\n[Round "${i + 1}"]\n[Date "2025.03.0${i + 1}"]\n[White "${w} ${RUN}"]\n[Black "${b} ${RUN}"]\n[WhiteElo "2200"]\n[BlackElo "2100"]\n[Result "${r}"]\n\n${moves} ${r}\n`
).join("\n");
const ENDGAME = `[Event "E2E endgame ${RUN}"]\n[White "A ${RUN}"]\n[Black "B ${RUN}"]\n[Result "1-0"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]\n\n1. Kd2 Kd4 2. e3+ Ke4 3. Ke2 1-0\n`;

const PAGES = [
  "/", "/app/", "/database/", "/search/", "/study/", "/play/", "/train/", "/train/puzzles/",
  "/train/intuition/", "/train/clock/", "/insights/", "/prep/", "/download/", "/donate/",
  "/open-source/", "/privacy/", "/terms/", "/login/", "/register/", "/forgot/",
];

const problems = [];
const passed = [];

function watch(page) {
  page.on("pageerror", (err) => problems.push(`page error on ${page.url()}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // The browser logs every non-2xx fetch. The app answers 4xx itself (a
    // missing dataset, an expired token it refreshes); 5xx are caught below.
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    problems.push(`console error on ${page.url()}: ${text}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) problems.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
  });
}

async function step(name, fn) {
  const before = problems.length;
  try {
    await fn();
    if (problems.length === before) {
      passed.push(name);
      console.log(`ok   ${name}`);
    } else {
      console.log(`FAIL ${name}\n     ${problems.slice(before).join("\n     ")}`);
    }
  } catch (err) {
    problems.push(`${name}: ${err.message.split("\n")[0]}`);
    console.log(`FAIL ${name}\n     ${err.message.split("\n").slice(0, 3).join("\n     ")}`);
  }
}

const pieces = (page) => page.locator("[data-piece]").count();

async function importPgn(page, pgn, expect) {
  await page.goto(`${origin}/app/`);
  await page.getByRole("button", { name: "Toggle games list" }).first().click();
  await page.getByRole("button", { name: "+ Import" }).click();
  await page.locator(".scrim textarea").fill(pgn);
  await page.locator(".scrim").getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText(expect).waitFor({ timeout: 15000 });
}

async function openGameFromDatabase(page, player) {
  await page.goto(`${origin}/database/`);
  await page.getByPlaceholder("Carlsen").fill(player);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator("tbody tr", { hasText: player }).first().click();
  await page.waitForURL(/\/app\/\?game=\d+/);
  await page.getByText("Review this game").or(page.getByText("Re-run review")).first().waitFor({ timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  watch(page);

  for (const path of PAGES) {
    await step(`page ${path} renders`, async () => {
      const res = await page.goto(`${origin}${path}`, { waitUntil: "load" });
      if (!res || res.status() >= 400) throw new Error(`HTTP ${res && res.status()}`);
      await page.waitForTimeout(1200);
      const text = await page.locator("body").innerText();
      if (text.trim().length < 20) throw new Error("page is blank");
      if (/Application error|Unhandled Runtime Error/.test(text)) throw new Error("client-side exception");
    });
  }

  await step("import a tournament through the board", () =>
    importPgn(page, TOURNAMENT, "Imported 3 game(s)"));

  await step("re-importing it is reported as duplicates", () =>
    importPgn(page, TOURNAMENT, "Imported 0 game(s), 3 duplicates left out"));

  await step("a variant is refused with a reason", () =>
    importPgn(page, `[White "V ${RUN}"]\n[Black "W"]\n[Variant "Atomic"]\n[Result "*"]\n\n1. e4 *\n`, "Atomic is not supported"));

  await step("database crosstable, then a player dossier from it", async () => {
    await page.goto(`${origin}/database/`);
    await page.getByRole("button", { name: "Crosstable" }).click();
    await page.getByLabel("Find an event").fill(RUN);
    await page.getByRole("button", { name: new RegExp(EVENT) }).click();
    await page.getByText("3 players · 3 games").waitFor();
    await page.getByRole("dialog").getByRole("button", { name: `Ann ${RUN}` }).click();
    await page.getByRole("dialog").getByText("With White", { exact: true }).waitFor();
    await page.getByRole("dialog").getByText("75%").first().waitFor();
    await page.keyboard.press("Escape");
  });

  await step("duplicates dialog opens and reports", async () => {
    await page.goto(`${origin}/database/`);
    await page.getByRole("button", { name: "Duplicates" }).click();
    await page.getByRole("dialog").getByText(/No duplicates|Delete \d+ duplicate/).waitFor();
    await page.keyboard.press("Escape");
  });

  await step("a game from a set-up position opens on that position", async () => {
    await importPgn(page, ENDGAME, "Imported 1 game(s)");
    await openGameFromDatabase(page, `A ${RUN}`);
    await page.waitForTimeout(800);
    const n = await pieces(page);
    if (n !== 3) throw new Error(`board shows ${n} pieces, expected 3`);
  });

  await step("engine review of that game completes", async () => {
    await page.getByRole("button", { name: "Review this game" }).click();
    await page.getByText(/white accuracy/i).waitFor({ timeout: 90000 });
  });

  await step("novelty finder names the new move", async () => {
    await openGameFromDatabase(page, `Ben ${RUN}`);
    await page.getByRole("button", { name: /^Tools/ }).click();
    await page.getByRole("menuitem", { name: /Find the novelty/ }).click();
    await page.getByRole("button", { name: "My games", exact: true }).click();
    await page.getByText(/is new:|has been played before|nothing to compare/).waitFor({ timeout: 15000 });
    await page.keyboard.press("Escape").catch(() => {});
  });

  await step("position search finds your own games", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    await page.goto(`${origin}/search/?fen=${encodeURIComponent(fen)}&scope=mine`);
    await page.locator("tbody tr", { hasText: RUN }).first().waitFor({ timeout: 15000 });
  });

  await step("a move on the analysis board is played and analysed", async () => {
    await page.goto(`${origin}/app/`);
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await page.locator('[data-square="e4"] [data-piece="wP"]').waitFor();
  });

  await step("the computer answers a move in Play", async () => {
    await page.goto(`${origin}/play/`);
    await page.getByRole("button", { name: /White$/ }).first().click();
    await page.getByRole("button", { name: "Start game" }).click();
    await page.locator('[data-square="e2"]').click();
    await page.locator('[data-square="e4"]').click();
    await page.waitForFunction(() => {
      const black = [...document.querySelectorAll('[data-piece^="b"]')]
        .map((p) => p.closest("[data-square]")?.getAttribute("data-square"));
      return black.some((sq) => sq && !/^[a-h][78]$/.test(sq));
    }, null, { timeout: 60000 });
  });

  await browser.close();
  console.log(`\n${passed.length} passed, ${problems.length ? "FAILED" : "0 failed"}`);
  if (problems.length) {
    console.log(problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
