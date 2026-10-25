import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// #732 item 4: shown while the fast path reads the works.
export default function FastPathLoading() {
  return (
    <>
      <AppHeader context={t.fastPath.title} />
      <RouteLoading label={t.fastPath.loading} />
    </>
  );
}
