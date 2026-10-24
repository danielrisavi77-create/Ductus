/**
 * The light or dark theme of the design v3 shell (#476 6314969336, t. 5). The
 * choice lives only in this browser (`localStorage`), is never sent to the
 * server, and anything but "light" is dark, the default. It applies to the
 * shell's own subtree (`data-theme` on `.app-shell`), so pages outside the
 * shell keep the dark tokens they were checked with.
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

/**
 * Runs inline as the first child of `.app-shell`, before anything of the shell
 * is painted, so a stored light theme never flashes dark first.
 */
export const THEME_SCRIPT =
  `(function(){var e=document.currentScript&&document.currentScript.parentElement;if(!e)return;` +
  `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light")e.setAttribute("data-theme","light")}catch(_){}})();`;
