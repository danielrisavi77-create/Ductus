"use client";

import { useEffect, useState, type ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";
import {
  readSheetTheme, SHEET_THEME_DEFAULT, writeSheetTheme, type SheetTheme,
} from "@/lib/ui/sheet-theme";

/**
 * The sheet with its theme switch (D-115, D-123). The server and the first
 * client render both use the dark default, so hydration matches; the stored
 * choice is applied right after. The switch is a pair of toggle buttons: the pressed
 * one is announced with `aria-pressed` and marked with a check mark, never by
 * colour alone.
 */
export default function SheetFrame({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<SheetTheme>(SHEET_THEME_DEFAULT);

  useEffect(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    setTheme(readSheetTheme(storage));
  }, []);

  function choose(next: SheetTheme) {
    setTheme(next);
    try {
      writeSheetTheme(window.localStorage, next);
    } catch {
      // Blocked storage: the choice holds for this page only.
    }
  }

  return (
    <>
      <div className="sheet-theme" role="group" aria-label={t.workspace.sheetTheme}>
        <div className="sheet-theme__options">
          <button
            type="button"
            className="sheet-theme__option"
            aria-pressed={theme === "dark"}
            onClick={() => choose("dark")}
          >
            {t.workspace.sheetThemeDark}
          </button>
          <button
            type="button"
            className="sheet-theme__option"
            aria-pressed={theme === "light"}
            onClick={() => choose("light")}
          >
            {t.workspace.sheetThemeLight}
          </button>
        </div>
      </div>
      <article className="sheet" data-sheet-theme={theme}>
        {children}
      </article>
    </>
  );
}
