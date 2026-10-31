"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AnalysisBoard from "@/components/AnalysisBoard";
import { GamePlayers } from "@/components/PlayerPlate";
import MoreMenu from "@/components/MoreMenu";
import Wordmark from "@/components/Wordmark";
import SettingsModal from "@/components/SettingsModal";
import { clampToResources } from "@/lib/settings";
import {
  Annotation,
  api,
  ApiError,
  clearTokens,
  ExternalAccount,
  Game,
  Me,
  SyncResult,
} from "@/lib/api";

// The places you go every session. Everything else lives behind More, so the
// header stays readable instead of growing a link per feature.
const NAV = [
  { href: "/app", label: "Analyse" },
  { href: "/database", label: "Database" },
  { href: "/study", label: "Studies" },
  { href: "/play", label: "Play" },
  { href: "/train/puzzles", label: "Puzzles" },
];

/** Everything reachable from the header, flattened for the phone menu. */
const MOBILE_NAV = [
  { href: "/database", label: "Database" },
  { href: "/study", label: "Studies" },
  { href: "/search", label: "Reference database" },
  { href: "/play", label: "Play" },
  { href: "/train", label: "Opening drills" },
  { href: "/train/puzzles", label: "Puzzles" },
  { href: "/train/intuition", label: "Intuition" },
  { href: "/train/clock", label: "Time bank" },
  { href: "/insights", label: "Insights" },
  { href: "/prep", label: "Opponent prep" },
];

/** Colour a result the way a scoreboard would: the winning side's own piece. */
function resultTone(result: string): string {
  if (result === "1-0") return "bg-ivory text-ebony";
  if (result === "0-1") return "bg-ebony text-ink ring-1 ring-ivory/25";
  return "bg-ivory/10 text-muted";
}

