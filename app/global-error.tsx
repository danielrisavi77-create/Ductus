"use client";

import { useLayoutEffect } from "react";

import AppHeader from "@/components/shell/AppHeader";
import ErrorScreen from "@/components/shell/ErrorScreen";
import { readTheme, THEME_SCRIPT } from "@/components/shell/theme";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { fontVariables } from "./fonts";

import "./fonts/fonts.css";
import "./globals.css";

// #732 item 3: an error in the root layout itself replaces the whole document,
// so this page brings its own <html> in Croatian, fonts, tokens and the theme
// choice (Z-13a): the inline script when the server sends it, the effect when
// it replaces the document in the browser.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useLayoutEffect(() => {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      // Storage blocked: the page stays dark.
    }
    document.documentElement.setAttribute("data-theme", readTheme(storage));
  }, []);
  return (
    <html lang="hr" className={fontVariables} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <title>{`${t.errorPage.errorTitle} · ${t.app.name}`}</title>
        <AppHeader />
        <ErrorScreen title={t.errorPage.errorTitle} body={t.errorPage.errorBody} onRetry={reset} />
      </body>
    </html>
  );
}
