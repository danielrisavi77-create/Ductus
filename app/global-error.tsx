"use client";

import AppHeader from "@/components/shell/AppHeader";
import ErrorScreen from "@/components/shell/ErrorScreen";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

import { fontVariables } from "./fonts";

import "./fonts/fonts.css";
import "./globals.css";

// #732 item 3: an error in the root layout itself replaces the whole document,
// so this page brings its own <html> in Croatian, fonts and tokens.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="hr" className={fontVariables}>
      <body>
        <title>{`${t.errorPage.errorTitle} · ${t.app.name}`}</title>
        <AppHeader />
        <ErrorScreen title={t.errorPage.errorTitle} body={t.errorPage.errorBody} onRetry={reset} />
      </body>
    </html>
  );
}
