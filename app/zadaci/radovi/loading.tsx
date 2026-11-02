import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-309: shown while /zadaci/radovi reads the student's works; a wait,
// never the empty list or an older one.
export default function MyWorksLoading() {
  return (
    <>
      <AppHeader context={t.student.works.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
