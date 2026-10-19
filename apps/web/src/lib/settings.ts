"use client";

import { useSyncExternalStore } from "react";

/**
 * Analysis preferences, persisted per browser.
 *
 * These live client-side on purpose: they are per-device taste (board colours,
 * animation speed) or a request parameter the server re-checks anyway (depth,
 * number of lines are clamped to the configured ceiling in ws/analysis.py). Nothing
 * here is trusted — turning the depth up in devtools buys you nothing.
 */
export interface Settings {
  engine: string;
  /** Engine search depth to request. Server clamps to the configured maximum. */
  depth: number;
  /** Full-game review depth, independent of live position analysis. */
  reviewDepth: number;
  /** Candidate lines to request. Server clamps to the configured maximum. */
  multipv: number;
  /** Re-analyse automatically whenever the position changes. */
  autoAnalyse: boolean;

  showEvalBar: boolean;
  /** Arrow for the move the engine preferred, on reviewed games. */
  showBestArrow: boolean;
  /** Move-verdict badge on the destination square. */
  showVerdictBadge: boolean;
  showCoordinates: boolean;
  highlightLastMove: boolean;
  /** Piece slide duration in ms; 0 disables animation. */
  animationMs: number;

  boardTheme: string;
}

export const DEFAULTS: Settings = {
  engine: "stockfish",
  depth: 22,
  reviewDepth: 18,
  // One line by default. MultiPV 3 costs roughly 2-3x MultiPV 1 at the same
  // depth because the engine cannot prune to a single best line, and it is
  // requested on every board navigation - so it sized the engine fleet while
  // most readers only look at the top line. Raising it is one click away in
  // Analysis settings, and the eval bar and best-move arrow both come from
  // line 1 regardless.
  multipv: 1,
  autoAnalyse: true,
  showEvalBar: true,
  showBestArrow: true,
  showVerdictBadge: true,
  showCoordinates: true,
  highlightLastMove: true,
  animationMs: 200,
  // Match BOARD_THEMES[0].id; importing it would create a settings cycle.
  boardTheme: "walnut",
};

/** Selectable engine depths and line counts, shared with the settings UI. */
export const DEPTH_CHOICES = [12, 16, 18, 20, 22, 26, 30, 36, 40];
export const LINE_CHOICES = [1, 2, 3, 4, 5, 10];

const KEY = "cr_settings";

let current: Settings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    // Merge over defaults so a settings file written by an older build (or a
    // hand-edited one) can never leave a key undefined.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

function snapshot(): Settings {
  if (!loaded) {
    current = load();
    loaded = true;
  }
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...snapshot(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode / quota — keep the in-memory value */
  }
  listeners.forEach((fn) => fn());
}

export function resetSettings(): void {
  updateSettings(DEFAULTS);
}

/** Clamp preferences to the configured resource limits. */
export function clampToResources(maxDepth: number, maxLines: number): void {
  const s = snapshot();
  const patch: Partial<Settings> = {};
  // Snap to the largest offered choice within the ceiling, so the value we
  // land on is always one the picker can actually show as selected.
  if (s.depth > maxDepth) {
    const allowed = DEPTH_CHOICES.filter((d) => d <= maxDepth);
    patch.depth = allowed.length ? allowed[allowed.length - 1] : maxDepth;
  }
  if (s.reviewDepth > maxDepth) {
    const allowed = DEPTH_CHOICES.filter((d) => d <= maxDepth);
    patch.reviewDepth = allowed.length ? allowed[allowed.length - 1] : maxDepth;
  }
  if (s.multipv > maxLines) patch.multipv = Math.max(1, maxLines);
  if (Object.keys(patch).length) updateSettings(patch);
}

/**
 * Every consumer reads the same store, so the modal and the board stay in step
 * without threading props through the tree.
 */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
}

export const getSettings = snapshot;
