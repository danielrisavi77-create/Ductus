import { cookies } from "next/headers";
import Link from "next/link";

import AppHeader from "@/components/shell/AppHeader";
import SessionObserver from "@/components/shell/SessionObserver";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export default async function HomePage() {
  // Convenience only, not a safeguard: a person with a session is pointed at
  // the workspace. The login route stays reachable, and a sign-in that
  // replaces the cookie ends the earlier session's tabs (SessionObserver).
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return (
    <>
      <SessionObserver tag={sessionTag(token)} at={Date.now()} />
      <AppHeader />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.app.name}</h1>
        <p>{t.app.tagline}</p>
        <p>{t.home.lead}</p>
        <p>
          <Link className="btn" href="/rad">
            {t.home.openWorkspace}
          </Link>
          {token !== undefined ? null : (
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
