"use client";

import AppHeader from "@/components/shell/AppHeader";
import ErrorScreen from "@/components/shell/ErrorScreen";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 3: an unexpected error inside the root layout. The error itself is
// not shown: its message is English and may carry internal detail.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <title>{`${t.errorPage.errorTitle} · ${t.app.name}`}</title>
      <AppHeader />
      <ErrorScreen title={t.errorPage.errorTitle} body={t.errorPage.errorBody} onRetry={reset} />
    </>
  );
}
