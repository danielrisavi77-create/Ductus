import { describe, expect, it } from "vitest";

import { parseSheetTheme, readSheetTheme, SHEET_THEME_KEY, writeSheetTheme } from "./sheet-theme";

describe("sheet theme", () => {
  it("is the near-white paper unless dark is stored (D-188, was dark by D-123)", () => {
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
    writeSheetTheme(storage, "light");
    expect(data.get(SHEET_THEME_KEY)).toBe("light");
    expect(readSheetTheme(storage)).toBe("light");
  });

  it("falls back to the paper and does not throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSheetTheme(blocked)).toBe("light");
    expect(() => writeSheetTheme(blocked, "light")).not.toThrow();
    expect(readSheetTheme(undefined)).toBe("light");
  });
});
