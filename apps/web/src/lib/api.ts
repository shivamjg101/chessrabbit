/**
 * Typed API client for the ChessRabbit backend.
 * Handles access-token storage and transparent refresh on 401.
 */

import { getSettings } from "@/lib/settings";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Session memory only: never persist a third-party credential in browser storage.
let lichessExplorerToken = "";
export function setLichessExplorerToken(token: string) {
  lichessExplorerToken = token.trim();
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Me {
  id: number;
  email: string;
  display_name: string;
  local_mode: boolean;
  email_verified: boolean;
  analyses_today: number;
  daily_limit: number | null;
  max_depth: number;
  max_multipv: number;
  puzzle_rating: number;
}

export interface Puzzle {
  id: number;
  lichess_id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  game_url: string | null;
}

export interface PuzzleAttemptResult {
  solved: boolean;
  rating_before: number;
  rating_after: number;
  delta: number;
  puzzle_rating: number;
}

export interface PuzzleStats {
  puzzle_rating: number;
  solved: number;
  attempted: number;
  streak: number;
}

export interface PuzzleTheme {
  theme: string;
  count: number;
}

export interface Game {
  id: number;
  white: string;
  black: string;
  white_elo: number | null;
  black_elo: number | null;
  result: string;
  event: string;
  played_on: string | null;
  eco: string | null;
  opening: string | null;
  ply_count: number;
}

export interface GameDetail extends Game {
  /**
   * The moves, with variations and comments. A game from a set-up position
   * starts with its `[SetUp]`/`[FEN]` tags, which `parsePgn` reads.
   */
  movetext: string;
  annotations: Annotation[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Already in your database, or twice in the file: not imported again. */
  duplicates: number;
  /** One line per game refused or cut short. */
  errors: string[];
  game_ids: number[];
}

export interface DuplicateGroup {
  keep: number;
  duplicates: number[];
  white: string;
  black: string;
  result: string;
  played_on: string | null;
}

export interface EventSummary {
  event: string;
  games: number;
  first_date: string | null;
  last_date: string | null;
}

export interface CrosstablePlayer {
  name: string;
  elo: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  /** Sonneborn-Berger. */
  tiebreak: number;
  performance: number | null;
  /** Against each player, in standings order: "1", "0", "½", "1 ½", or "". Empty for big events. */
  results: string[];
}

export interface Crosstable {
  event: string;
  games: number;
  unfinished: number;
  first_date: string | null;
  last_date: string | null;
  players: CrosstablePlayer[];
}

export interface ScoreLine {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score_pct: number;
}

export interface PlayerDossier {
  name: string;
  total: ScoreLine;
  as_white: ScoreLine;
  as_black: ScoreLine;
  highest_elo: number | null;
  latest_elo: number | null;
  first_date: string | null;
  last_date: string | null;
  openings_white: { eco: string | null; opening: string | null; games: number; score_pct: number }[];
  openings_black: { eco: string | null; opening: string | null; games: number; score_pct: number }[];
  opponents: { name: string; games: number; score_pct: number }[];
  recent: Game[];
}

export type NoveltyScope = "reference" | "mine";

export interface Novelty {
  /** "novelty": `ply` was new. "known": every checked move had a precedent. "no_games": empty database. */
  status: "novelty" | "known" | "no_games";
  ply: number | null;
  san: string | null;
  position_games: number;
  known_moves: { uci: string; san: string; games: number; score_pct: number }[];
  checked_plies: number;
}

export interface Annotation {
  ply: number;
  nag: number | null;
  comment: string | null;
  eval_cp: number | null;
  best_uci: string | null;
  /**
   * The move this annotation reviews, from the server's parse of the PGN.
   * `move_uci` lets the board confirm the row belongs to the move it holds at
   * this ply; `move_san` is displayed rather than re-derived. Null on rows
   * written before migration 011.
   */
  move_uci?: string | null;
  move_san?: string | null;
  classification: Classification | null;
  review: string | null;
}

export type Classification =
  | "book"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export interface ReviewSummary {
  accuracy: { white: number; black: number };
  classifications: {
    white: Partial<Record<Classification, number>>;
    black: Partial<Record<Classification, number>>;
  };
}

export interface EvalLine {
  depth: number;
  multipv: number;
  cp: number | null;
  mate: number | null;
  pv: string[];
}

export type ExplorerScope = "reference" | "mine" | "lichess_live";

export interface ExplorerMove {
  uci: string;
  san: string;
  games: number;
  white_wins: number;
  draws: number;
  black_wins: number;
  avg_elo: number | null;
  white_pct: number;
  draw_pct: number;
  black_pct: number;
}

// ---- Reference database search ----

/** Every filter `GET /search/games` accepts. All optional, all combinable. */
export interface GameSearchQuery {
  white?: string;
  black?: string;
  eco?: string;
  opening?: string;
  result?: string;
  min_elo?: number;
  /** ISO dates (YYYY-MM-DD). A game with no date matches neither bound. */
  date_from?: string;
  date_to?: string;
}

export interface SearchResults {
  games: Game[];
  page: number;
  /** Whether a next page exists. There is no total — see the schema's note. */
  has_more: boolean;
}

// ---- Studies ----

/**
 * Who may read a study. Who may *write* is a separate question, answered by
 * the member list — a viewer is somebody you sent the link to, so there is no
 * viewer role.
 */
export type StudyVisibility = "private" | "unlisted" | "public";

export interface Study {
  id: number;
  name: string;
  description: string | null;
  visibility: StudyVisibility;
  /** The share link's secret. For an unlisted study it IS the access control. */
  slug: string;
  chapter_count: number;
  updated_at: string;
  owner_id: number;
  owner_name: string;
  /** False when you are reading somebody else's shared study. */
  can_edit: boolean;
  /** Free-text labels a public study is found by. */
  topics: string[];
  likes: number;
  /** Whether you have liked it. */
  liked: boolean;
  /** The study this one was cloned from, if any. */
  cloned_from: number | null;
}

/**
 * How a chapter is read.
 *
 * - normal: an analysis board.
 * - lesson: the reader plays one side and has to find the author's moves.
 * - conceal: every move stays hidden until the reader steps onto it.
 */
export type ChapterMode = "normal" | "lesson" | "conceal";

export interface StudyChapter {
  id: number;
  name: string;
  description: string | null;
  /** Movetext with variations. No tag pairs — the row carries those. */
  pgn: string;
  starting_fen: string;
  orientation: "white" | "black";
  mode: ChapterMode;
  /** The author asks readers to work it out without the engine. */
  hide_engine: boolean;
  /** PGN tag pairs: White, Black, Event, Date, Result, Annotator ... */
  tags: Record<string, string>;
  position: number;
  /** Quoted back on every save; the server rejects a stale one with 409. */
  version: number;
}

/** What a new chapter is made from. Everything but the name is optional. */
export interface ChapterDraft {
  name: string;
  description?: string;
  pgn?: string;
  starting_fen?: string;
  orientation?: "white" | "black";
  from_game_id?: number;
  mode?: ChapterMode;
  hide_engine?: boolean;
  tags?: Record<string, string>;
}

export interface StudyPage {
  studies: Study[];
  page: number;
  has_more: boolean;
}

export type PublicStudySort = "popular" | "newest" | "updated";

// ---- Your game database ----

export type GameSort =
  | "added" | "date" | "white" | "black" | "white_elo" | "black_elo"
  | "result" | "eco" | "event" | "moves";

/** Every filter and order `GET /games` accepts. All optional. */
export interface GameListQuery {
  q?: string;
  white?: string;
  black?: string;
  eco?: string;
  opening?: string;
  event?: string;
  result?: string;
  min_elo?: number;
  date_from?: string;
  date_to?: string;
  collection?: number;
  sort?: GameSort;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface GameHeaders {
  white?: string;
  black?: string;
  white_elo?: number | null;
  black_elo?: number | null;
  event?: string;
  site?: string;
  played_on?: string | null;
  result?: string;
  eco?: string;
  opening?: string;
}

export interface Collection {
  id: number;
  name: string;
  game_count: number;
}

// ---- Endgame tablebase ----

/** win | loss | draw | cursed-win | blessed-loss | maybe-win | maybe-loss | unknown */
export type TablebaseCategory = string;

export interface TablebaseMove {
  uci: string;
  san: string;
  /** For the side to move AFTER this move. */
  category: TablebaseCategory;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseResult {
  fen: string;
  /** rules | syzygy (files on this machine) | lichess (online) */
  source: string;
  category: TablebaseCategory;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  insufficient_material: boolean;
  moves: TablebaseMove[];
}

export interface StudyMember {
  user_id: number;
  display_name: string;
  email: string;
  role: string;
}

export interface StudyDetail extends Study {
  chapters: StudyChapter[];
  /** Empty for a reader — who else holds the keys is not their business. */
  members: StudyMember[];
}

// ---- Insights ----

export type TimeClass =
  | "bullet" | "blitz" | "rapid" | "classical" | "correspondence";
export type InsightsRange = "all" | "30d" | "90d" | "1y";

export interface InsightsQuery {
  timeClass?: TimeClass;
  color?: "w" | "b";
  range?: InsightsRange;
}

/** Games plus their outcomes — the unit nearly every chart is built from. */
export interface Tally {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  accuracy: number | null;
}

export interface OpeningRow {
  name: string;
  eco: string | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

/** Where a set of insights came from. Absent means the signed-in user. */
export type InsightsSource = "lichess" | "chesscom" | "otb";

export interface OtbPlayer {
  name: string;
  games: number;
}

export interface Insights {
  /** Set only when looking at somebody else. */
  player?: string;
  source?: InsightsSource;
  /**
   * False for another player: their games carry no engine annotations, so
   * accuracy, move quality and game shape are absent rather than zero.
   */
  engine_metrics?: boolean;
  /** Games actually replayed for the board-derived charts. */
  replayed?: number;
  filters: {
    time_class: string | null;
    color: string | null;
    since: string | null;
    tz_offset: number;
  };
  games: number;
  reviewed: number;
  /** Games we could not attribute to a colour, so are excluded throughout. */
  unattributed: number;
  replay_limit: number;
  overview: {
    played: number;
    wins: number;
    draws: number;
    losses: number;
    by_month: { label: string; games: number }[];
    accuracy: {
      overall?: number | null;
      win?: number | null;
      draw?: number | null;
      loss?: number | null;
    };
    accuracy_by_move: { move: number; accuracy: number | null; moves: number }[];
    by_opponent_rating: {
      bucket: number; games: number; wins: number; draws: number; losses: number;
    }[];
  };
  results: {
    won_by: { reason: string; games: number }[];
    drew_by: { reason: string; games: number }[];
    lost_by: { reason: string; games: number }[];
  };
  phases: {
    ended_in?: Record<string, number>;
    accuracy?: Record<string, number | null>;
    results?: Record<string, Tally>;
  };
  shapes: Record<string, Tally>;
  openings: { white: OpeningRow[]; black: OpeningRow[] };
  moves: {
    quality: { cls: string; moves: number; pct: number }[];
    quality_by_month: Record<string, Record<string, number>>;
    pieces: { piece: string; moves: number; accuracy: number | null }[];
    castling: {
      phase?: Record<string, number>;
      side?: Record<string, number>;
      results?: Record<string, Tally>;
    };
  };
  calendar: {
    time_of_day: {
      slot: string; games: number; wins: number; draws: number; losses: number;
    }[];
    day_of_week: {
      day: string; games: number; wins: number; draws: number; losses: number;
    }[];
  };
}

export interface Repertoire {
  id: number;
  name: string;
  color: "white" | "black";
  card_count: number;
  due_count: number;
  prep_sources?: Record<string, number> | null;
}

export interface Opening {
  id: string;
  name: string;
  color: "white" | "black";
  eco: string;
  description: string;
  moves: string;
  rank: number;
}

export interface EngineInfo {
  id: string;
  name: string;
  available: boolean;
  version: string | null;
  error?: string;
}

export interface IntuitionPosition {
  fen: string;
  master_uci: string;
  master_san: string;
  white: string;
  black: string;
  white_elo: number | null;
  black_elo: number | null;
  event: string;
  ply: number;
}

export interface PrepLine {
  moves: string[];
  count: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface PrepDossier {
  username: string;
  platform: string;
  games_analyzed: number;
  as_white: PrepLine[];
  as_black: PrepLine[];
}

export interface TrainingCard {
  id: number;
  repertoire_id: number;
  repertoire_name: string;
  color: "white" | "black";
  fen: string;
  reps: number;
  interval_days: number;
}

export interface TrainingResult {
  correct: boolean;
  expected_uci: string;
  expected_san: string;
  next_due_days: number;
}

export interface ExternalAccount {
  platform: "lichess" | "chesscom";
  username: string;
  last_synced_at: string | null;
  last_status: string | null;
  games_imported: number;
}

export interface SyncResult {
  platform: string;
  username: string;
  fetched: number;
  imported: number;
  duplicates: number;
  capped: number;
  errors: string[];
}

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// --- token storage (in-memory + localStorage mirror) ---

let accessToken: string | null = null;

export function setTokens(pair: TokenPair) {
  accessToken = pair.access_token;
  if (typeof window !== "undefined") {
    localStorage.setItem("ob_refresh", pair.refresh_token);
    localStorage.setItem("ob_access", pair.access_token);
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== "undefined") {
    accessToken = localStorage.getItem("ob_access");
  }
  return accessToken;
}

export function clearTokens() {
  accessToken = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem("ob_refresh");
    localStorage.removeItem("ob_access");
  }
}

async function doRefreshAccessToken(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const refresh = localStorage.getItem("ob_refresh");
  if (!refresh) return false;

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  setTokens(await res.json());
  return true;
}

let refreshing: Promise<boolean> | null = null;
let bootstrapping: Promise<boolean> | null = null;
let localMode: boolean | undefined;

async function bootstrapLocal(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!bootstrapping) bootstrapping = (async () => {
    if (localMode === undefined) {
      const config = await fetch(`${API_URL}/app-config`);
      if (!config.ok) return false;
      localMode = (await config.json()).local_mode;
    }
    if (!localMode) return false;
    const res = await fetch(`${API_URL}/auth/local-session`, { method: "POST" });
    if (!res.ok) return false;
    setTokens(await res.json());
    return true;
  })().finally(() => { bootstrapping = null; });
  return bootstrapping;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) refreshing = (async () =>
    await doRefreshAccessToken() || await bootstrapLocal()
  )().finally(() => { refreshing = null; });
  return refreshing;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  if (!path.startsWith("/auth/") && !getAccessToken()) await bootstrapLocal();
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    if (await refreshAccessToken()) {
      return request<T>(path, options, false);
    }
  }

  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body.detail?.code ?? code;
      message = body.detail?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/**
 * A text response, with the same auth and refresh as `request`.
 *
 * Exports go through here rather than through a plain link: a link is a
 * navigation, and a navigation carries no Authorization header - so a link to
 * the PGN of a private study reached the server as a stranger and came back
 * 404.
 */
async function requestText(path: string, options: RequestInit = {}, retry = true): Promise<string> {
  if (!getAccessToken()) await bootstrapLocal();
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401 && retry && (await refreshAccessToken())) {
    return requestText(path, options, false);
  }
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body.detail?.code ?? code;
      message = body.detail?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  return res.text();
}

/** Hand the browser a file to save, from text already in memory. */
export function saveTextFile(text: string, filename: string, type = "application/x-chess-pgn") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function slugName(name: string): string {
  return name.replace(/[^\w-]+/g, "_").slice(0, 40) || "export";
}

export const api = {
  register: (email: string, password: string, display_name = "") =>
    request<TokenPair>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),

  login: (email: string, password: string) =>
    request<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => {
    const refresh =
      typeof window !== "undefined" ? localStorage.getItem("ob_refresh") : null;
    // Both credentials are read before the local copies go, and the access
    // token is sent explicitly. The server revokes the refresh token from the
    // body and the access token from this header — clearing tokens first meant
    // the request went out unauthenticated, so the access token stayed valid
    // for the rest of its life on whatever had already copied it.
    const access = getAccessToken();
    clearTokens();
    if (!refresh) return Promise.resolve();
    return request<void>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
      headers: access ? { Authorization: `Bearer ${access}` } : {},
    });
  },

  me: () => request<Me>("/me"),

  listGames: (page = 1) => request<Game[]>(`/games?page=${page}`),

  /** The game list as a database program shows it: filtered, sorted, paged. */
  queryGames: (query: GameListQuery = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const v = typeof value === "string" ? value.trim() : value;
      if (v !== "" && v != null) q.set(key, String(v));
    }
    return request<Game[]>(`/games?${q.toString()}`);
  },

  updateGame: (id: number, headers: GameHeaders) =>
    request<Game>(`/games/${id}`, { method: "PATCH", body: JSON.stringify(headers) }),

  deleteGames: (ids: number[]) =>
    request<void>("/games/delete", { method: "POST", body: JSON.stringify({ ids }) }),

  /** Several games as one multi-game PGN, in the order given. */
  exportGames: (ids: number[]) =>
    requestText("/games/export", { method: "POST", body: JSON.stringify({ ids }) }),

  gamePgn: (id: number) => requestText(`/games/${id}/pgn`),

  listCollections: () => request<Collection[]>("/collections"),

  createCollection: (name: string) =>
    request<Collection>("/collections", { method: "POST", body: JSON.stringify({ name }) }),

  deleteCollection: (id: number) => request<void>(`/collections/${id}`, { method: "DELETE" }),

  addToCollection: (id: number, gameIds: number[]) =>
    request<Collection>(`/collections/${id}/games`, {
      method: "POST",
      body: JSON.stringify({ ids: gameIds }),
    }),

  removeFromCollection: (id: number, gameId: number) =>
    request<void>(`/collections/${id}/games/${gameId}`, { method: "DELETE" }),

  tablebase: (fen: string, signal?: AbortSignal) =>
    request<TablebaseResult>(`/tablebase?fen=${encodeURIComponent(fen)}`, { signal }),

  getGame: (id: number) => request<GameDetail>(`/games/${id}`),

  importPgn: (pgn: string) =>
    request<ImportResult>("/games", {
      method: "POST",
      body: JSON.stringify({ pgn }),
    }),

  /** Games in your database more than once. Nothing is deleted by asking. */
  findDuplicates: () => request<{ groups: DuplicateGroup[]; total: number }>("/games/duplicates"),

  // ---- reports: crosstables, player dossiers, novelties ----

  listEvents: (q = "") =>
    request<EventSummary[]>(`/reports/events${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),

  crosstable: (event: string) =>
    request<Crosstable>(`/reports/crosstable?event=${encodeURIComponent(event)}`),

  findPlayers: (q: string) =>
    request<{ name: string; games: number }[]>(`/reports/players?q=${encodeURIComponent(q)}`),

  playerDossier: (name: string) =>
    request<PlayerDossier>(`/reports/player?name=${encodeURIComponent(name)}`),

  /** The first move of a line that the chosen database had never seen in its position. */
  findNovelty: (startFen: string, moves: string[], scope: NoveltyScope, gameId?: number | null) =>
    request<Novelty>("/reports/novelty", {
      method: "POST",
      body: JSON.stringify({ start_fen: startFen, moves, scope, game_id: gameId ?? null }),
    }),

  deleteGame: (id: number) => request<void>(`/games/${id}`, { method: "DELETE" }),

  analysePosition: (fen: string, depth = 20, multipv = 3, engine = getSettings().engine) =>
    request<{ job_id: number; status: string; cached: boolean; result: any }>(
      "/analysis/position",
      { method: "POST", body: JSON.stringify({ fen, depth, multipv, engine }) }
    ),

  analyseGame: (gameId: number, engine = getSettings().engine, depth = getSettings().depth) =>
    request<{ job_id: number; status: string }>(`/analysis/game/${gameId}?engine=${encodeURIComponent(engine)}&depth=${depth}`, {
      method: "POST",
    }),

  getJob: (jobId: number) =>
    request<{ job_id: number; status: string; result: any }>(
      `/analysis/jobs/${jobId}`
    ),

  explorer: (
    fen: string,
    scope: ExplorerScope = "reference",
    signal?: AbortSignal
  ) =>
    request<{ fen: string; total_games: number; moves: ExplorerMove[] }>(
      "/explorer",
      { method: "POST", body: JSON.stringify({ fen, scope,
        ...(scope === "lichess_live" && lichessExplorerToken ? { lichess_token: lichessExplorerToken } : {}),
      }), signal }
    ),

  // ---- reference database search ----

  /**
   * "Which games reached this exact position?" (BLUEPRINT 10.3) - master games
   * by default, or with scope "mine" your own.
   */
  searchPosition: (fen: string, page = 1, scope: NoveltyScope = "reference") =>
    request<SearchResults>(`/search/position?page=${page}`, {
      method: "POST",
      body: JSON.stringify({ fen, scope }),
    }),

  searchGames: (query: GameSearchQuery, page = 1) => {
    const q = new URLSearchParams({ page: String(page) });
    // Blank boxes are absent filters, not filters matching the empty string —
    // sending `white=` would have the server add a LIKE '%%' clause per field.
    for (const [key, value] of Object.entries(query)) {
      const v = typeof value === "string" ? value.trim() : value;
      if (v !== "" && v != null) q.set(key, String(v));
    }
    return request<SearchResults>(`/search/games?${q.toString()}`);
  },

  // ---- repertoire training ----

  createRepertoire: (name: string, color: "white" | "black", pgn: string) =>
    request<Repertoire>("/repertoires", {
      method: "POST",
      body: JSON.stringify({ name, color, pgn }),
    }),

  listRepertoires: () => request<Repertoire[]>("/repertoires"),

  listOpenings: () => request<Opening[]>("/openings"),

  trainOpening: (id: string) =>
    request<Repertoire>(`/openings/${id}/train`, { method: "POST" }),

  listEngines: () => request<EngineInfo[]>("/engines"),

  // ---- opponent prep  ----

  prepOpponent: (platform: "lichess" | "chesscom", username: string) =>
    request<PrepDossier>("/prep/opponent", {
      method: "POST",
      body: JSON.stringify({ platform, username }),
    }),

  prepRepertoire: (
    platform: "lichess" | "chesscom",
    username: string,
    my_color: "white" | "black",
  ) =>
    request<Repertoire>("/prep/opponent/repertoire", {
      method: "POST",
      body: JSON.stringify({ platform, username, my_color }),
    }),

  deleteRepertoire: (id: number) =>
    request<void>(`/repertoires/${id}`, { method: "DELETE" }),

  syncBlunders: () =>
    request<{
      mistakes_found: number;
      cards_created: number;
      already_present: number;
      invalid: number;
    }>("/training/blunders/sync", { method: "POST" }),

  dueCards: (limit = 20, repertoire?: number) =>
    request<TrainingCard[]>(
      `/training/due?limit=${limit}${repertoire ? `&repertoire=${repertoire}` : ""}`
    ),

  answerCard: (card_id: number, answer_uci: string) =>
    request<TrainingResult>("/training/answer", {
      method: "POST",
      body: JSON.stringify({ card_id, answer_uci }),
    }),

  // ---- tactics puzzles ----

  nextPuzzle: (opts?: { theme?: string; rating?: number; mode?: "practice" | "rush" | "clock" }) => {
    const q = new URLSearchParams();
    if (opts?.theme) q.set("theme", opts.theme);
    if (opts?.rating != null) q.set("rating", String(opts.rating));
    if (opts?.mode) q.set("mode", opts.mode);
    const qs = q.toString();
    return request<Puzzle>(`/puzzles/next${qs ? `?${qs}` : ""}`);
  },

  attemptPuzzle: (puzzle_id: number, solved: boolean) =>
    request<PuzzleAttemptResult>("/puzzles/attempt", {
      method: "POST",
      body: JSON.stringify({ puzzle_id, solved }),
    }),

  puzzleStats: () => request<PuzzleStats>("/puzzles/stats"),

  puzzleThemes: () => request<PuzzleTheme[]>("/puzzles/themes"),

  rushStart: () => request<{ ok: boolean }>("/puzzles/rush/start", { method: "POST" }),

  clockStart: () => request<{ ok: boolean }>("/puzzles/clock/start", { method: "POST" }),

  // ---- intuition trainer ----

  intuitionStart: () => request<{ ok: boolean }>("/intuition/start", { method: "POST" }),

  intuitionNext: () => request<IntuitionPosition>("/intuition/next"),

  // ---- play vs computer ----

  playMove: (fen: string, level: number) =>
    request<{ move: string | null; game_over: boolean }>("/play/move", {
      method: "POST",
      body: JSON.stringify({ fen, level }),
    }),

  // ---- connected accounts (auto-import) ----

  listAccounts: () => request<ExternalAccount[]>("/me/accounts"),

  connectAccount: (platform: "lichess" | "chesscom", username: string) =>
    request<SyncResult>("/me/accounts", {
      method: "POST",
      body: JSON.stringify({ platform, username }),
    }),

  syncAccount: (platform: "lichess" | "chesscom") =>
    request<SyncResult>(`/me/accounts/${platform}/sync`, { method: "POST" }),

  disconnectAccount: (platform: "lichess" | "chesscom") =>
    request<void>(`/me/accounts/${platform}`, { method: "DELETE" }),

  // ---- insights ----

  insights: (opts: InsightsQuery = {}) => {
    const q = new URLSearchParams();
    if (opts.timeClass) q.set("time_class", opts.timeClass);
    if (opts.color) q.set("color", opts.color);
    if (opts.range && opts.range !== "all") q.set("range", opts.range);
    // The server stores UTC; the time-of-day chart is only meaningful in the
    // reader's own clock, so tell it where we are.
    q.set("tz_offset", String(-new Date().getTimezoneOffset()));
    return request<Insights>(`/insights?${q.toString()}`);
  },

  /** Insights for somebody else. */
  playerInsights: (
    source: InsightsSource,
    username: string,
    opts: InsightsQuery = {},
  ) => {
    const q = new URLSearchParams({ source, username });
    if (opts.timeClass) q.set("time_class", opts.timeClass);
    if (opts.color) q.set("color", opts.color);
    if (opts.range && opts.range !== "all") q.set("range", opts.range);
    q.set("tz_offset", String(-new Date().getTimezoneOffset()));
    return request<Insights>(`/insights/player?${q.toString()}`);
  },

  /** Name-complete against the over-the-board reference database. */
  searchOtbPlayers: (q: string) =>
    request<OtbPlayer[]>(`/insights/players?q=${encodeURIComponent(q)}`),

  // ---- studies ----
  //
  // `ref` is a study id for one of yours, or a share slug for one you were
  // sent. The server takes either at every path, so a page opened from a link
  // uses exactly the same calls as one opened from your own list.

  listStudies: () => request<Study[]>("/studies"),

  /** Studies their owners published, for anybody to browse. */
  publicStudies: (opts: { q?: string; topic?: string; sort?: PublicStudySort; page?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q?.trim()) q.set("q", opts.q.trim());
    if (opts.topic) q.set("topic", opts.topic);
    q.set("sort", opts.sort ?? "popular");
    q.set("page", String(opts.page ?? 1));
    return request<StudyPage>(`/studies/public?${q.toString()}`);
  },

  getStudy: (ref: string) => request<StudyDetail>(`/studies/${encodeURIComponent(ref)}`),

  createStudy: (body: {
    name: string;
    description?: string;
    visibility?: StudyVisibility;
    from_game_id?: number;
    pgn?: string;
    topics?: string[];
  }) => request<StudyDetail>("/studies", { method: "POST", body: JSON.stringify(body) }),

  /** Copy a study you can read into a private one of your own. */
  cloneStudy: (ref: string, name?: string) =>
    request<StudyDetail>(`/studies/${encodeURIComponent(ref)}/clone`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    }),

  likeStudy: (ref: string, like: boolean) =>
    request<{ likes: number; liked: boolean }>(`/studies/${encodeURIComponent(ref)}/like`, {
      method: like ? "POST" : "DELETE",
    }),

  updateStudy: (
    ref: string,
    body: {
      name?: string;
      description?: string;
      visibility?: StudyVisibility;
      topics?: string[];
    },
  ) =>
    request<Study>(`/studies/${encodeURIComponent(ref)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteStudy: (ref: string) =>
    request<void>(`/studies/${encodeURIComponent(ref)}`, { method: "DELETE" }),

  /** Mint a new slug, breaking every link already handed out. */
  reshareStudy: (ref: string) =>
    request<Study>(`/studies/${encodeURIComponent(ref)}/reshare`, { method: "POST" }),

  createChapter: (ref: string, body: ChapterDraft) =>
    request<StudyChapter>(`/studies/${encodeURIComponent(ref)}/chapters`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Several chapters at once - a multi-game PGN. All are added, or none. */
  importChapters: (ref: string, chapters: ChapterDraft[]) =>
    request<StudyChapter[]>(`/studies/${encodeURIComponent(ref)}/chapters/import`, {
      method: "POST",
      body: JSON.stringify({ chapters }),
    }),

  /**
   * Save a chapter.
   *
   * A body carrying `pgn` must carry the `version` it was read at. The server
   * refuses a stale one with 409 `stale_chapter` rather than overwriting
   * whatever somebody else saved in the meantime — a chapter is written whole,
   * so a stale save does not merge badly, it merges not at all.
   */
  updateChapter: (
    ref: string,
    chapterId: number,
    body: {
      name?: string;
      description?: string;
      pgn?: string;
      orientation?: "white" | "black";
      mode?: ChapterMode;
      hide_engine?: boolean;
      tags?: Record<string, string>;
      version?: number;
    },
  ) =>
    request<StudyChapter>(
      `/studies/${encodeURIComponent(ref)}/chapters/${chapterId}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),

  deleteChapter: (ref: string, chapterId: number) =>
    request<void>(`/studies/${encodeURIComponent(ref)}/chapters/${chapterId}`, {
      method: "DELETE",
    }),

  reorderChapters: (ref: string, chapterIds: number[]) =>
    request<void>(`/studies/${encodeURIComponent(ref)}/chapters/order`, {
      method: "POST",
      body: JSON.stringify({ chapter_ids: chapterIds }),
    }),

  addStudyMember: (ref: string, email: string) =>
    request<StudyMember[]>(`/studies/${encodeURIComponent(ref)}/members`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  removeStudyMember: (ref: string, userId: number) =>
    request<StudyMember[]>(`/studies/${encodeURIComponent(ref)}/members/${userId}`, {
      method: "DELETE",
    }),

  studyPgnUrl: (ref: string, chapterId?: number) =>
    `${API_URL}/studies/${encodeURIComponent(ref)}/pgn${
      chapterId != null ? `?chapter=${chapterId}` : ""
    }`,

  /** Download a study (or one chapter of it) as PGN, signed in. */
  downloadStudyPgn: async (ref: string, name: string, chapterId?: number) => {
    const text = await requestText(
      `/studies/${encodeURIComponent(ref)}/pgn${chapterId != null ? `?chapter=${chapterId}` : ""}`
    );
    saveTextFile(text, `${slugName(name)}.pgn`);
  },

  downloadGames: async (ids: number[], name = "games") => {
    saveTextFile(await api.exportGames(ids), `${slugName(name)}.pgn`);
  },
};

export { ApiError, API_URL };
