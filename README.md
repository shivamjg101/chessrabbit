# ChessRabbit

Free desktop chess analysis and training for Windows. ChessRabbit runs on your computer, stores your games locally, and works with Stockfish, Leela Chess Zero (Lc0), or another UCI engine.

[Visit the ChessRabbit website](https://shivamjg101.github.io/chessrabbit/) for an introduction, downloads, and guides to Stockfish, offline analysis, and PGN game review.

See [product facts and compatibility](https://shivamjg101.github.io/chessrabbit/about/) for supported platforms, requirements, use cases, and release limitations. [Machine-readable product data](https://shivamjg101.github.io/chessrabbit/product.json) is also available. The Windows 0.1.2 download is currently marked as a prerelease.

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

See also the Leela-specific installation and analysis steps below. Its engine and network are installed separately from ChessRabbit.

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| Operating system | Windows 10 or Windows 11 | Windows 11 |
| CPU | 64-bit Intel or AMD processor | 4+ CPU cores for faster analysis |
| Memory | 4 GB RAM | 8 GB+ RAM, especially for deeper analysis |
| Storage | 1 GB free space for the app | 3 GB+ free space for games, logs and future updates |
| Internet | Required for download and online imports | Optional after install for local PGN analysis |
| Graphics | Any standard Windows display | Dedicated GPU only if you plan to run GPU Leela |

ChessRabbit includes Stockfish, so no separate chess engine is required for basic analysis. Leela Chess Zero, neural-network files, Syzygy tablebases and large reference datasets are optional separate downloads.

## Leela Chess Zero: install and analyse

These instructions are for the **ChessRabbit Windows desktop app**. Leela Chess Zero (Lc0) is optional; Stockfish remains included. Read the website guides: [Install Leela Chess Zero](https://shivamjg101.github.io/chessrabbit/install-leela-chess-zero/) and [Analyse with Leela Chess Zero](https://shivamjg101.github.io/chessrabbit/leela-chess-zero-analysis/).

### Install Leela Chess Zero

1. Open the [official Lc0 downloads page](https://lczero.org/play/download/) or ChessRabbit's **Engines → Leela downloads**. Choose a **Windows** package for your hardware:

   | Hardware | Package to check on the official download page |
   | --- | --- |
   | NVIDIA GPU | CUDA or cuDNN, according to the listed GPU compatibility |
   | AMD / Intel GPU | ONNX-DML; follow the package's runtime instructions |
   | CPU only | DNNL/BLAS or OpenBLAS, according to CPU compatibility |

2. Extract the **whole archive** into a permanent folder, such as `C:\ChessEngines\Lc0`. Keep `lc0.exe` and its supplied DLLs together. Use the package's included network to start when available; the [Lc0 quickstart](https://lczero.org/play/quickstart/) explains its files. You do not need `lc0-training-client.exe` to analyse games.
3. Identify the network file, usually ending in `.pb.gz` or `.pb`. If the package has none, download a compatible one from the [official network guide](https://lczero.org/play/networks/bestnets/). Check the backend and memory requirements before changing networks. For ONNX-DML, follow the archive README for any required `directml.dll` setup. A newer network may not work with an older backend.
4. Open ChessRabbit and let any queued or running game review finish. Temporarily turn **Auto** off in the board's **Engine** tab if needed. Choose **Engines → Add Leela Chess Zero…** from the desktop menu.
5. Select **`lc0.exe`**, then select its **network file** in the second picker. Wait for **Leela Chess Zero is ready**. ChessRabbit records that network explicitly; selecting the executable alone is not enough. Keep both files at their chosen paths.
6. Open the board's **Analysis settings → Engine** tab and choose **Leela Chess Zero** in the **Engine** dropdown. If Settings was open while you added it, close and reopen Settings to refresh the list.

The ready message confirms engine registration. Analyse one position next to check that the network/backend can actually run. GPU drivers and runtime requirements depend on the package you selected; use its README rather than mixing files from different builds.

### Analyse with Leela Chess Zero

1. In **Analysis settings → Engine**, confirm **Leela Chess Zero** is selected. Start with **Number of lines: 1** and **Search depth: 12**, the lowest offered depth, for a quick compatibility check. Increase settings only after confirming acceptable response times on your computer.
2. Open a game or play a few moves on the board. Enable **Auto-analyse on move** in Settings, or **Auto** in the board's **Engine** tab. Move to a position and wait for an evaluation and a candidate line. Click a candidate line to put it on the board as a variation.
3. For a **full-game review**, use **Import PGN**, paste the game's PGN text, import it, and open the imported game from your library. In **Report**, select **Review this game**. The job uses the engine selected when you start it. A study or an unsaved board does not have this full-game review button.
4. If the game already has a Stockfish review, changing the engine does not recompute it. Select Leela, then use **Re-run review** to replace the game's displayed review with the new results. Save notes you want to retain before comparing engines.
5. Read the candidate continuations and the report together. Return to the same position with Stockfish selected if you want a second engine's view. Do not treat different engines' depth or nodes-per-second figures as equivalent measures of analysis quality.

Local analysis works offline once the app, engine, network, and required runtimes are installed. Online imports still require internet. This engine selection affects **live analysis and game reviews**; **Play against the computer** continues to use Stockfish.

### Leela troubleshooting

- **Missing DLL / backend error:** re-extract the full matching package and follow its driver/runtime instructions. Do not copy only `lc0.exe` out of the archive.
- **Weights/network error:** select the real `.pb.gz` or `.pb` file and check compatibility. Start with the package's default network; for memory errors, consult the network guide and try a smaller compatible network.
- **Leela missing or “not configured”:** complete the desktop engine setup successfully, then close and reopen Analysis settings. Read the **Could not start engine** message if registration fails.
- **“Finish or stop the current analysis…”:** wait for queued/running reviews to finish before replacing an engine. Turning Auto off does not cancel a queued full-game review.
- **Files moved or network changed:** repeat **Engines → Add Leela Chess Zero…** with the new paths. This replaces the existing Leela entry; finish current jobs first.
- **No evaluation:** check Leela is selected and Auto is enabled, then move to another position. If it remains slow, reduce search depth/lines and check your package/network choice. See **File → Open data folder → `desktop.log`** for additional diagnostics.

For Docker or advanced engine profiles, use the separate [local setup guide](docs/LOCAL_SETUP.md).

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
