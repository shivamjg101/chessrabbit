import { describe, expect, it } from "vitest";

import { BOARD_THEMES, DEFAULT_THEME, themeById } from "@/lib/boardTheme";
import { DEFAULTS } from "@/lib/settings";

describe("board theme defaults", () => {
  it("uses walnut for new settings", () => {
    expect(DEFAULTS.boardTheme).toBe("walnut");
    expect(DEFAULT_THEME.id).toBe(DEFAULTS.boardTheme);
  });

  it("keeps all saved board IDs selectable", () => {
    for (const theme of BOARD_THEMES) {
      expect(themeById(theme.id)).toBe(theme);
    }
    expect(themeById("unknown")).toBe(DEFAULT_THEME);
  });
});
