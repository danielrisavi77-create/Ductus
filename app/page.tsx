import { cookies } from "next/headers";
import Link from "next/link";

import Landing from "@/components/landing/Landing";
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
  const observer = <SessionObserver tag={sessionTag(token)} at={Date.now()} />;
  // Without a session cookie the public home page (FE-H1, #476); with one the
  // screen stays as it was.
  if (token === undefined) {
    return (
      <>
        {observer}
        <Landing />
      </>
    );
  }
  return (
    <>
      {observer}
      <AppHeader />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.app.name}</h1>
        <p>{t.app.tagline}</p>
        <p>{t.home.lead}</p>
        <p>
          <Link className="btn" href="/rad">
            {t.home.openWorkspace}
          </Link>
        </p>
        <p>
          <Link href="/nastavnik">{t.home.openTeacher}</Link>
        </p>
      </main>
    </>
  );
}
