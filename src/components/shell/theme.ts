/**
 * The light or dark theme of the design v3 shell (#476 6314969336, t. 5). The
 * choice lives only in this browser (`localStorage`), is never sent to the
 * server, and anything but "light" is dark, the default. It applies to the
 * whole document (`data-theme` on `<html>`, Z-13a), so the 404, error and
 * loading screens outside the shell follow the same choice. The shell does
 * not follow the system setting (D-188).
 */
export type ShellTheme = "light" | "dark";

export const THEME_KEY = "ductura.theme";

export function themeOf(stored: string | null | undefined): ShellTheme {
  return stored === "light" ? "light" : "dark";
}

/** What the browser keeps, read without ever throwing (private mode, blocked storage). */
export function readTheme(storage: Pick<Storage, "getItem"> | undefined): ShellTheme {
  try {
    return themeOf(storage?.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function saveTheme(storage: Pick<Storage, "setItem"> | undefined, theme: ShellTheme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // The theme still changes on this page; it is only not remembered.
  }
}

/** Flips the theme on `<html>` and keeps the new one; returns it. */
export function toggleTheme(root: Pick<HTMLElement, "getAttribute" | "setAttribute">, storage: Pick<Storage, "setItem"> | undefined): ShellTheme {
  const next: ShellTheme = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  saveTheme(storage, next);
  return next;
}

/**
 * Runs inline in `<head>` (app/layout.tsx, app/global-error.tsx), before the
 * body is painted, so a stored light theme never flashes dark first.
 */
export const THEME_SCRIPT =
  `(function(){var e=document.documentElement;if(!e)return;` +
  `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light")e.setAttribute("data-theme","light")}catch(_){}})();`;
