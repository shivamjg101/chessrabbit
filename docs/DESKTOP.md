# ChessRabbit for Windows

Download **ChessRabbit-Setup.exe**, run the installer, and open ChessRabbit using the desktop or Start menu shortcut. The installer supports Windows 10/11 on 64-bit Intel/AMD PCs. It installs for your Windows user without configuring system services. Stockfish 19 is included and local analysis works offline.

The app is free, GPL-3.0 open source, with optional [donations](https://buymeacoffee.com/shivamjg101). No subscription, activation key or account registration is required.

## System requirements

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| Operating system | Windows 10 or Windows 11 | Windows 11 |
| CPU | 64-bit Intel or AMD processor | 4+ CPU cores for faster analysis |
| Memory | 4 GB RAM | 8 GB+ RAM, especially for deeper analysis |
| Storage | 1 GB free space for the app | 3 GB+ free space for games, logs and future updates |
| Internet | Required for download and online imports | Optional after install for local PGN analysis |
| Graphics | Any standard Windows display | Dedicated GPU only if you plan to run GPU Leela |

Stockfish analysis works immediately after installation. Leela Chess Zero, neural-network files, Syzygy tablebases and large reference datasets are optional separate downloads.

## Live explorer and opponent preparation

In the board's **Live** explorer tab, expand **Connect Lichess**. Create a personal API token at https://lichess.org/account/oauth/token/create with no permissions selected, paste it into ChessRabbit, and click **Connect and retry**. Lichess now requires authentication for explorer statistics. The token stays only in the current page's memory; reconnect after reloading or restarting. **Disconnect** clears it. Do not share your token in an issue or screenshot.

Opponent prep works without a local master database. It uses local master replies when available and otherwise creates clearly labeled game-based drills from replies in the opponent's downloaded games. These are not engine recommendations; review them with Stockfish or Leela before adopting them. Scouting and fetching games require internet access.

## Engines

For step-by-step Leela instructions, see [install Leela Chess Zero](../README.md#install-leela-chess-zero) and [analyse with Leela Chess Zero](../README.md#analyse-with-leela-chess-zero) in the README, or the [website installation guide](https://shivamjg101.github.io/chessrabbit/install-leela-chess-zero/).

- **Stockfish:** included and selected by default.
- **Leela Chess Zero:** download a Windows Lc0 package appropriate for your hardware and a compatible network from [the official downloads](https://lczero.org/play/download/). Extract it into a permanent folder. In ChessRabbit, choose **Engines → Add Leela Chess Zero**, select `lc0.exe`, then select the network `.pb.gz` or `.pb`. GPU builds require their matching drivers/runtime libraries; CPU builds also work. The native menu reports startup errors before accepting the engine.
- **Another UCI engine:** choose **Engines → Add UCI engine** and select its executable. Keep its required files together in a permanent folder.

Open Analysis settings and select the added engine. Live analysis and game reviews use that engine. Playing against the computer uses Stockfish's adjustable strength. Finish or stop current analysis before replacing an engine. If a custom engine moves, add it again from its new location.

## Local data and updates

**File → Open data folder** opens `%APPDATA%/ChessRabbit/local`. Games, annotations and results are stored in its `postgres` directory. `engines.json` stores trusted native engine paths; `desktop.log` and `postgres.log` help diagnose startup errors. The app binds services only to `127.0.0.1` and chooses free local ports automatically.

For a full backup, close ChessRabbit and copy the **whole local folder** to another location. It includes the database credentials needed to read the database. Restore the whole folder while the app is closed. Treat backups as private. The embedded database is PostgreSQL 16; a future major database upgrade will require an explicit migration.

Installing a newer app version preserves this folder and applies each new schema migration once. Uninstalling removes the program and shortcuts and preserves your personal data. To remove that data too, delete the local folder after closing/uninstalling the app.

Online player imports and opening statistics need internet access. Reference games, puzzle datasets, Leela networks and tablebases are optional separate downloads. New installations do not include those large datasets.

## Build the installer

Build on Windows x64 with Node.js 22 and Python 3.12:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps/desktop/requirements-build.txt
npm ci --prefix apps/web
npm ci --prefix apps/desktop
.\apps\desktop\scripts\build_windows.ps1 -Python .\.venv\Scripts\python.exe
```

The build verifies pinned SHA-256 checksums for the PostgreSQL and Stockfish archives, exports the web app with relative local API/WebSocket URLs, freezes the Python runtime, and builds an NSIS installer at `dist/windows/ChessRabbit-Setup.exe`. No user `.env` or game data is packaged. The release workflow repeats this build on Windows, installs it in an isolated runner, tests real Stockfish analysis, WebSocket streaming and data persistence, and uploads the installer, checksum and corresponding source.

For native runtime validation:

```powershell
.\dist\windows\win-unpacked\ChessRabbit.exe --smoke-test --data-dir="$PWD\.test-cache\desktop-smoke"
```

Run it twice to verify a saved game survives restart. Normal launches do not run these tests or create test games. Builds are unsigned until a Windows signing certificate is configured. Unsigned builds can trigger SmartScreen or Defender reputation warnings. See [Windows security notes](WINDOWS_SECURITY.md) for release scanning, code signing and Microsoft false-positive submission steps. The development Docker setup remains available in [LOCAL_SETUP.md](LOCAL_SETUP.md).
