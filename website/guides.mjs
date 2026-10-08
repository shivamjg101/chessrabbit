export const guides = [
  {
    slug: 'install-leela-chess-zero',
    title: 'Install Leela Chess Zero on Windows | ChessRabbit Guide',
    heading: 'Give Leela a place at your board.',
    description: 'Install Leela Chess Zero in ChessRabbit on Windows: choose a GPU or CPU build, select a network, add lc0.exe, and troubleshoot setup.',
    category: 'LEELA / INSTALLATION',
    modified: '2026-10-08',
    intro: 'Add Leela Chess Zero (Lc0) to the ChessRabbit Windows desktop app, then choose it for your analysis. You will need an engine package and a compatible neural-network file.',
    body: `<nav aria-label="Installation steps"><p><a href="#download">Choose a download</a> · <a href="#files">Prepare the files</a> · <a href="#connect">Connect to ChessRabbit</a> · <a href="#troubleshoot">Troubleshoot</a></p></nav>
<div class="callout"><p>This guide is for Windows 10/11 x64 and the ChessRabbit desktop app. Leela is optional and is not bundled with ChessRabbit. The included Stockfish engine remains available. These steps configure the desktop app, not this website.</p></div>
<h2 id="download">1. Choose the right Windows package.</h2>
<p>Use <a href="https://lczero.org/play/download/">the official Lc0 downloads</a>, also available through <strong>Engines → Leela downloads</strong> in ChessRabbit. Match the package to your hardware using the compatibility list there:</p>
<table><caption>Where to start when choosing a build</caption><thead><tr><th scope="col">Your hardware</th><th scope="col">Package family to check</th></tr></thead><tbody><tr><td>NVIDIA GPU</td><td>CUDA or cuDNN, depending on the supported GPU list.</td></tr><tr><td>AMD / Intel GPU</td><td>ONNX-DML; follow the package's runtime instructions.</td></tr><tr><td>CPU only</td><td>DNNL/BLAS or OpenBLAS, depending on CPU compatibility.</td></tr></tbody></table>
<p>Keep the downloaded build's README handy for driver and runtime requirements. Package names and hardware support can change, so use the official selector instead of an old direct ZIP link.</p>
<h2 id="files">2. Extract the engine and find its network.</h2>
<p>Extract the entire archive into a permanent folder, for example <code>C:\\ChessEngines\\Lc0</code>. Keep <code>lc0.exe</code> alongside its supplied DLLs. Start with the bundled network when available. The training client is not needed for analysis; see the <a href="https://lczero.org/play/quickstart/">official quickstart</a> for the package contents.</p>
<p>Find the <code>.pb.gz</code> or <code>.pb</code> network file. If none is supplied, consult the <a href="https://lczero.org/play/networks/bestnets/">official network guide</a>. Check backend compatibility and memory needs. ONNX-DML packages may require a separate <code>directml.dll</code> step described in their README; older DirectX/OpenCL backends cannot use every newer network.</p>
<h2 id="connect">3. Add Leela through the desktop menu.</h2>
<ol><li><strong>Finish current review jobs.</strong> Do not replace an engine while a game review is queued or running. Turn off <strong>Auto</strong> in the board's Engine tab if necessary to pause automatic position analysis.</li><li>Choose <strong>Engines → Add Leela Chess Zero…</strong> from ChessRabbit's desktop menu.</li><li>In the first file picker, select <strong>lc0.exe</strong> from your extracted folder.</li><li>In the next picker, select the <strong>network file</strong>. ChessRabbit saves that explicit path as Leela's weights selection.</li><li>Wait for <strong>Leela Chess Zero is ready</strong>. If you see <strong>Could not start engine</strong>, use its error message to check the files and runtime requirements.</li><li>Open the board's <strong>Analysis settings → Engine</strong> tab. Choose <strong>Leela Chess Zero</strong> in the Engine dropdown. If Settings was already open, close and reopen it to refresh the list.</li></ol>
<p>The ready message confirms registration. The next check is a real position: enable Auto, play a move, and wait for a candidate line. Follow the <a href="../leela-chess-zero-analysis/">Leela analysis guide</a> for the exact steps and full-game review.</p>
<h2 id="troubleshoot">If setup does not work</h2>
<ul><li><strong>Missing DLL or GPU/backend error:</strong> use the complete package and its documented runtime/driver setup. Copying only the executable is not enough.</li><li><strong>Network cannot load:</strong> select the actual network file, check compatibility, and try the package's default network. For memory errors, try a smaller compatible network from the official guide.</li><li><strong>Leela is absent or marked “not configured”:</strong> complete registration successfully and reopen Analysis settings.</li><li><strong>ChessRabbit says to finish current analysis:</strong> wait for queued/running reviews. Switching Auto off does not cancel those jobs.</li><li><strong>You moved an engine or network:</strong> use Add Leela Chess Zero again with the new paths. This updates the existing Leela entry, so finish current jobs first.</li></ul>
<p>Keep the engine and network at the chosen locations after registration. For additional diagnostics, use <strong>File → Open data folder</strong> and inspect <code>desktop.log</code>. Docker users should follow the separate <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/LOCAL_SETUP.md">local engine configuration guide</a>.</p>
<p><a href="../leela-chess-zero-analysis/">Next: analyse your first position and game with Leela →</a></p>`,
  },
  {
    slug: 'leela-chess-zero-analysis',
    title: 'Analyse Chess Games with Leela Chess Zero | ChessRabbit',
    heading: 'Your first analysis with Leela.',
    description: 'Use Leela Chess Zero in ChessRabbit for live position analysis and full-game PGN reviews. Select the engine, explore lines, and compare with Stockfish.',
    category: 'LEELA / ANALYSIS',
    modified: '2026-10-08',
    intro: 'Once Leela is installed, choose it in Analysis settings and start with a single position. Then use the same engine to review a saved game.',
    body: `<nav aria-label="Analysis steps"><p><a href="#select">Select Leela</a> · <a href="#position">Analyse a position</a> · <a href="#game-review">Review a game</a> · <a href="#compare">Compare engines</a></p></nav>
<p>These instructions follow ChessRabbit's Windows desktop controls. If Leela has not been added yet, complete the <a href="../install-leela-chess-zero/">installation guide</a> first. The app needs both <code>lc0.exe</code> and a compatible network; this website does not run Leela.</p>
<h2 id="select">1. Select Leela and start small.</h2>
<ol><li>Open <strong>Analysis settings</strong> from the board's settings button, then the <strong>Engine</strong> tab.</li><li>Under Game review, choose <strong>Leela Chess Zero</strong> in the <strong>Engine</strong> dropdown. Despite the section heading, the selection applies to both live analysis and game reviews.</li><li>For your first compatibility check, set <strong>Search depth</strong> to <strong>12</strong>, the lowest offered choice, and <strong>Number of lines</strong> to <strong>1</strong>. These are starting points, not a speed guarantee.</li><li>Enable <strong>Auto-analyse on move</strong> and close Settings. You can also toggle <strong>Auto</strong> in the board's Engine tab.</li></ol>
<h2 id="position">2. Analyse a position.</h2>
<p>Open a saved game or play a few moves on the board. Select the <strong>Engine</strong> tab and navigate to a position. Wait for an evaluation and candidate continuation. The first real search checks that your selected network and backend can work together; successful registration alone does not establish that.</p>
<p>Click a candidate line to put its moves on the board as a variation. Step through the replies and compare the plan with the move you originally considered. You can request more lines in Settings after confirming that one line responds comfortably on your hardware.</p>
<div class="callout"><p>If you only see “Waiting for the engine,” check the selected engine, enable Auto, and move to another position. For persistent errors or no output, return to the <a href="../install-leela-chess-zero/#troubleshoot">installation troubleshooting steps</a> and inspect the error message or <code>desktop.log</code>.</p></div>
<h2 id="game-review">3. Review a complete PGN game.</h2>
<ol><li>Choose <strong>Import PGN</strong> in the analysis workspace, paste your game's PGN text, and import it. Open the imported game from the library. If its rail is hidden, open the games list first.</li><li>Confirm <strong>Leela Chess Zero</strong> is selected in Analysis settings before starting the review.</li><li>Open the board's <strong>Report</strong> tab and click <strong>Review this game</strong>. Wait for the job to finish before changing engine files or starting another comparison.</li><li>Use the evaluation curve and move annotations to revisit turning points. Switch to Engine to explore alternative continuations from those positions.</li></ol>
<p>Full-game review requires a saved/imported game. A study or an unsaved board can be explored with live analysis, but does not expose the same review button. For a small setup check, you can import this short PGN:</p>
<pre><code>[Event "Leela setup check"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6
3. Bc4 Bc5 *</code></pre>
<p>If the game already has a review, the button reads <strong>Re-run review</strong>. Selecting Leela does not automatically regenerate an existing Stockfish report. Start a new review to update it; the displayed results for the game are replaced, rather than kept as a side-by-side comparison.</p>
<h2 id="compare">4. Compare ideas with Stockfish.</h2>
<p>Save any notes you want to retain. At the same position, switch the selected engine to Stockfish to get another set of candidate lines, then switch back to Leela when needed. Give each engine enough time to produce useful continuations. An equal depth setting or nodes-per-second figure is not a like-for-like strength comparison between different search approaches.</p>
<p>Focus on the concrete continuation: what threat does the move create, and what is the best reply? Where engines disagree, follow the variations instead of treating one early score as a verdict. Increase settings only when your computer remains responsive.</p>
<h2 id="scope">What this changes—and what it does not</h2>
<p>The engine selection controls <strong>live analysis and game reviews</strong>. <strong>Play against the computer</strong> still uses Stockfish's adjustable strength. Local Leela analysis can work offline after the app, engine, network, and required runtimes are installed; online game imports still need internet.</p>
<p>For engine setup and file locations, see the <a href="../install-leela-chess-zero/">installation guide</a> and <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">desktop documentation</a>. For a general review routine, read <a href="../pgn-game-review/">turning a PGN into a useful lesson</a>.</p>`,
  },
  {
    slug: 'about',
    title: 'ChessRabbit Features, Compatibility & Product Facts',
    heading: 'Is ChessRabbit right for you?',
    description: 'Verified ChessRabbit product facts: free Windows chess analysis, Stockfish 19, offline PGN review, GPL-3.0 license, system requirements, and release limitations.',
    category: 'PRODUCT FACTS',
    modified: '2026-10-08',
    intro: 'ChessRabbit is a free, open-source desktop chess analysis and training app for Windows 10 and 11 on 64-bit Intel or AMD PCs. It includes Stockfish 19, keeps your game database locally, and supports offline analysis of local PGN files.',
    body: `<p>These facts were checked on <time datetime="2026-10-08">8 October 2026</time> against the project’s desktop documentation and the <a href="https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.2">0.1.2 release</a>. This is a first-party reference for <a href="https://github.com/shivamjg101/chessrabbit">shivamjg101/chessrabbit</a>, maintained under the GitHub account <strong>shivamjg101</strong>. This project’s official website is <a href="../">ChessRabbit on GitHub Pages</a>; check that repository when identifying the software or verifying a download.</p>
<h2 id="at-a-glance">ChessRabbit at a glance</h2>
<table><caption>Features and compatibility</caption><tbody>
<tr><th scope="row">Product type</th><td>Desktop chess analysis and training app; Stockfish is the bundled chess engine.</td></tr>
<tr><th scope="row">Price and account</th><td>Free features, no subscription, activation key, or required account registration. Donations are optional.</td></tr>
<tr><th scope="row">License</th><td>GPL-3.0. Source code is <a href="https://github.com/shivamjg101/chessrabbit">available on GitHub</a>.</td></tr>
<tr><th scope="row">Desktop platforms</th><td>Windows 10 and Windows 11, x64 Intel/AMD. No packaged macOS, Linux, Android, or iOS app is offered by this release.</td></tr>
<tr><th scope="row">Download version</th><td>0.1.2, published 3 October 2026 and marked <strong>prerelease</strong> on GitHub. See release notes before installing.</td></tr>
<tr><th scope="row">Included engine</th><td>Stockfish 19. No separate Stockfish download is needed for the Windows installer.</td></tr>
<tr><th scope="row">Optional engines</th><td>Leela Chess Zero (Lc0) with a compatible network, or another local UCI engine. These require separate downloads and setup.</td></tr>
<tr><th scope="row">Game tools</th><td>PGN import/export, full-game review, move annotations, candidate lines, studies with comments and variations, opening repertoires, and spaced repetition.</td></tr>
<tr><th scope="row">Offline use</th><td>Local PGN analysis with an installed engine works offline after installation. Downloads, online imports, and live opening statistics require internet.</td></tr>
<tr><th scope="row">Storage</th><td>Games, annotations, and results are stored on your computer. You are responsible for backing up local data.</td></tr>
<tr><th scope="row">Minimum hardware</th><td>64-bit Intel/AMD processor, 4 GB RAM, and 1 GB free storage. 8 GB RAM and four or more CPU cores are recommended for deeper analysis.</td></tr>
</tbody></table>
<h2 id="use-cases">When is ChessRabbit a useful choice?</h2>
<ul><li><strong>You want free Stockfish analysis on a Windows PC.</strong> The installer bundles the engine and a workspace for reviewing games.</li><li><strong>You want to analyze saved games offline.</strong> Bring local PGN files and use the installed engine without a constant network connection.</li><li><strong>You want to keep your game library locally.</strong> Save games, annotations, and studies on your own computer.</li><li><strong>You want to work on openings after reviewing a game.</strong> Use repertoires and spaced repetition alongside your analysis.</li><li><strong>You want to choose a UCI engine.</strong> Start with Stockfish and optionally add Leela or another engine that runs on your hardware.</li></ul>
<h2 id="limitations">What should you know before choosing it?</h2>
<p>This website introduces the app; it does not run a chess engine in your browser. The ready-to-install desktop download is for Windows x64. If you need a mobile app, a native Mac installer, or a hosted cloud engine, this release does not provide those.</p>
<p>Analysis runs on your computer, so speed and depth depend on your hardware and settings. The installer does not include large reference-game databases, puzzle datasets, Leela networks, or Syzygy tablebases. Download optional material separately when you need it.</p>
<p>The 0.1.2 release is a prerelease. The <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">desktop guide</a> describes the Windows builds as unsigned; consult the <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/WINDOWS_SECURITY.md">Windows security notes</a> and published checksums. Developers can use the separate <a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/LOCAL_SETUP.md">Docker setup</a> on other supported host platforms.</p>
<h2 id="engine-or-app">Is ChessRabbit an alternative to Stockfish?</h2>
<p>They serve different roles. Stockfish evaluates chess positions. ChessRabbit uses Stockfish and provides the board, game library, review tools, studies, and training workspace. ChessRabbit can also use optional Leela Chess Zero or other UCI engines for analysis.</p>
<h2 id="sources">Official sources and product data</h2>
<ul><li><a href="https://github.com/shivamjg101/chessrabbit">Source repository and feature overview</a></li><li><a href="https://github.com/shivamjg101/chessrabbit/blob/main/docs/DESKTOP.md">Installation, engines, requirements, and backups</a></li><li><a href="https://github.com/shivamjg101/chessrabbit/releases/tag/desktop-v0.1.2">0.1.2 prerelease, downloads, and checksums</a></li><li><a href="https://github.com/shivamjg101/chessrabbit/blob/main/LICENSE">Project license</a> and <a href="https://github.com/shivamjg101/chessrabbit/blob/main/PRIVACY.md">privacy policy</a></li><li><a href="../product.json">Machine-readable product facts (JSON-LD)</a></li></ul>
<p>Questions or corrections can be raised in <a href="https://github.com/shivamjg101/chessrabbit/discussions">project discussions</a> or the <a href="https://github.com/shivamjg101/chessrabbit/issues">issue tracker</a>.</p>`,
  },
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
