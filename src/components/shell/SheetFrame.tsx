"use client";

import type { ReactNode } from "react";

import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { setSheetTheme, useSheetTheme } from "./useSheetTheme";

/**
 * The sheet with its theme switch (D-115, D-123). The theme lives in one
 * store per page (useSheetTheme), so the "Prikaz" menu of the editor toolbar
 * and this switch never disagree. Where that menu is on the page (/rad with a
 * toolbar, FE-D5) the switch here is hidden by CSS, so the theme has one
 * place; without a toolbar it stays, so the theme is always reachable.
 *
 * The switch is a pair of toggle buttons: the pressed one is announced with
 * `aria-pressed` and marked with a check mark, never by colour alone.
 */
export default function SheetFrame({ children }: { children: ReactNode }) {
  const theme = useSheetTheme();

  return (
    <>
      <div className="sheet-theme" role="group" aria-label={t.workspace.sheetTheme}>
        <div className="sheet-theme__options">
          <button
            type="button"
            className="sheet-theme__option"
            aria-pressed={theme === "dark"}
            onClick={() => setSheetTheme("dark")}
          >
            {t.workspace.sheetThemeDark}
          </button>
          <button
            type="button"
            className="sheet-theme__option"
            aria-pressed={theme === "light"}
            onClick={() => setSheetTheme("light")}
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
