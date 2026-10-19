# Third-party notices

ChessRabbit source is GPL-3.0. Dependency licenses continue to apply independently.

| Component | License | Source |
| --- | --- | --- |
| Stockfish | GPL-3.0 | https://github.com/official-stockfish/Stockfish |
| Leela Chess Zero (optional) | GPL-3.0-or-later | https://github.com/LeelaChessZero/lc0 |
| python-chess | GPL-3.0-or-later | https://github.com/niklasf/python-chess |
| chess.js | BSD-2-Clause | https://github.com/jhlywa/chess.js |
| react-chessboard | MIT | https://github.com/Clariity/react-chessboard |
| Next.js | MIT | https://github.com/vercel/next.js |
| React | MIT | https://github.com/facebook/react |
| FastAPI | MIT | https://github.com/fastapi/fastapi |
| SQLAlchemy | MIT | https://github.com/sqlalchemy/sqlalchemy |
| PostgreSQL | PostgreSQL License | https://www.postgresql.org/about/licence/ |
| Redis 7.2 | BSD-3-Clause | https://github.com/redis/redis/tree/7.2 |
| Electron / Chromium | MIT and bundled third-party notices | https://github.com/electron/electron |
| Python | PSF License | https://www.python.org/psf/license/ |
| fakeredis (desktop queue/cache) | BSD-3-Clause | https://github.com/cunla/fakeredis-py |
| PyInstaller bootloader | GPL-2.0-or-later with bootloader exception | https://pyinstaller.org/en/stable/license.html |
| Archivo | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/archivo |
| Instrument Serif | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/instrumentserif |
| IBM Plex Mono | SIL OFL 1.1 | https://github.com/google/fonts/tree/main/ofl/ibmplexmono |

The interface bundles Latin WOFF2 font files. Their original copyright and
license texts are included in `apps/web/src/app/fonts/` beside the font files.

See Python requirement files, the npm lockfile and installed packages for all direct/transitive dependencies and their license texts. Container base images include additional operating-system packages and notices.

The default worker installs Debian's Stockfish package. Its package copyright/source information is available in the image and through https://packages.debian.org/bookworm/stockfish . The optional Lc0 Dockerfile builds upstream tag v0.32.1 from its source and submodules.

The Windows installer bundles the unmodified upstream Stockfish 19 universal x64 release. Its `src`, build scripts, documentation, AUTHORS, GPL text and networks from that release are preserved under `resources/runtime/stockfish`. The release's original archive and SHA-256 are also published alongside the installer. PostgreSQL 16.15 comes from EDB's Windows binary archive; its server and command-line third-party notices are preserved. The desktop runtime uses fakeredis in process instead of a separate Redis server. Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` remain beside the executable. Python dependency notices are collected in `resources/runtime/python-licenses`, with the dependency inventory beside them.

When redistributing images or engine binaries, preserve copyright/license notices and provide corresponding source and build material as required by their licenses. Links here are attribution; they are not a replacement for providing corresponding source for the exact binaries you distribute. The desktop release includes the ChessRabbit source archive and Windows build scripts.

The Windows installer includes 1,200 puzzles selected from the Lichess puzzle database export (https://database.lichess.org/lichess_db_puzzle.csv.zst), released under CC0. The bundled subset covers ratings 600–2400 and can be regenerated with `pipeline/make_starter_puzzles.py`; no puzzle download occurs at app startup. Larger puzzle datasets, neural-network files, Syzygy tablebases and reference games are obtained separately. Check their licenses before redistribution. Public availability of games does not by itself grant unrestricted redistribution rights.
