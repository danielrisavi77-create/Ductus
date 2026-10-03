import Link from "next/link";

import AppHeader from "@/components/shell/AppHeader";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main id="sadrzaj" className="page">
        <h1>{t.app.name}</h1>
        <p>{t.app.tagline}</p>
        <p>{t.home.lead}</p>
        <p>
          <Link className="btn" href="/rad">
            {t.home.openWorkspace}
          </Link>
        </p>
      </main>
    </>
  );
}
