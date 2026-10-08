export const guides = [
  {
    slug: 'stockfish-chess-analysis',
    title: 'Free Stockfish Chess Analysis for Windows | ChessRabbit',
    heading: 'Stockfish chess analysis, with room to think.',
    description: 'Use Stockfish in ChessRabbit, a free Windows chess analysis app. Review games, explore candidate moves, and add Leela Chess Zero or other UCI engines.',
    category: 'ENGINES',
    intro: 'A chess engine can find a strong move. The useful part is understanding why it works. Here’s how to make engine analysis part of your own thinking.',
    body: `<h2>A chess engine and an analysis app do different jobs.</h2>
<p>Stockfish is a chess engine: it searches possible continuations and evaluates positions. ChessRabbit is the workspace around it. You get a board, a local game library, full-game reviews, studies, and training tools. The documented Windows installer includes Stockfish 19, so you can begin without finding and configuring a separate engine.</p>
<p>ChessRabbit runs the engine on your computer. You do not need an account or subscription to analyze a local game. Your computer’s processor, the position, and your analysis settings affect how quickly the engine can search.</p>
<h2>Start with a question, not an evaluation.</h2>
<ol><li><strong>Bring a game you care about.</strong> Import a PGN from a recent match. Before turning to the engine, mark the moves where you felt uncertain or spent a lot of time.</li><li><strong>Review a critical position.</strong> Use live position analysis or run a full-game review. Look at the candidate moves and their continuations, rather than copying the first suggested move.</li><li><strong>Try your own alternative.</strong> Follow a variation and ask what the opponent can do in response. A move that looks good in isolation may allow a forcing reply.</li><li><strong>Write the lesson in your words.</strong> Save a comment or variation in a study. “Finish development before opening the center” is easier to remember than a long sequence with no explanation.</li></ol>
<h2>Read engine output with context.</h2>
<p>An evaluation is the engine’s assessment under its current search settings. It is not a promise about the result of a human game. Check the interface’s evaluation perspective before interpreting a positive or negative number. A mate score describes a mating line rather than an ordinary positional evaluation.</p>
<p>Depth is a search setting or search measurement, not a fixed amount of time. Some positions are much harder to resolve than others. When a position is tactical, give the engine more time and follow its principal line. If the preferred move changes as the search deepens, avoid treating the first answer as final.</p>
<div class="callout"><p><strong>A useful habit:</strong> before revealing the engine’s suggestion, choose two candidate moves of your own. Compare the replies to each move, then explain the difference in one sentence.</p></div>
<h2>Stockfish, Leela, or another UCI engine?</h2>
<p>Stockfish is the easiest starting point because it comes with ChessRabbit. For a second engine, you can add Leela Chess Zero using your local Lc0 executable and a compatible neural-network file. Leela packages have different hardware requirements; choose one suited to your computer. A GPU package needs the appropriate drivers and runtime libraries.</p>
<p>Use <strong>Engines → Add Leela Chess Zero</strong> or <strong>Add UCI engine</strong>, then select the engine in Analysis settings. Keep the executable and its required files in a permanent folder. Consult the <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">desktop engine setup guide</a> for exact setup and troubleshooting details.</p>
<p>Different engine choices are useful for exploration, but you do not need several engines to learn from a game. Start with the included Stockfish, keep your review focused, and save the positions that taught you something.</p>`,
  },
  {
    slug: 'offline-chess-analysis',
    title: 'Offline Chess Analysis App for Windows | ChessRabbit',
    heading: 'Your chess analysis. Available offline.',
    description: 'Analyze local PGN games offline on Windows with ChessRabbit and the included Stockfish engine. Learn what works without internet and how to keep backups.',
    category: 'YOUR WORKSPACE',
    intro: 'A quiet desk, a saved game, and a position worth understanding. Once ChessRabbit is installed, local analysis does not need a constant internet connection.',
    body: `<h2>What works without an internet connection?</h2>
<p>ChessRabbit is a desktop chess analysis and training app for Windows. The installer includes Stockfish, and your games and analysis results are stored locally. You can review a PGN you already have, analyze positions with an installed engine, and work with your local studies without being connected.</p>
<p>Online services still need the internet. Downloading the installer, importing games from Lichess or Chess.com, and requesting live opening statistics are separate from local engine analysis. Plan to download any optional engines or datasets before you go offline.</p>
<table><caption>Local and connected features</caption><thead><tr><th scope="col">Task</th><th scope="col">Connection needed?</th></tr></thead><tbody><tr><td>Download and install ChessRabbit</td><td>Download requires internet</td></tr><tr><td>Analyze a local PGN with bundled Stockfish</td><td>No, after installation</td></tr><tr><td>Revisit saved games, comments, and variations</td><td>No</td></tr><tr><td>Import online player games or view live opening statistics</td><td>Yes</td></tr><tr><td>Download Leela, networks, tablebases, or reference datasets</td><td>Yes, for the download</td></tr></tbody></table>
<h2>Set up your offline workspace.</h2>
<ol><li><strong>Install on a supported computer.</strong> Use Windows 10 or 11 on a 64-bit Intel or AMD PC. The documented minimum is 4 GB RAM and 1 GB free storage; 8 GB RAM and four or more CPU cores are recommended for deeper analysis.</li><li><strong>Keep your games nearby.</strong> Export the games you want to study as PGN files while you are connected. Save them somewhere you can find again, then import them into ChessRabbit.</li><li><strong>Try a short review.</strong> Open a game and confirm the included Stockfish engine runs before relying on your offline setup. Start with modest analysis settings and adjust for your computer.</li><li><strong>Download optional material in advance.</strong> A new install starts with an empty personal/reference database. Large reference collections, puzzle datasets, Leela networks, and Syzygy tablebases are separate downloads.</li></ol>
<h2>Your computer does the work.</h2>
<p>Local analysis uses your own processor and memory. A deeper search or more candidate lines can take longer. On a laptop, a long engine session can use substantial battery power; choose settings that suit the time and hardware you have available. A dedicated GPU is not required for the included Stockfish workflow.</p>
<p>ChessRabbit does not require an account or activation key. Every feature is free. If you connect an online service, that service’s access requirements and availability still apply.</p>
<h2>Keep a backup of your chess work.</h2>
<p>Local storage gives you control, and it also means backups are your responsibility. In the desktop app, <strong>File → Open data folder</strong> shows the local data location. Close ChessRabbit and copy the <strong>whole local folder</strong> to a backup location. Treat that backup as private.</p>
<div class="callout"><p>Back up the complete folder, not just individual database files. Read the <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">desktop backup and restore instructions</a> before restoring or moving an installation.</p></div>
<p>The packaged desktop app targets Windows. Developers who want to run the project on another platform can look at the <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/LOCAL_SETUP.md">Docker self-hosting guide</a>; that is a separate setup from the Windows installer.</p>`,
  },
  {
    slug: 'pgn-game-review',
    title: 'PGN Game Review & Chess Analysis on Windows | ChessRabbit',
    heading: 'Turn a PGN into a lesson you can use.',
    description: 'Import and review PGN chess games with ChessRabbit. Analyze critical moves with Stockfish, save variations and comments, and build a practical review routine.',
    category: 'GAME REVIEW',
    intro: 'A saved game is a record of your decisions. A useful review turns those decisions into something you can recognize next time.',
    body: `<h2>What is a PGN file?</h2>
<p>Portable Game Notation, or PGN, is a text format for chess games. It can contain moves, game details such as the players and result, and sometimes comments and variations. Many chess platforms let you export a game as PGN so you can review it in another application.</p>
<p>ChessRabbit supports PGN import and export, collections, engine review, and studies. Importing a local file gives you a game to explore with the included Stockfish engine. Once the app is installed and the file is on your computer, that analysis can work offline.</p>
<h2>A review routine that goes beyond the score.</h2>
<ol><li><strong>Import your game.</strong> Save or export a PGN from where you played, then bring it into ChessRabbit. Check the players, result, and move list so you know you are reviewing the right game.</li><li><strong>Replay it without rushing.</strong> Before looking at the engine, identify where your plan became unclear. Include positions from wins: a good result can hide a missed opportunity or an unnecessary risk.</li><li><strong>Run a game review.</strong> Use move annotations and accuracy as signposts. Focus on a few important positions instead of trying to memorize every difference from the engine’s preferred line.</li><li><strong>Compare alternatives.</strong> At a critical move, ask what you intended, what you overlooked, and what the opponent could have played. Explore a variation with the engine until you understand the point of the recommendation.</li><li><strong>Save one practical takeaway.</strong> Add a comment and a short variation to a study. If the issue came from your opening, revisit the relevant repertoire line. If it was a recurring mistake, return to that position in your training.</li></ol>
<h2>Don’t let accuracy become the whole story.</h2>
<p>An accuracy score is a summary, not an explanation. A quiet game and a sharp tactical fight present different kinds of decisions. Move classifications and evaluations help you find positions worth studying, but the learning happens when you connect those positions to a pattern you can recognize.</p>
<p>For example, instead of recording only “my move was a mistake,” ask whether you missed an undefended piece, underestimated a forcing reply, or traded into an unfavorable ending. Your notes should describe the idea behind the line.</p>
<div class="callout"><p><strong>A simple review note:</strong> “Before making a slow improving move, check my opponent’s checks, captures, and immediate threats.” Attach the position and a short variation that shows why the reminder mattered.</p></div>
<h2>Keep the useful lines, not every line.</h2>
<p>Engine analysis can branch endlessly. Start with one main improvement and the strongest reply you need to understand. Save variations and comments in a study, and organize games into collections so you can return to related examples.</p>
<p>ChessRabbit also includes opening repertoires, spaced repetition, and mistake training. These tools can help you revisit what you learned, but a short review you can repeat is a better starting point than a complicated routine you will abandon.</p>
<h2>Local files or online imports?</h2>
<p>Local PGN files are useful when you want a review session without a network connection. ChessRabbit also offers optional Lichess and Chess.com imports; those need internet access and depend on the upstream service. Keep an exported copy of important games and back up your local ChessRabbit data.</p>
<p>Read the <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">desktop guide</a> for storage and setup details. Your next review does not need to be long: choose one game, understand one turning point, and leave yourself one clear lesson.</p>`,
  },
];
