import { cookies } from "next/headers";
import Link from "next/link";

import Landing from "@/components/landing/Landing";
import AppHeader from "@/components/shell/AppHeader";
import SessionMark from "@/components/shell/SessionMark";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export default async function HomePage() {
  // Convenience only, not a safeguard: a person with a session is pointed at
  // the workspace. The login route stays reachable, and a sign-in that
  // replaces the cookie ends the earlier session's tabs (SessionMark).
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  // Without a session cookie the public home page (FE-H1, #476); with one the
  // screen stays as it was. The landing page has its own header, so it marks
  // the session itself; AppHeader does it on the other branch.
  if (token === undefined) {
    return (
      <>
        <SessionMark />
        <Landing />
      </>
    );
  }
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
        </p>
        <p>
          <Link href="/nastavnik/zadatak/novi">{t.home.openTeacher}</Link>
        </p>
      </main>
    </>
  );
}
