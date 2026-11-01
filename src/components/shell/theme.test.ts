import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { readTheme, saveTheme, THEME_KEY, THEME_SCRIPT, themeOf, toggleTheme } from "./theme";

describe("shell theme (#476 6314969336, t. 5)", () => {
  it("is dark unless the browser kept exactly 'light'", () => {
    expect(themeOf("light")).toBe("light");
    for (const value of [null, undefined, "", "dark", "LIGHT", "svijetla"]) expect(themeOf(value)).toBe("dark");
  });

  it("never throws when storage is missing or refuses", () => {
    const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readTheme(undefined)).toBe("dark");
    expect(readTheme(refusing)).toBe("dark");
    expect(() => saveTheme(refusing, "light")).not.toThrow();
  });

  it("keeps the choice under its key", () => {
    const kept = new Map<string, string>();
    saveTheme({ setItem: (k, v) => void kept.set(k, v) }, "light");
    expect(kept.get(THEME_KEY)).toBe("light");
    expect(readTheme({ getItem: (k) => kept.get(k) ?? null })).toBe("light");
  });

  // Z-13a: the inline script in <head> sets the attribute on <html> before
  // the body is painted; nothing else.
  function run(stored: string | null | Error) {
    const attrs = new Map<string, string>();
    const documentElement = { setAttribute: (k: string, v: string) => void attrs.set(k, v) };
    const localStorage = {
      getItem: () => {
        if (stored instanceof Error) throw stored;
        return stored;
      },
    };
    runInNewContext(THEME_SCRIPT, { document: { documentElement, currentScript: null }, localStorage });
    return attrs.get("data-theme");
  }

  it("the inline script turns the whole document light only for a stored light theme", () => {
    expect(run("light")).toBe("light");
    expect(run("dark")).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(run("<img>")).toBeUndefined();
    expect(run(new Error("blocked"))).toBeUndefined();
  });

  it("the switch flips <html> between dark and light and keeps the choice", () => {
    const attrs = new Map<string, string>([["data-theme", "dark"]]);
    const root = { getAttribute: (k: string) => attrs.get(k) ?? null, setAttribute: (k: string, v: string) => void attrs.set(k, v) };
    const kept = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(toggleTheme(root, storage)).toBe("light");
    expect([attrs.get("data-theme"), kept.get(THEME_KEY)]).toEqual(["light", "light"]);
    expect(toggleTheme(root, storage)).toBe("dark");
    expect([attrs.get("data-theme"), kept.get(THEME_KEY)]).toEqual(["dark", "dark"]);
    // Blocked storage: the page still changes.
    expect(toggleTheme(root, { setItem: () => { throw new Error("blocked"); } })).toBe("light");
    expect(toggleTheme(root, undefined)).toBe("dark");
  });
});
