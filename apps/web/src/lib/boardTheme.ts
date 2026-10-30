"use client";

import { useMemo } from "react";

import { useSettings } from "@/lib/settings";

/**
 * Board looks, shared by every board in the app (analysis, play, training).
 *
 * Each theme owns its own last-move highlight: a tint that reads on walnut is
 * invisible on slate, so the highlight travels with the squares rather than
 * being one global colour.
 *
 * Types mirror react-chessboard's props (plain style records, not
 * CSSProperties) so a theme can be spread straight onto <Chessboard />.
 */
export interface BoardTheme {
  id: string;
  label: string;
  light: string;
  dark: string;
  /** Tint for the square a piece left, and the one it landed on. */
  fromTint: string;
  toTint: string;
}

/**
 * The default is walnut: warm timber squares seated in cool glass. The board
 * is the one warm object on the page, so the eye lands on the position before
 * it lands on any chrome. The cool themes stay one click away in Settings.
 *
 * Green is still ruled out as a board colour: mint means "you played the right
 * move" everywhere else in the UI, and a green board would spend that meaning
 * on decoration.
 *
 * The squares are opaque on purpose. Glass is for the chrome around the board;
 * a translucent square would let the aurora shift the colour of the position.
 */
export const BOARD_THEMES: BoardTheme[] = [
  {
    id: "walnut",
    label: "Walnut",
    light: "#E4D9C4",
    dark: "#9A7550",
    fromTint: "rgba(255, 205, 74, 0.5)",
    toTint: "rgba(255, 205, 74, 0.64)",
  },
  {
    id: "frost",
    label: "Frost",
    light: "#E6EAF3",
    dark: "#7D93B4",
    fromTint: "rgba(86, 198, 245, 0.42)",
    toTint: "rgba(158, 226, 255, 0.6)",
  },
  {
    id: "slate",
    label: "Chalk & slate",
    light: "#DCD9CC",
    dark: "#4A737E",
    fromTint: "rgba(201, 156, 86, 0.42)",
    toTint: "rgba(229, 190, 119, 0.58)",
  },
  {
    id: "ink",
    label: "Chalk & ink",
    light: "#D7DAE0",
    dark: "#455A80",
    fromTint: "rgba(201, 156, 86, 0.42)",
    toTint: "rgba(229, 190, 119, 0.58)",
  },
  {
    id: "graphite",
    label: "Graphite",
    light: "#D5D4CF",
    dark: "#5C6470",
    fromTint: "rgba(201, 156, 86, 0.45)",
    toTint: "rgba(229, 190, 119, 0.6)",
  },
  {
    id: "verdigris",
    label: "Verdigris",
    light: "#DBDDD2",
    dark: "#4F7D74",
    fromTint: "rgba(201, 156, 86, 0.45)",
    toTint: "rgba(229, 190, 119, 0.6)",
  },
  {
    id: "plum",
    label: "Iron & plum",
    light: "#DCD7DE",
    dark: "#6A5680",
    fromTint: "rgba(229, 190, 119, 0.48)",
    toTint: "rgba(229, 190, 119, 0.64)",
  },
  {
    id: "contrast",
    label: "High contrast",
    light: "#FFFFFF",
    dark: "#2F4257",
    fromTint: "rgba(255, 214, 0, 0.62)",
    toTint: "rgba(255, 214, 0, 0.78)",
  },
];

export const DEFAULT_THEME = BOARD_THEMES[0];

/**
 * Thickness of the glass bezel (`.board-frame`) on one side, in px.
 *
 * Boards that are told their exact pixel size have to subtract this from the
 * space they measure, or the frame pushes the board past the box it was
 * measured into. Boards that simply fill their container ignore it — the
 * padding does the work there. Keep in step with `.board-frame` in globals.css.
 */
export const BOARD_FRAME = 10;

export function themeById(id: string): BoardTheme {
  return BOARD_THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** Props for <Chessboard {...boardProps(theme, showCoordinates)} />. */
export function boardProps(theme: BoardTheme, showCoordinates = true) {
  return {
    // No drop shadow here: the board is seated inside `.board-frame`, and the
    // bezel is what casts onto the page. A second shadow on the squares
    // themselves would read as the board floating above its own surround.
    customBoardStyle: {
      borderRadius: "2px",
    } as Record<string, string | number>,
    customDarkSquareStyle: { backgroundColor: theme.dark } as Record<string, string>,
    customLightSquareStyle: { backgroundColor: theme.light } as Record<string, string>,
    showBoardNotation: showCoordinates,
  };
}

/**
 * The active board, from the user's saved settings. Use this anywhere a board
 * is rendered so a theme change applies everywhere at once.
 */
export function useBoardTheme() {
  const settings = useSettings();
  // Rebuilt only when the theme actually changes. These go straight onto the
  // board as props, and a fresh object per render is a prop change to every
  // square on it - paid on every render of whatever page holds the board.
  return useMemo(() => {
    const theme = themeById(settings.boardTheme);
    return {
      theme,
      props: boardProps(theme, settings.showCoordinates),
      lastMoveFrom: { background: theme.fromTint },
      lastMoveTo: { background: theme.toTint },
      animationMs: settings.animationMs,
    };
  }, [settings.boardTheme, settings.showCoordinates, settings.animationMs]);
}
