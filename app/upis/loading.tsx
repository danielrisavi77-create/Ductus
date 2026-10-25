import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 4: shown while the enrolment page reads the session.
export default function EnrollLoading() {
  return (
    <>
      <AppHeader context={t.student.enroll.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
