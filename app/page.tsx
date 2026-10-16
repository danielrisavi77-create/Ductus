import Link from "next/link";

import AppHeader from "@/components/shell/AppHeader";
import { messagesHr as t } from "@/lib/i18n/messages.hr";

export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.app.name}</h1>
        <p>{t.app.tagline}</p>
        <p>{t.home.lead}</p>
        <p>
          <Link className="btn" href="/rad">
            {t.home.openWorkspace}
          </Link>{" "}
          {/* A plain link: the login route answers with a redirect to the provider. */}
          <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent("/rad")}`}>
            {t.auth.signIn}
          </a>
        </p>
      </main>
    </>
  );
}
