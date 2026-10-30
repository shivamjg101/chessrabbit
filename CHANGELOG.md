# Changelog

All notable changes to ChessRabbit are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and desktop releases are tagged `desktop-vX.Y.Z`.

## [Unreleased]

### Added

- Database tools: tournament crosstables, player dossiers, duplicate-game cleanup, position search in your own games, and a novelty finder for the first new move of a game.
- Endgame **Tablebase** tab for positions with seven pieces or fewer, using local Syzygy files or the Lichess tablebase service.
- Interactive study lessons, "guess the move" chapters, chapter import, board editor, diagram export and study settings.
- A browser end-to-end test and a Windows engine test job in CI.
- Code of conduct, support guide, citation file and this changelog.

### Changed

- Faster engine responses. Bundled Stockfish runs as two processes, one of them kept free of game reviews, so live analysis and the computer's replies no longer wait behind a running review. Engines keep their hash table between positions instead of clearing it before every search, and stop as soon as you move on.
- Weaker computer opponents (levels 1–7) reply sooner. Their search now stops at the depth where Stockfish's Skill Level picks its move, so the moves are the same.
- The analysis board asks the engine 120 ms after the last move instead of 220 ms.

### Fixed

- A computer move requested during a game review no longer times out.

## [desktop-0.1.2] - 2026-10-03

Windows installer prerelease with Stockfish 19 and local storage included. See the [release notes](https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.2).

## [desktop-0.1.1] - 2026-10-03

Windows installer prerelease. See the [release notes](https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.1).

## [desktop-0.1.0] - 2026-10-02

First Windows installer prerelease. See the [release notes](https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.0).

[Unreleased]: https://github.com/shivamjg101/chessrabbit/compare/desktop-v0.1.2...main
[desktop-0.1.2]: https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.2
[desktop-0.1.1]: https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.1
[desktop-0.1.0]: https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.0
