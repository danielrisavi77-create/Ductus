/**
 * The writing sheet's theme (D-115). The shell is always dark; the sheet is
 * light unless the writer chose otherwise. The choice is a display preference
 * kept only in this browser; it never reaches the server and holds no
 * personal data.
 */

export type SheetTheme = "light" | "dark";

export const SHEET_THEME_DEFAULT: SheetTheme = "light";
export const SHEET_THEME_KEY = "ductus.sheetTheme";

/** Anything but the two known values is the default; a stale value never breaks the page. */
export function parseSheetTheme(value: unknown): SheetTheme {
  return value === "dark" || value === "light" ? value : SHEET_THEME_DEFAULT;
}

/** Storage can throw (private window, blocked site data); then the default stands. */
export function readSheetTheme(storage: Pick<Storage, "getItem"> | undefined): SheetTheme {
  try {
    return parseSheetTheme(storage?.getItem(SHEET_THEME_KEY));
  } catch {
    return SHEET_THEME_DEFAULT;
  }
}

export function writeSheetTheme(storage: Pick<Storage, "setItem"> | undefined, theme: SheetTheme): void {
  try {
    storage?.setItem(SHEET_THEME_KEY, theme);
  } catch {
    // The choice then lasts until the page closes; nothing else depends on it.
  }
}
