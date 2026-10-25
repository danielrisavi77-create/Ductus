import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 4: shown while the workspace reads the work and its assignment.
export default function WorkspaceLoading() {
  return (
    <>
      <AppHeader context={t.workspace.title} />
      <RouteLoading label={t.workspace.panelLoading} />
    </>
  );
}
