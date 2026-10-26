import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-344: shown while /zadaci reads the student's courses; a wait, never
// the empty list or an older one.
export default function MyAssignmentsLoading() {
  return (
    <>
      <AppHeader context={t.student.assignments.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
