# Privacy Policy

Last updated: 3 October 2026

ChessRabbit is designed as a local-first desktop chess application. The Windows app runs on your computer and stores your games, analysis, settings and engine results in your local ChessRabbit data folder.

## What the desktop app stores locally

ChessRabbit may store the following on your PC:

- Imported PGN games and game metadata.
- Studies, annotations, repertoires, puzzles, training progress and engine evaluations.
- Local account/session information used by the app on your machine.
- Engine settings, trusted local engine paths and app preferences.
- Local logs used for troubleshooting startup, database and engine issues.

On Windows, desktop data is stored under `%APPDATA%/ChessRabbit/local` unless a future version documents another location. Backups of this folder may contain your private games and local database credentials, so treat backups as private.

## Internet use

Local PGN analysis with the included Stockfish engine works after installation without creating an online account. Internet access is used when you download the installer, download updates or use online features.

Optional online features may contact third-party services when you choose to use them, including Lichess, Chess.com, opening explorers or external download sites for engines, neural-network files, tablebases and datasets. Those services have their own terms and privacy policies.

The board's **Tablebase** tab answers endgames with seven pieces or fewer. It uses Syzygy files on your computer when they are installed; otherwise, and only while the tab is open on such a position, it sends that position (and nothing else) through the local backend to the Lichess tablebase service at `tablebase.lichess.ovh`. No token or account is involved.

Live explorer requires a Lichess personal API token with no permissions selected. ChessRabbit keeps the token in the current page's memory, forwards it through the local backend to Lichess over HTTPS, and does not save it in the database, browser storage or logs. Disconnecting or reloading the page clears it. Explorer requests share the board position with Lichess; cached statistics contain no token. In a self-hosted web deployment, the operator's backend also receives the token.

## Telemetry and tracking

ChessRabbit does not intentionally include analytics, advertising trackers or telemetry in the desktop app. If you run a modified build or a build hosted by somebody else, that operator is responsible for explaining any additional tracking, hosting, access or retention practices.

## Your control

You can back up or delete your local ChessRabbit data folder while the app is closed. Deleting the app does not necessarily delete your local data, so remove the data folder separately if you want a full local reset.

## Public repository and community spaces

GitHub issues, discussions, pull requests and comments are public if the repository is public. Do not post passwords, private games, personal information or secret tokens in public reports.
