import { describe, expect, it } from "vitest";

import { parseSheetTheme, readSheetTheme, SHEET_THEME_KEY, writeSheetTheme } from "./sheet-theme";

describe("sheet theme", () => {
  it("is light unless dark is stored", () => {
    expect(parseSheetTheme(undefined)).toBe("light");
    expect(parseSheetTheme(null)).toBe("light");
    expect(parseSheetTheme("sepia")).toBe("light");
    expect(parseSheetTheme("dark")).toBe("dark");
    expect(parseSheetTheme("light")).toBe("light");
  });

  it("round-trips through storage under one key", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    writeSheetTheme(storage, "dark");
    expect(data.get(SHEET_THEME_KEY)).toBe("dark");
    expect(readSheetTheme(storage)).toBe("dark");
  });

  it("falls back to light and does not throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSheetTheme(blocked)).toBe("light");
    expect(() => writeSheetTheme(blocked, "dark")).not.toThrow();
    expect(readSheetTheme(undefined)).toBe("light");
  });
});
