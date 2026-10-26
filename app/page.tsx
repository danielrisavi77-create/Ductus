import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import homeStyles from "@/components/home/Home.module.css";
import { homeDate } from "@/components/home/home-date";
import Landing from "@/components/landing/Landing";
import AppShell from "@/components/shell/AppShell";
import SessionObserver from "@/components/shell/SessionObserver";
import { shellSession } from "@/components/shell/shell-session";
import { readShellAccount } from "@/components/shell/shell-role";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { homeTarget } from "@/server/institution/home-target";

export const runtime = "nodejs";

export default async function HomePage() {
  // Convenience only, not a safeguard: a person with an open session goes to
  // their own page by the role the database knows (DAN-325), which is also
  // where the sign-in returns by default. The login route stays reachable,
  // and a sign-in that replaces the cookie ends the earlier session's tabs
  // (SessionObserver).
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  // Without a session cookie the public home page (FE-H1, #476).
  if (token === undefined) {
    return (
      <>
        <SessionObserver tag={sessionTag(token)} at={Date.now()} />
        <Landing />
      </>
    );
  }
  const home = await homeTarget(token, withActor);
  if (home.kind === "page") redirect(home.path);
  // A closed session, or one the database cannot answer for, guesses no
  // role and stays on the signed-in home inside the shell (#802 part B). The shell
  // shows no role here; its sign-out reads the journal under the scope. A
  // cookie whose session is closed or could not be read has no scope, so
  // it gets the plain sign-out that only ends the cookie.
  const { scope } = await readShellAccount(token, withActor);
  const plainSignOut = scope === null ? (
    <form method="post" action="/api/auth/logout">
      <button type="submit" className="btn">{t.shell.signOut}</button>
    </form>
  ) : undefined;
  return (
    <AppShell session={shellSession(token)} role={null} scope={scope} crumbs={[]} account={plainSignOut}>
      <div className={homeStyles.screen}>
        <div className={homeStyles.greeting}>
          <span className={homeStyles.date}>{homeDate(new Date())}</span>
          <h1>{t.home.welcome}</h1>
        </div>
        <ul className={homeStyles.cards} aria-label={t.home.spaces}>
          <li>
            <section className={homeStyles.card} aria-labelledby="pocetna-rad">
              <h2 id="pocetna-rad">{t.home.workTitle}</h2>
              <p>{t.home.workBody}</p>
              <Link className="btn" href="/rad">{t.home.openWorkspace}</Link>
            </section>
          </li>
          <li>
            <section className={homeStyles.card} aria-labelledby="pocetna-kolegiji">
              <h2 id="pocetna-kolegiji">{t.home.coursesTitle}</h2>
              <p>{t.home.coursesBody}</p>
              <Link className="btn" href="/nastavnik">{t.home.openTeacher}</Link>
            </section>
          </li>
        </ul>
        <p className={homeStyles.enroll}>
          {t.home.enrollQuestion}
          <Link className="btn" href="/upis">{t.home.enroll}</Link>
        </p>
      </div>
    </AppShell>
  );
}
