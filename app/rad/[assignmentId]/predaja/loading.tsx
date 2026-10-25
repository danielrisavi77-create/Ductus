import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 4: shown while the submission page reads the work.
export default function SubmissionLoading() {
  return (
    <>
      <AppHeader context={t.submission.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
