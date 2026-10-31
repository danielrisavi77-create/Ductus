"use client";

import AppHeader from "@/components/shell/AppHeader";
import ErrorScreen from "@/components/shell/ErrorScreen";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-344: an unexpected error while /zadaci renders. Like the unavailable
// read, it is never the empty list; the error itself is not shown.
export default function MyAssignmentsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <AppHeader context={t.student.assignments.title} />
      <ErrorScreen title={t.student.home.unavailableHeading} body={t.student.home.unavailableBody} onRetry={reset} />
    </>
  );
}
