import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("defaults old preferences to review depth 18 and clamps it independently", async () => {
  const values = new Map([["cr_settings", JSON.stringify({ depth: 22 })]]);
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  const { getSettings, updateSettings, clampToResources } = await import("./settings");
  expect(getSettings().reviewDepth).toBe(18);
  updateSettings({ reviewDepth: 26 });
  expect(getSettings().depth).toBe(22);
  clampToResources(20, 10);
  expect(getSettings().reviewDepth).toBe(20);
  expect(getSettings().depth).toBe(20);
});

it("uses walnut for new settings without replacing a saved board choice", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  const { getSettings } = await import("./settings");
  expect(getSettings().boardTheme).toBe("walnut");

  vi.resetModules();
  values.set("cr_settings", JSON.stringify({ boardTheme: "slate" }));
  const { getSettings: getSavedSettings } = await import("./settings");
  expect(getSavedSettings().boardTheme).toBe("slate");
});
