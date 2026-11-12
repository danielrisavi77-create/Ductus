import AppHeader from "@/components/shell/AppHeader";
import RouteLoading from "@/components/shell/RouteLoading";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

// DAN-294 (S-42): shown while the page reads the access log.
export default function AccessLogLoading() {
  return (
    <>
      <AppHeader context={t.accessLog.context} />
      <RouteLoading label={t.accessLog.loading} />
    </>
  );
}
