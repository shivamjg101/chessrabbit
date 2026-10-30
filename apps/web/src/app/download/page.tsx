import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import DonateSection from "@/components/DonateSection";

const SOURCE = "https://github.com/shivamjg101/chessrabbit/tree/codex/open-source-local-engines";
const INSTALLER = "https://github.com/shivamjg101/chessrabbit/releases/download/desktop-v0.1.2/ChessRabbit-Setup.exe";

export default function DownloadPage() {
  return <div className="mx-auto min-h-screen max-w-3xl px-4 py-10">
    <Link href="/app" className="btn rounded-full px-3 text-sm">← Open the board</Link>
    <h1 className="mt-6 font-display text-4xl">ChessRabbit on your computer</h1>
    <p className="mt-4 text-muted">Free, open-source chess analysis and training. Install the desktop app and keep your games and analysis on your PC.</p>
    <a href={INSTALLER} className="btn-primary mt-7 inline-flex items-center justify-center gap-2 px-6 py-3">Download for Windows <span aria-hidden="true">↓</span></a>
    <p className="mt-3 text-xs text-muted">Windows 10 / 11 · 64-bit · Stockfish included</p>
    <section className="card mt-6 p-6">
      <h2 className="font-display text-xl">System requirements</h2>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        <li><strong className="text-ivory">OS:</strong> Windows 10 or Windows 11</li>
        <li><strong className="text-ivory">CPU:</strong> 64-bit Intel or AMD processor</li>
        <li><strong className="text-ivory">Memory:</strong> 4 GB minimum, 8 GB recommended</li>
        <li><strong className="text-ivory">Storage:</strong> 1 GB minimum, 3 GB recommended for games and updates</li>
        <li><strong className="text-ivory">Internet:</strong> required for download and online imports; local PGN analysis works offline after install</li>
        <li><strong className="text-ivory">GPU:</strong> optional, only needed for GPU Leela setups</li>
      </ul>
    </section>
    <ol className="mt-8 list-decimal space-y-4 pl-5 text-sm">
      <li>Download <strong>ChessRabbit-Setup.exe</strong> and run it.</li>
      <li>Follow the installer to add ChessRabbit to your desktop and Start menu.</li>
      <li>Open <strong>ChessRabbit</strong> and import a PGN or start analysing a position.</li>
    </ol>
    <section className="card mt-8 p-6">
      <h2 className="font-display text-xl">Choose your engine</h2>
      <p className="mt-2 text-sm text-muted">Stockfish is ready when you open the app. For Leela, use <strong>Engines → Add Leela Chess Zero</strong> and choose your engine and network file. You can also add another UCI engine. Select it in Analysis settings to use your own CPU or GPU.</p>
      <a className="mt-3 block text-sm text-brassLit underline" href="https://github.com/shivamjg101/chessrabbit/blob/codex/open-source-local-engines/docs/DESKTOP.md">Read the desktop and engine guide</a>
    </section>
    <p className="mt-6 text-xs text-muted">GPL-3.0. No subscription or license key. Local PGN analysis works offline after installation. Online imports and live opening statistics require a connection.</p>
    <a className="mt-4 inline-block text-xs text-brassLit underline" href={SOURCE}>Source code and development setup</a>
    <div className="mt-8"><DonateSection /></div>
    <SiteFooter />
  </div>;
}
