import { cookies } from "next/headers";
import Link from "next/link";

import AppHeader from "@/components/shell/AppHeader";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export default async function HomePage() {
  // With a session cookie, signing in again would switch accounts past the
  // sign-out check on /rad, so the page offers only the workspace.
  const hasSession = (await cookies()).has(SESSION_COOKIE_NAME);
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
          </Link>
          {hasSession ? null : (
            <>
              {" "}
              {/* A plain link: the login route answers with a redirect to the provider. */}
              <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent("/rad")}`}>
                {t.auth.signIn}
              </a>
            </>
          )}
        </p>
      </main>
    </>
  );
}
