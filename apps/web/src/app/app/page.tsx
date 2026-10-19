"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import AnalysisBoard from "@/components/AnalysisBoard";
import { GamePlayers } from "@/components/PlayerPlate";
import MoreMenu from "@/components/MoreMenu";
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
  { href: "/play", label: "Play" },
  { href: "/train/puzzles", label: "Puzzles" },
  { href: "/insights", label: "Insights" },
];

/** Everything reachable from the header, flattened for the phone menu. */
const MOBILE_NAV = [
  { href: "/play", label: "Play" },
  { href: "/train", label: "Opening drills" },
  { href: "/train/puzzles", label: "Puzzles" },
  { href: "/train/intuition", label: "Intuition" },
  { href: "/train/clock", label: "Time bank" },
  { href: "/insights", label: "Insights" },
  { href: "/prep", label: "Opponent prep" },
  { href: "/chess960", label: "Chess960" },
];

/** Colour a result the way a scoreboard would: the winning side's own piece. */
function resultTone(result: string): string {
  if (result === "1-0") return "bg-ivory text-ebony";
  if (result === "0-1") return "bg-ebony text-ivory ring-1 ring-ivory/25";
  return "bg-ink/10 text-muted";
}

function AppWorkspace() {
  const router = useRouter();
  const gameParam = useSearchParams().get("game");
  const [me, setMe] = useState<Me | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState(false);
  const [gameSearch, setGameSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [gamesPage, setGamesPage] = useState(1);
  const [hasMoreGames, setHasMoreGames] = useState(false);
  const [loadingMoreGames, setLoadingMoreGames] = useState(false);
  const gamesRequest = useRef(0);
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
  const gamesToggleRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [connectPlatform, setConnectPlatform] = useState<"lichess" | "chesscom">("lichess");
  const [connectUsername, setConnectUsername] = useState("");
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);

  const loadGames = useCallback(() => {
    const requestId = ++gamesRequest.current;
    setGamesLoading(true);
    setGamesError(false);
    api.listGames(1, searchQuery).then((rows) => {
      if (requestId !== gamesRequest.current) return;
      setGames(rows);
      setGamesPage(1);
      setHasMoreGames(rows.length === 50);
    }).catch(() => {
      if (requestId === gamesRequest.current) {
        setGames([]);
        setHasMoreGames(false);
        setGamesError(true);
      }
    }).finally(() => {
      if (requestId === gamesRequest.current) setGamesLoading(false);
    });
  }, [searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(gameSearch.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [gameSearch]);

  useEffect(() => { loadGames(); }, [loadGames]);

  async function loadMoreGames() {
    if (loadingMoreGames) return;
    setLoadingMoreGames(true);
    const requestId = gamesRequest.current;
    try {
      const rows = await api.listGames(gamesPage + 1, searchQuery);
      if (requestId !== gamesRequest.current) return;
      setGames((current) => [...current, ...rows]);
      setGamesPage((current) => current + 1);
      setHasMoreGames(rows.length === 50);
    } catch { setNotice("Could not load more games"); }
    finally { setLoadingMoreGames(false); }
  }

  useEffect(() => {
    setRailOpen(window.innerWidth >= 1280);

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

  }, [router]);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = document.getElementById("games-drawer");
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        gamesToggleRef.current?.focus();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);


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
      if (g.variant === "chess960") {
        router.push(`/chess960/game?game=${id}`);
        return;
      }
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
      });
      setDrawerOpen(false);
    } catch {
      setNotice("Could not load that game");
    }
  }, [router]);

  const openGame = (g: Game) => openGameById(g.id);

  // Arriving from reference search, or from a shared link to a game.
  useEffect(() => {
    const id = Number(gameParam);
    if (gameParam && Number.isSafeInteger(id) && id > 0) openGameById(id);
  }, [gameParam, openGameById]);

  async function doImport() {
    try {
      const res = await api.importPgn(pgnText);
      setNotice(`Imported ${res.imported} game(s)`);
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

  async function openAccounts(platform?: "lichess" | "chesscom") {
    if (platform) setConnectPlatform(platform);
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

  function openGames() {
    if (window.matchMedia("(min-width: 1024px)").matches) setRailOpen(true);
    else setDrawerOpen(true);
  }

  function openImport() {
    setDrawerOpen(false);
    setImportOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    gamesToggleRef.current?.focus();
  }

  if (!me) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-3 text-muted">
        <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
        Loading your board…
      </main>
    );
  }

  const gamesRail = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span className="eyebrow">My games</span>
        {!gamesLoading && !gamesError && (
          <span className="rounded-full bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {games.length} shown
          </span>
        )}
        <button
          className="ml-auto rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-accent/10"
          onClick={openImport}
        >
          + Import
        </button>
        <button className="rounded px-1 text-sm text-muted lg:hidden" onClick={closeDrawer} aria-label="Close games list">
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <input
          className="input mb-2 w-full text-xs"
          aria-label="Search my games by player"
          placeholder="Search players…"
          value={gameSearch}
          onChange={(event) => setGameSearch(event.target.value)}
        />
        {gamesLoading && <p className="px-1 text-xs text-muted" role="status">Loading games…</p>}
        {!gamesLoading && gamesError && (
          <div className="px-1 text-xs text-muted" role="alert">
            <p>Could not load your games.</p>
            <button className="btn mt-2 w-full" onClick={loadGames}>Retry</button>
          </div>
        )}
        {!gamesLoading && !gamesError && games.length === 0 && (
          gameSearch.trim() ? (
            <div className="px-1 text-xs text-muted">
              <p>No games match this search.</p>
              <button className="mt-2 text-brassLit underline" onClick={() => setGameSearch("")}>Clear search</button>
            </div>
          ) : (
            <div className="px-1 text-xs leading-relaxed text-muted">
              <p>No games yet. Import public games by username or add a PGN. No ChessRabbit account is needed.</p>
              <div className="mt-3 grid gap-2">
                <button className="btn w-full" onClick={() => { setDrawerOpen(false); openAccounts("lichess"); }}>Import Lichess games</button>
                <button className="btn w-full" onClick={() => { setDrawerOpen(false); openAccounts("chesscom"); }}>Import Chess.com games</button>
                <button className="btn w-full" onClick={openImport}>Import PGN</button>
              </div>
            </div>
          )
        )}
        <ul className="space-y-1">
          {games.map((g) => {
            const active = activeId === g.id;
            return (
              <li key={g.id}>
                <button
                  onClick={() => openGame(g)}
                  className={`w-full rounded-lg p-2 text-left transition-colors ${
                    active
                      ? "bg-accent/15 ring-1 ring-accent/40"
                      : "hover:bg-ink/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {g.white || "?"} — {g.black || "?"}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-semibold ${resultTone(
                        g.result
                      )}`}
                    >
                      {g.result}
                    </span>
                  </div>
                  <div className="mt-0.5 flex gap-1.5 text-[10px] text-muted">
                    {g.variant === "chess960" && <span className="rounded bg-accent/15 px-1 text-accent">Chess960</span>}
                    {g.eco && (
                      <span className="rounded bg-ink/[0.07] px-1">{g.eco}</span>
                    )}
                    {g.opening && <span className="truncate">{g.opening}</span>}
                    {!g.opening && g.played_on && <span>{g.played_on}</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {hasMoreGames && (
          <button className="mt-2 w-full rounded-lg px-2 py-1.5 text-xs text-accent hover:bg-accent/10" onClick={loadMoreGames} disabled={loadingMoreGames}>
            {loadingMoreGames ? "Loading…" : "Load more games"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      {/* ---------- Top bar ---------- */}
      {/* A cream header with a restrained walnut edge. */}
      <header
        className="z-40 flex h-14 shrink-0 items-center gap-3 border-b border-line/50
                   bg-panel/90 px-3 shadow-[0_2px_10px_rgba(77,47,24,0.14)] backdrop-blur-xl"
      >
        <button
          ref={gamesToggleRef}
          className="btn shrink-0 px-2 text-xs lg:hidden"
          onClick={() => setDrawerOpen((s) => !s)}
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? "games-drawer" : undefined}
        >
          Games
        </button>
        <button
          className="btn hidden shrink-0 px-2 text-xs lg:block"
          onClick={() => setRailOpen((s) => !s)}
          aria-expanded={railOpen}
          aria-controls="games-rail"
        >
          Games {railOpen ? "‹" : "›"}
        </button>

        <Link href="/app" aria-label="ChessRabbit home" className="inline-flex shrink-0 items-center gap-2 font-display text-lg leading-none text-ink">
          <Image src="/chessrabbit-mark.svg" alt="" width={26} height={26} aria-hidden="true" />
          <span className="hidden sm:inline">ChessRabbit</span>
        </Link>

        {/* Primary nav: one segmented pill group, no icon soup */}
        <nav className="seg ml-2 hidden lg:flex">
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
            className="rounded-lg px-2 py-1.5 text-lg leading-none text-muted transition-colors hover:bg-ink/[0.07] hover:text-ink"
          >
            ⚙
          </button>
          {me.daily_limit !== null && (
            <span className="hidden font-mono text-[11px] text-muted xl:inline">
              {me.analyses_today}/{me.daily_limit} today
            </span>
          )}
          <span className="chip hidden bg-ink/10 text-muted lg:inline-flex">{me.local_mode ? "Local" : "Community"}</span>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="grid h-8 w-8 place-items-center rounded-full border border-brass/50
                         bg-brass/15 font-mono text-sm text-brassLit transition-colors
                         hover:border-brass hover:bg-brass/25"
              title={me.display_name || me.email}
              aria-label="Account menu"
            >
              {(me.display_name || me.email)[0].toUpperCase()}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="card absolute right-0 top-full z-50 mt-2 w-60 p-1.5 shadow-card">
                  <div className="mb-1 border-b border-line/35 px-3 py-2">
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
                  <div className="mb-1 border-b border-line/35 pb-1 lg:hidden">
                    {MOBILE_NAV.map((n) => (
                      <Link
                        key={n.href}
                        href={n.href}
                        className="block rounded-lg px-3 py-1.5 text-sm text-ink/90 hover:bg-ink/[0.06]"
                      >
                        {n.label}
                      </Link>
                    ))}
                  </div>
                  <button
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ink/[0.06]"
                    onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}
                  >
                    Analysis settings
                  </button>
                  <button
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ink/[0.06]"
                    onClick={() => { setMenuOpen(false); setImportOpen(true); }}
                  >
                    Import PGN
                  </button>
                  <button
                    className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-ink/90 hover:bg-ink/[0.06]"
                    onClick={() => { setMenuOpen(false); openAccounts(); }}
                  >
                    Connected accounts
                  </button>

                  {me.local_mode ? (
                    <p className="border-t border-line/35 px-3 py-2 text-xs text-muted">No account needed. Use File → App lock to add an optional password.</p>
                  ) : (
                    <>
                      <Link href="/download" className="block rounded-lg px-3 py-1.5 text-sm text-ink/90 hover:bg-ink/[0.06]">Download and setup</Link>
                      <button className="mt-1 w-full rounded-lg border-t border-line/35 px-3 py-1.5 pt-2 text-left text-sm text-bad hover:bg-bad/10" onClick={signOut}>Sign out</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <button
          className="shrink-0 border-b border-accent/20 bg-accent/15 px-4 py-2 text-left text-sm"
          onClick={() => setNotice(null)}
        >
          {notice} <span className="text-muted">(dismiss)</span>
        </button>
      )}

      {/* ---------- Workspace ---------- */}
      <div className="flex flex-1 lg:min-h-0">
        {/* Games rail - static on desktop, drawer on mobile */}
        <aside
          id="games-rail"
          className={`hidden w-[264px] shrink-0 border-r border-line/35 bg-panel/40
                      backdrop-blur-xl lg:block ${railOpen ? "" : "lg:hidden"}`}
        >
          {gamesRail}
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeDrawer}
            />
            <aside id="games-drawer" role="dialog" aria-modal="true" aria-label="My games" className="absolute inset-y-0 left-0 w-[280px] animate-rise border-r border-line/35 bg-panel shadow-card">
              {gamesRail}
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 lg:min-h-0">
          <AnalysisBoard
            onOpenGames={openGames}
            onImportPgn={openImport}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setAccountsOpen(false)}
        >
          <div
            className="card w-full max-w-lg space-y-4 p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Connected accounts</h2>
            <p className="text-xs text-muted">
              Enter a Lichess or Chess.com username to import public games — newest first, synced nightly. This does not sign in to either platform.
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="card w-full max-w-lg space-y-3 p-4 shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Import PGN</h2>
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
