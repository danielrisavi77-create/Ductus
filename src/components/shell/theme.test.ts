import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { readTheme, saveTheme, THEME_KEY, THEME_SCRIPT, themeOf } from "./theme";

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

  // The inline script sets the attribute on its parent before paint; nothing else.
  function run(stored: string | null | Error) {
    const attrs = new Map<string, string>();
    const parent = { setAttribute: (k: string, v: string) => void attrs.set(k, v) };
    const localStorage = {
      getItem: () => {
        if (stored instanceof Error) throw stored;
        return stored;
      },
    };
    runInNewContext(THEME_SCRIPT, { document: { currentScript: { parentElement: parent } }, localStorage });
    return attrs.get("data-theme");
  }

  it("the inline script turns the shell light only for a stored light theme", () => {
    expect(run("light")).toBe("light");
    expect(run("dark")).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(run("<img>")).toBeUndefined();
    expect(run(new Error("blocked"))).toBeUndefined();
  });
});
