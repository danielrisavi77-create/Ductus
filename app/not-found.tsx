import AppHeader from "@/components/shell/AppHeader";
import ErrorScreen from "@/components/shell/ErrorScreen";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export const metadata = { title: `${t.errorPage.notFoundTitle} · ${t.app.name}` };

// #732 item 3: an unknown address gets a Croatian page, not the Next.js default (D-84).
export default function NotFound() {
  return (
    <>
      <AppHeader />
      <ErrorScreen title={t.errorPage.notFoundTitle} body={t.errorPage.notFoundBody} />
    </>
  );
}
