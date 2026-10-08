# ChessRabbit

Free desktop chess analysis and training for Windows. ChessRabbit runs on your computer, stores your games locally, and works with Stockfish, Leela Chess Zero (Lc0), or another UCI engine.

[Visit the ChessRabbit website](https://shivamjg101.github.io/chessrabbit/) for an introduction, downloads, and guides to Stockfish, offline analysis, and PGN game review.

![ChessRabbit preview](docs/assets/chessrabbit-social-preview.svg)

[Download ChessRabbit-Setup.exe](https://github.com/shivamjg101/chessrabbit/releases/download/desktop-v0.1.2/ChessRabbit-Setup.exe) · [Read the desktop guide](docs/DESKTOP.md) · [Support the project](https://buymeacoffee.com/shivamjg101)

If ChessRabbit helps your training, please star this repo so more chess players can find it.

## Contributors welcome

Help make local chess analysis easier to use. Start with a [good first issue](https://github.com/shivamjg101/chessrabbit/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22), read [Contributing](CONTRIBUTING.md), or ask a question in [Discussions](https://github.com/shivamjg101/chessrabbit/discussions). React/TypeScript, Python, Windows testing, accessibility and documentation contributions are welcome.

Joining us during October? Read our [Hacktoberfest 2026 contribution guide](docs/HACKTOBERFEST.md). Contributions are welcome year-round; Hacktoberfest 2026 no longer awards rewards for pull requests.

## Why Players Try It

- One Windows installer. No Docker, Node.js, Python, database setup or account registration.
- Local game database in `%APPDATA%/ChessRabbit/local`.
- Stockfish 19 included, with support for Leela Chess Zero and custom UCI engines.
- PGN import, game review, move annotations, studies, opening work and training tools.
- Free features for everyone. No paid plans, subscription checks or license keys.

## Install on Windows

Download [ChessRabbit-Setup.exe](https://github.com/shivamjg101/chessrabbit/releases/download/desktop-v0.1.2/ChessRabbit-Setup.exe), run it, and open **ChessRabbit** from the desktop or Start menu. Windows 10/11 x64 is supported.

Use **Engines → Add Leela Chess Zero** to select your local `lc0.exe` and network, or **Add UCI engine** for another engine. Then choose it in Analysis settings. See the [desktop guide](docs/DESKTOP.md) for data, engines, backups and building the installer. If Windows warns on download, see [Windows security notes](docs/WINDOWS_SECURITY.md).

## System Requirements

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| Operating system | Windows 10 or Windows 11 | Windows 11 |
| CPU | 64-bit Intel or AMD processor | 4+ CPU cores for faster analysis |
| Memory | 4 GB RAM | 8 GB+ RAM, especially for deeper analysis |
| Storage | 1 GB free space for the app | 3 GB+ free space for games, logs and future updates |
| Internet | Required for download and online imports | Optional after install for local PGN analysis |
| Graphics | Any standard Windows display | Dedicated GPU only if you plan to run GPU Leela |

ChessRabbit includes Stockfish, so no separate chess engine is required for basic analysis. Leela Chess Zero, neural-network files, Syzygy tablebases and large reference datasets are optional separate downloads.

## Release Files

The current release includes:

- `ChessRabbit-Setup.exe` - Windows installer.
- `ChessRabbit-Source.zip` - corresponding source archive.
- `Stockfish-19-Upstream.zip` - upstream Stockfish source package for GPL compliance.
- `SHA256SUMS.txt` - checksums for release verification.

## About Me

ChessRabbit is built by [shivamjg101](https://github.com/shivamjg101), a developer focused on practical chess tools, local-first software and AI-assisted workflows. ChessRabbit helps players analyze games on their own computer with strong engines, keep their data locally and use every feature without paid plans.

If ChessRabbit helps your training, you can support the project at [buymeacoffee.com/shivamjg101](https://buymeacoffee.com/shivamjg101).

## Development and self-hosting

Install Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux). Download this branch as a ZIP and extract it, or clone it:

```sh
git clone --branch codex/open-source-local-engines https://github.com/shivamjg101/chessrabbit.git
cd chessrabbit
docker compose up --build -d
```

Open **http://localhost:3000/app**. No account registration, payment credentials or email provider is needed in local mode. The first build needs internet access; your own PGN files and installed engines then work offline.

Stockfish is included. **Leela is optional and requires a network file.** See [Local setup](docs/LOCAL_SETUP.md) for CPU Docker setup, native Windows/GPU engines, custom profiles, backups and troubleshooting.

To stop the app and keep your data: `docker compose down`.

## Features

- Live position analysis with selectable depth and candidate lines.
- Full-game reviews, move annotations, accuracy and mistake training.
- PGN import/export, collections, opening explorer and reference search.
- Studies with variations, comments and board annotations.
- Opening repertoires, spaced repetition, puzzles and opponent preparation.
- Optional Lichess/Chess.com imports and public player insights.

Every feature is available to every account. Resource limits apply equally to protect the machine running the app. There are no paid plans, billing routes, subscription checks or license keys.

Your desktop games and results are stored in `%APPDATA%/ChessRabbit/local`. Docker deployments use local volumes. A new install starts with an empty personal/reference database. Reference games, puzzles, neural networks and Syzygy tablebases are optional datasets installed separately.

## Community and legal

- Read the [privacy policy](PRIVACY.md), [security policy](SECURITY.md), [legal notes](LEGAL.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
- Ask setup questions and share ideas in [Discussions](https://github.com/shivamjg101/chessrabbit/discussions).
- Report reproducible bugs with the issue templates.
- See the [roadmap](ROADMAP.md) for near-term work.
- Use the [launch kit](docs/LAUNCH_KIT.md) if you want to share ChessRabbit with other chess players.

## Project layout

The standalone GitHub Pages marketing site lives in [`website/`](website/README.md). Build it with `node website/build.mjs`; see its guide for free hosting and search indexing setup.

| Directory | Purpose |
| --- | --- |
| `apps/web` | Next.js/React/TypeScript interface, exported as static files |
| `apps/desktop` | Electron Windows app, embedded runtime and NSIS installer |
| `apps/api` | FastAPI, authentication, chess data and analysis API |
| `services/engine` | Python UCI worker, engine profiles, Redis queues |
| `db/migrations` | PostgreSQL schema |
| `pipeline` | Reference-game and puzzle import tools |
| `engines` | Examples and ignored local engine/network files |

The browser calls the local API; the API queues jobs for a selected engine. Workers run engine binaries as separate processes and store results in PostgreSQL. Cache identities include the engine profile, reported version, options and network contents.

## Development and upgrades

See [Development](docs/DEVELOPMENT_GUIDE.md), [Architecture](BLUEPRINT.md) and [Contributing](CONTRIBUTING.md).

Existing installations must apply `db/migrations/016_community_edition.sql` before running this branch. Back up first. Older subscription records are retained as inert historical tables; no runtime code reads or writes them. Schema changes only run automatically on a fresh database volume.

## License

ChessRabbit is licensed under **GPL-3.0**, see [LICENSE](LICENSE). Third-party software and datasets retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Public downloads should include corresponding source, notices and checksums; see [LEGAL.md](LEGAL.md). The Windows build workflow produces an installer and corresponding source release.
