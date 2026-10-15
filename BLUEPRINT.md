# Community architecture

ChessRabbit is a GPL-3.0 local chess database and training application. Every user can use every feature. Payments and subscription entitlements have been removed.

## Data flow

1. A static React interface runs in the browser on localhost.
2. FastAPI authenticates requests and stores games, studies, repertoires and jobs in PostgreSQL.
3. The API resolves the requested engine id against the worker's Redis catalog.
4. Jobs enter per-engine interactive or batch queues.
5. A worker acquires that profile's UCI subprocess and publishes evaluations over Redis.
6. The API relays live output over WebSocket; completed reviews persist in PostgreSQL.

Stockfish is included in the standard container. An optional CPU container builds Lc0. Native workers support platform-specific UCI binaries, including GPU Lc0. Configuration is read from a trusted JSON file or environment; browser requests cannot choose executables.

## Decisions

- Preserve the web UI instead of introducing a desktop wrapper. Docker provides a reproducible PC setup using the existing services.
- Default personal mode avoids registration and email setup. Bootstrap requires the configured localhost origin; public deployments use regular authentication.
- Use profile ids, engine versions, options and network hashes in cache identities. A one-line cached result cannot satisfy a request for several candidate lines.
- Keep depth, time, batch size and concurrency bounds as resource controls shared by all accounts.
- Preserve historical billing tables during upgrades; remove their models, routes, secrets and runtime readers.
- Retain the existing SQL migration history and append migrations in order; game variants arrive in 019.
- Persist each game's variant and starting FEN. Chess960 uses its own replay path and `UCI_Chess960`; standard Polyglot opening indexes, cache entries, cards and puzzles do not apply to it.
- Desktop folder sync writes encrypted snapshots with a local recovery key. It does not merge changes between workspaces.

## Operational limits

The worker reserves an interactive consumer so long reviews do not starve live requests. Jobs persist in PostgreSQL; startup recovery requeues unfinished jobs after a worker crash, and cancellation is checked between reviewed positions. A running engine search can finish its current position before a full-game cancellation takes effect.

Depth is not comparable across engines. Lc0 requires compatible weights and may hit its time limit before the requested depth. Neural networks, reference games, puzzles and tablebases are optional separate downloads.

See [Local setup](docs/LOCAL_SETUP.md) and [Development](docs/DEVELOPMENT_GUIDE.md).
