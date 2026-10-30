# Development

Use Python 3.12 and Node.js 22. The default Docker stack serves a built static interface. For frontend development, stop the web container and run `npm ci` followed by `npm run dev` in `apps/web`. Its default API/WebSocket URLs point to localhost:8000.

API dependencies: `apps/api/requirements-dev.txt`. Engine dependencies: `services/engine/requirements.txt`. A native API uses DATABASE_URL with asyncpg, REDIS_URL pointing at port 6380, and LOCAL_MODE=true for personal use. APP_BASE_URL must match the browser origin. Keep credentials in ignored environment files.

## Checks

```sh
# repository root, in an activated Python environment
pip install -r apps/api/requirements-dev.txt -r services/engine/requirements.txt
ruff check apps/api services/engine pipeline apps/desktop/backend scripts
python -m pytest services/engine/tests -q

# apps/api
python -m pytest -q

# apps/web
npm ci
npx tsc --noEmit --incremental false
npm test
npm run lint
npm run build
```

Set CHESSRABBIT_TEST_DB to a migrated PostgreSQL test database to include schema reflection checks. Never point it at an unrelated live database. Docker initializes all migrations on a fresh volume; existing volumes need new migrations applied manually.

Engine tests exercise UCI handshakes, Lc0-style options, subprocess exit errors, registry availability and network cache identities with a deterministic test subprocess. Actual Stockfish smoke testing runs in CI. A real Lc0/network deployment must also be verified on the target CPU/GPU.

Use `python scripts/smoke_local.py` against a running default Docker stack to verify personal session bootstrap, engine availability, position analysis and game reviews.

`node scripts/e2e_browser.cjs http://localhost:3000` drives the built interface in a headless browser: it opens every page and runs PGN import, duplicate detection, the crosstable and player dossier, a set-up-position game, an engine review, the novelty finder, position search in your own games and a move against the computer. It fails on any page error, console error or server error. It needs the `playwright` package (`npm install --no-save playwright` outside `apps/web`, then `npx playwright install chromium`, or set `E2E_CHANNEL=chrome` to use an installed Chrome). It adds games to the workspace it runs against, so use a test stack.
