import { describe, expect, it } from "vitest";

import { parseSheetTheme, readSheetTheme, SHEET_THEME_KEY, writeSheetTheme } from "./sheet-theme";

describe("sheet theme", () => {
  it("is dark unless light is stored (D-123)", () => {
    expect(parseSheetTheme(undefined)).toBe("dark");
    expect(parseSheetTheme(null)).toBe("dark");
    expect(parseSheetTheme("sepia")).toBe("dark");
    expect(parseSheetTheme("dark")).toBe("dark");
    expect(parseSheetTheme("light")).toBe("light");
  });

  it("round-trips through storage under one key", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    writeSheetTheme(storage, "light");
    expect(data.get(SHEET_THEME_KEY)).toBe("light");
    expect(readSheetTheme(storage)).toBe("light");
  });

  it("falls back to dark and does not throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSheetTheme(blocked)).toBe("dark");
    expect(() => writeSheetTheme(blocked, "light")).not.toThrow();
    expect(readSheetTheme(undefined)).toBe("dark");
  });
});
