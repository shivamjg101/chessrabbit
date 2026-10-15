# Local setup

## Windows desktop app

Download the [published 0.1.2 installer](https://github.com/shivamjg101/chessrabbit/releases/download/desktop-v0.1.2/ChessRabbit-Setup.exe), run it, and open ChessRabbit from the desktop or Start menu. The desktop source is at 0.1.4; its locally built installer is at `dist/windows/ChessRabbit-Setup.exe` after following the [build instructions](DESKTOP.md#build-the-installer), but it is not yet a public download. The installer includes Stockfish and local storage. Desktop users do not need the development setup below.

For Leela, use **Engines → Add Leela Chess Zero** in the app and select your `lc0.exe` and network file. Use **Engines → Add UCI engine** for another engine, then select it in Analysis settings. See [the desktop guide](DESKTOP.md) for Windows installation, engines, backups and troubleshooting.

The remaining sections cover Docker development, self-hosting and standalone workers.

## Stockfish: default installation

1. Install Docker Desktop on Windows/macOS, or Docker Engine plus Compose v2 on Linux.
2. Download and extract the source branch, or clone it.
3. From the project folder: `docker compose up --build -d`.
4. Open **http://localhost:3000/app** (use this hostname, rather than a different local port or hostname).

The web interface, API, database and Redis are bound to 127.0.0.1. Local mode creates a personal account when the app opens. It accepts bootstrap requests only from the configured web origin. An ephemeral signing secret is generated when no secret is supplied; sessions renew automatically after restarting the API. Use a single API process in this mode.

No `.env` is required for the default setup. Allow a few minutes for the initial image builds. Stockfish comes from Debian's architecture-specific package; its version appears in Analysis settings.

Useful commands:

```sh
docker compose ps
docker compose logs --tail=100 api engine
docker compose down
docker compose up -d
```

Stopping containers preserves your games. **Do not use `down -v` unless you intend to delete all local data.**

## Leela Chess Zero in Docker (CPU)

Lc0 requires both an engine and a compatible neural network. Obtain a network from the [official Lc0 downloads](https://lczero.org/play/download/) and check its license. Save it as `engines/lc0/network.pb.gz` (create the directory first).

Build and start the optional CPU image:

```sh
docker compose -f docker-compose.yml -f compose.leela.yml up --build -d
```

This image builds Lc0 v0.32.1 with OpenBLAS and includes Stockfish. It uses the CPU; no GPU driver is required. CPU Lc0 can be slow, especially with large networks. Analysis requests stop at the depth or time limit, whichever is reached first.

Open Analysis settings and choose **Leela Chess Zero**. If the binary/network is absent or startup fails, it appears as unavailable. Stockfish remains usable. Read the worker logs for details.

To change networks, replace the file and restart the engine service. Network contents form part of the cache identity, so evaluations from different networks are kept separate.

## Custom UCI profiles

Copy `engines/engines.example.json` to `engines/engines.json`. Edit binary paths, command arguments and UCI options, then start with:

```sh
docker compose -f docker-compose.yml -f compose.leela.yml -f compose.engines.yml up --build -d
```

Each profile has a unique lowercase `id`, display `name`, `binary`, optional `args`, `options` and `workers`. In Docker, use Linux binaries for the container's architecture and include their required libraries. Windows `.exe` files cannot run in Linux containers. Profiles are trusted local configuration; the API never accepts executable paths from browser requests.

The selected engine applies to live analysis and game reviews. Playing against the computer uses Stockfish's adjustable Skill Level. Depth is engine-specific: the same numeric depth does not imply equal strength or work across engines.

## Native Windows engines and GPU Lc0

Keep the local API/web/database in Docker and run the engine worker directly on Windows:

1. Start the regular Docker stack, then `docker compose stop engine`.
2. Install Python 3.12 or 3.13.
3. Download an appropriate [Stockfish build](https://stockfishchess.org/download/) and [Lc0 package](https://lczero.org/play/download/) with its network and required runtime libraries.
4. Create `engines/engines.json` using full Windows paths. For example:

```json
[
  {"id":"stockfish","name":"Stockfish","binary":"C:/chess-engines/stockfish.exe"},
  {"id":"lc0","name":"Leela Chess Zero","binary":"C:/chess-engines/lc0/lc0.exe",
   "options":{"WeightsFile":"C:/chess-engines/lc0/network.pb.gz","Backend":"cuda-auto"}}
]
```

Choose a backend actually supported by your Lc0 build and hardware. The [official quickstart](https://lczero.org/play/quickstart/) explains the available packages; CPU builds can use `blas`. PowerShell, from the repository folder:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/engine/requirements.txt
$env:ENGINES_CONFIG = (Resolve-Path engines/engines.json).Path
$env:DATABASE_URL = 'postgresql://chessrabbit:devpassword@127.0.0.1:5433/chessrabbit'
$env:REDIS_URL = 'redis://127.0.0.1:6380/0'
$env:ENGINE_WORKERS = '1'
.\.venv\Scripts\python.exe services/engine/worker.py
```

Keep that worker running. Run only one worker deployment against this Redis catalog at a time. The same approach works on macOS/Linux with native binaries and shell environment variables.

## Data and upgrades

The default stack has no downloaded games, puzzles, tablebases or networks. Import your own PGN on the board immediately. Opening repertoire drills work from the bundled catalog. Populate optional reference and puzzle data using `pipeline` scripts; their CLI help documents input formats.

Back up PostgreSQL before upgrades. PowerShell (binary-safe Docker copy):

```powershell
docker compose exec -T postgres pg_dump -U chessrabbit -Fc -f /tmp/chessrabbit.backup chessrabbit
docker compose cp postgres:/tmp/chessrabbit.backup ./chessrabbit.backup
```

For an existing database:

```powershell
docker compose cp db/migrations/016_community_edition.sql postgres:/tmp/016.sql
docker compose exec -T postgres psql -U chessrabbit -d chessrabbit -v ON_ERROR_STOP=1 -f /tmp/016.sql
docker compose cp db/migrations/017_personal_puzzles.sql postgres:/tmp/017.sql
docker compose exec -T postgres psql -U chessrabbit -d chessrabbit -v ON_ERROR_STOP=1 -f /tmp/017.sql
docker compose cp db/migrations/018_analysis_snapshots.sql postgres:/tmp/018.sql
docker compose exec -T postgres psql -U chessrabbit -d chessrabbit -v ON_ERROR_STOP=1 -f /tmp/018.sql
docker compose cp db/migrations/019_game_variants.sql postgres:/tmp/019.sql
docker compose exec -T postgres psql -U chessrabbit -d chessrabbit -v ON_ERROR_STOP=1 -f /tmp/019.sql
docker compose up --build -d
```

Existing subscription/event records are preserved as historical data. No feature uses them. Old evaluation cache records remain stored but cannot satisfy the new engine-profile cache identities.

If another application uses ports 3000, 8000, 5433 or 6380, free those ports first. Changing web/API ports also requires changing the compiled frontend URLs, APP_BASE_URL and the browser address together.

## Shared hosting

Local mode is for personal localhost use. A shared/public installation must disable LOCAL_MODE, use a persistent strong JWT secret, normal account authentication, HTTPS, configured email and appropriate database/network access controls. See [Security](../SECURITY.md).