function AppWorkspace() {
  const router = useRouter();
  const gameParam = useSearchParams().get("game");
  const [me, setMe] = useState<Me | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [activePgn, setActivePgn] = useState<string | undefined>();
  const [activeLabel, setActiveLabel] = useState<string | undefined>();
  // Names for the plates above and below the board. The movetext the board
  // parses carries no tag pairs, so who played it has to travel separately.
  const [activePlayers, setActivePlayers] = useState<GamePlayers | undefined>();
  const [activeId, setActiveId] = useState<number | undefined>();
  const [activeAnnotations, setActiveAnnotations] = useState<Annotation[]>([]);
  // The server's own ply count, so the board can tell when its parse of the
  // PGN disagrees with the one the review was built from.
  const [activePlies, setActivePlies] = useState<number | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const [pgnText, setPgnText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // The board wins ties for space: the rail only starts open on screens wide
  // enough to keep the board touching top and bottom. It is one click away.
  const [railOpen, setRailOpen] = useState(false); // desktop rail
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile drawer
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [connectPlatform, setConnectPlatform] = useState<"lichess" | "chesscom">("lichess");
  const [connectUsername, setConnectUsername] = useState("");
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);

  const loadGames = useCallback(() => {
    api.listGames().then(setGames).catch(() => setGames([]));
  }, []);

  useEffect(() => {
    setRailOpen(window.innerWidth >= 1536);

    // Fired together, not chained: the games list needs the same bearer token
    // as /me and nothing from its response, so waiting for one before starting
    // the other only ever added a round trip to the first paint.
    loadGames();

    api
      .me()
      .then((m) => {
        setMe(m);
        // Clamp saved preferences to the configured resource limits for
        // this account can actually request. Still lands before the engine is
        // asked, since AnalysisBoard only mounts once `me` is set.
        clampToResources(m.max_depth, m.max_multipv);
      })
      .catch(() => router.push("/login"));

  }, [router, loadGames]);

  // The account menu closes on Escape or a press outside it. A listener, not a
  // full-screen catcher: the menu sits in the glass top bar, and a `fixed`
  // catcher inside a blurred bar would only cover the bar.
  const accountMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!accountMenu.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menuOpen]);


  /**
   * Put a game on the board, given only its id.
   *
   * Everything the plates and the label need is on the detail response, so a
   * game can be opened without holding the list row it came from — which is
   * what lets a reference game arrive here from search as `?game=123`, and
   * what lets a link to one be shared at all.
   */
  const openGameById = useCallback(async (id: number) => {
    try {
      const g = await api.getGame(id);
      setActivePgn(g.movetext);
      setActiveId(id);
      setActiveAnnotations(g.annotations);
      setActivePlies(g.ply_count);
      setActiveLabel(
        `${g.white} vs ${g.black} · ${g.result}${g.event ? ` · ${g.event}` : ""}`
      );
      setActivePlayers({
        white: g.white,
        black: g.black,
        whiteElo: g.white_elo,
        blackElo: g.black_elo,
        result: g.result,
        timeControl: g.time_control,
      });
      setDrawerOpen(false);
    } catch {
      setNotice("Could not load that game");
    }
  }, []);

  const openGame = (g: Game) => openGameById(g.id);

  // Arriving from reference search, or from a shared link to a game.
  useEffect(() => {
    const id = Number(gameParam);
    if (gameParam && Number.isSafeInteger(id) && id > 0) openGameById(id);
  }, [gameParam, openGameById]);

  async function doImport() {
    try {
      const res = await api.importPgn(pgnText);
      // A refused variant or a game cut short at a bad move is not a clean
      // import, and saying only "Imported 3" hid that it happened.
      let msg = `Imported ${res.imported} game(s)`;
      if (res.duplicates) msg += `, ${res.duplicates} duplicate${res.duplicates === 1 ? "" : "s"} left out`;
      if (res.skipped) msg += `, ${res.skipped} skipped`;
      if (res.errors.length) msg += ` — ${res.errors[0]}${res.errors.length > 1 ? ` (+${res.errors.length - 1} more)` : ""}`;
      setNotice(msg);
      setPgnText("");
      setImportOpen(false);
      loadGames();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Import failed");
    }
  }

  function syncSummary(res: SyncResult): string {
    let msg = `${res.platform}: imported ${res.imported} game(s)`;
    if (res.duplicates) msg += `, ${res.duplicates} already here`;
    if (res.capped)
      msg += ` — ${res.capped} skipped`;
    return msg;
  }

  async function openAccounts() {
    setAccountsOpen(true);
    api.listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }

  async function doConnect() {
    setBusyPlatform(connectPlatform);
    try {
      const res = await api.connectAccount(connectPlatform, connectUsername.trim());
      setNotice(syncSummary(res));
      setConnectUsername("");
      api.listAccounts().then(setAccounts).catch(() => {});
      loadGames();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Could not connect account");
    } finally {
      setBusyPlatform(null);
    }
  }

  async function doSync(platform: "lichess" | "chesscom") {
    setBusyPlatform(platform);
    try {
      const res = await api.syncAccount(platform);
      setNotice(syncSummary(res));
      api.listAccounts().then(setAccounts).catch(() => {});
      loadGames();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Sync failed");
    } finally {
      setBusyPlatform(null);
    }
  }

  async function doDisconnect(platform: "lichess" | "chesscom") {
    const before = accounts;
    setAccounts((a) => a.filter((x) => x.platform !== platform));
    setNotice(`Disconnected ${platform}. Imported games were kept.`);
    try {
      await api.disconnectAccount(platform);
    } catch {
      setAccounts(before);
      setNotice(`Could not disconnect ${platform} — it is still connected.`);
    }
  }

  async function signOut() {
    await api.logout().catch(() => {});
    clearTokens();
    router.push("/");
  }

  if (!me) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <div className="glass flex items-center gap-3 rounded-full px-5 py-2.5 text-sm text-muted">
          <span className="h-2 w-2 animate-ping rounded-full bg-brass" />
          Loading your board…
        </div>
      </main>
    );
  }

  const gamesRail = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span className="eyebrow">My games</span>
        <span className="rounded-full bg-ivory/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-muted">
          {games.length}
        </span>
        <Link
          href="/database"
          className="ml-auto rounded-lg px-1.5 py-0.5 text-xs text-muted hover:bg-ivory/10 hover:text-ink"
          title="Every game as a sortable, filterable table"
        >
          Database
        </Link>
        <button
          className="rounded-lg px-1.5 py-0.5 text-xs text-brassLit hover:bg-brass/15"
          onClick={() => setImportOpen(true)}
        >
          + Import
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {games.length === 0 && (
          <p className="px-1 text-xs leading-relaxed text-muted">
            No games yet. Connect your Lichess or Chess.com account, import a
            PGN, or just start moving pieces on the board.
          </p>
        )}
        <ul className="space-y-1">
          {games.map((g) => {
            const active = activeId === g.id;
            return (
              <li key={g.id}>
                <button
                  onClick={() => openGame(g)}
                  className={`w-full rounded-xl p-2 text-left transition-colors ${
                    active
                      ? "bg-ivory/[0.12] shadow-edge ring-1 ring-brass/40"
                      : "hover:bg-ivory/[0.07]"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {g.white || "?"} — {g.black || "?"}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-px font-mono text-[10px] font-semibold ${resultTone(
                        g.result
                      )}`}
                    >
                      {g.result}
                    </span>
                  </div>
                  <div className="mt-0.5 flex gap-1.5 text-[10px] text-muted">
                    {g.eco && (
                      <span className="rounded-md bg-ivory/[0.07] px-1">{g.eco}</span>
                    )}
                    {g.opening && <span className="truncate">{g.opening}</span>}
                    {!g.opening && g.played_on && <span>{g.played_on}</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* ---------- Top bar ---------- */}
      {/* The one piece of chrome on every screen: a strip of dark glass the
          aurora glows through. */}
      <header className="glass-bar z-40 flex h-14 shrink-0 items-center gap-3 px-3">
        <button
          className="btn px-2 lg:hidden"
          onClick={() => setDrawerOpen((s) => !s)}
          aria-label="Toggle games list"
        >
          ☰
        </button>
        <button
          className="btn hidden px-2 lg:block"
          onClick={() => setRailOpen((s) => !s)}
          aria-label="Toggle games list"
          title="Toggle games list"
        >
          {railOpen ? "⟨" : "⟩"}
        </button>

        <Wordmark />

        {/* Primary nav: one segmented pill group, no icon soup */}
        <nav className="seg ml-2 hidden md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`seg-item ${n.href === "/app" ? "seg-item-on" : ""}`}
            >
              {n.label}
            </Link>
          ))}
          <MoreMenu />
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={() => setSettingsOpen(true)}
            title="Analysis settings"
            aria-label="Analysis settings"
            className="grid h-8 w-8 place-items-center rounded-full text-lg leading-none text-muted transition-colors hover:bg-ivory/[0.08] hover:text-ink"
          >
            ⚙
          </button>
          {me.daily_limit !== null && (
            <span className="hidden font-mono text-[11px] text-muted sm:inline">
              {me.analyses_today}/{me.daily_limit} today
            </span>
          )}
          <span className="chip bg-ivory/10 text-muted">{me.local_mode ? "Local" : "Community"}</span>
          <div className="relative" ref={accountMenu}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="grid h-8 w-8 place-items-center rounded-full border border-white/30
                         bg-gradient-to-br from-brassLit/60 to-copper/70 text-sm font-semibold
                         text-white shadow-edge transition-[filter] hover:brightness-125"
              title={me.display_name || me.email}
              aria-label="Account menu"
            >
              {(me.display_name || me.email)[0].toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="menu-pane absolute right-0 top-full z-50 mt-2 w-60 animate-rise p-1.5">
                  <div className="mb-1 border-b border-ivory/[0.06] px-3 py-2">
                    <p className="truncate text-sm font-medium">
                      {me.display_name || me.email}
                    </p>
                    {me.daily_limit !== null && (
                      <p className="text-xs text-muted">
                        {me.analyses_today}/{me.daily_limit} analyses today
                      </p>
                    )}
                  </div>
                  {/* On a phone there is no room for the nav pills or the
                      More menu, so every destination appears here instead. */}
                  <div className="mb-1 border-b border-ivory/[0.06] pb-1 md:hidden">
                    {MOBILE_NAV.map((n) => (
                      <Link
                        key={n.href}
                        href={n.href}
                        className="block rounded-xl px-3 py-1.5 text-sm text-ink/90 hover:bg-ivory/[0.06]"
                      >
                        {n.label}
                      </Link>
                    ))}
                  </div>
                  <button
                    className="w-full rounded-xl px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ivory/[0.06]"
                    onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}
                  >
                    Analysis settings
                  </button>
                  <button
                    className="w-full rounded-xl px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ivory/[0.06]"
                    onClick={() => { setMenuOpen(false); setImportOpen(true); }}
                  >
                    Import PGN
                  </button>
                  <button
                    className="w-full rounded-xl px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ivory/[0.06]"
                    onClick={() => { setMenuOpen(false); openAccounts(); }}
                  >
                    Connected accounts
                  </button>

                  <Link
                    href="/download"
                    className="block rounded-xl px-3 py-1.5 text-sm text-ink/90 hover:bg-ivory/[0.06]"
                  >
                    Download and setup
                  </Link>
                  <button
                    className="mt-1 w-full rounded-xl border-t border-ivory/[0.06] px-3 py-1.5 pt-2 text-left text-sm text-bad hover:bg-bad/10"
                    onClick={signOut}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <button
          className="glass mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-left text-sm"
          onClick={() => setNotice(null)}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-glow" />
          {notice} <span className="ml-auto text-xs text-muted">dismiss</span>
        </button>
      )}

      {/* ---------- Workspace ---------- */}
      <div className="flex flex-1 lg:min-h-0">
        {/* Games rail - static on desktop, drawer on mobile */}
        <aside
          className={`glass m-2 mr-0 hidden w-[264px] shrink-0 overflow-hidden rounded-2xl
                      lg:block ${railOpen ? "" : "lg:hidden"}`}
        >
          {gamesRail}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="scrim absolute inset-0"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="glass absolute inset-y-2 left-2 w-[280px] animate-rise overflow-hidden rounded-2xl bg-panel/70">
              {gamesRail}
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 lg:min-h-0">
          <AnalysisBoard
            initialPgn={activePgn}
            gameLabel={activeLabel}
            gameId={activeId}
            initialAnnotations={activeAnnotations}
            expectedPlies={activePlies}
            players={activePlayers}
          />
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal me={me} onClose={() => setSettingsOpen(false)} />
      )}

      {/* ---------- Connected accounts modal ---------- */}
      {accountsOpen && (
        <div
          className="scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setAccountsOpen(false)}
        >
          <div
            className="card-float w-full max-w-lg animate-fade space-y-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg">Connected accounts</h2>
            <p className="text-xs text-muted">
              Link your Lichess or Chess.com username and your games import
              automatically — newest first, synced nightly.
            </p>

            {accounts.length > 0 && (
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li
                    key={a.platform}
                    className="card-tight flex items-center gap-2 p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {a.platform === "lichess" ? "Lichess" : "Chess.com"} ·{" "}
                        {a.username}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {a.games_imported} games imported
                        {a.last_synced_at &&
                          ` · last sync ${new Date(a.last_synced_at).toLocaleString()}`}
                        {a.last_status && a.last_status !== "ok" && (
                          <span className="text-bad"> · {a.last_status}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn text-xs"
                      disabled={busyPlatform === a.platform}
                      onClick={() => doSync(a.platform)}
                    >
                      {busyPlatform === a.platform ? "Syncing…" : "Sync now"}
                    </button>
                    <button
                      className="btn text-xs"
                      onClick={() => doDisconnect(a.platform)}
                      aria-label="Disconnect"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <select
                className="input w-36"
                value={connectPlatform}
                onChange={(e) =>
                  setConnectPlatform(e.target.value as "lichess" | "chesscom")
                }
              >
                <option value="lichess">Lichess</option>
                <option value="chesscom">Chess.com</option>
              </select>
              <input
                className="input flex-1"
                placeholder="username"
                value={connectUsername}
                onChange={(e) => setConnectUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && connectUsername.trim()) doConnect();
                }}
              />
              <button
                className="btn-primary"
                disabled={!connectUsername.trim() || busyPlatform !== null}
                onClick={doConnect}
              >
                {busyPlatform ? "Importing…" : "Connect"}
              </button>
            </div>

            <div className="flex justify-end">
              <button className="btn" onClick={() => setAccountsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Import modal ---------- */}
      {importOpen && (
        <div
          className="scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="card-float w-full max-w-lg animate-fade space-y-3 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg">Import PGN</h2>
            <textarea
              className="input h-48 font-mono text-xs"
              placeholder={'[Event "..."]\n\n1. e4 e5 ...'}
              value={pgnText}
              onChange={(e) => setPgnText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={doImport}
                disabled={!pgnText.trim()}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppPage() {
  // The workspace reads `?game=` (a link from reference search, or a shared
  // link to one game), and useSearchParams needs a boundary in an exported
  // app or the build refuses the page.
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Loading…</p>}>
      <AppWorkspace />
    </Suspense>
  );
}
