import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { FastPath } from "@/components/teacher/FastPath";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { DEMO_FAST_PATH } from "@/lib/i18n/demo-fast-path.hr";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.fastPath.title} · ${t.app.name}` };

// Screen 11 (F-11, D-80 point 2). The access check is the same UX boundary
// as the teacher's course screen. The works of an assignment and the four
// lines have no server route yet (Backend), so the screen shows invented
// data and says so; it reads nothing of a real student.
export default async function FastPathPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [access, principal] = await Promise.all([teacherAccess(token, withActor), sessionPrincipal(token, withActor)]);
  const scope = principal.kind === "signed-in" ? principal.scope : null;
  return (
    <AppShell session={shellSession(token)} role={access === "allowed" ? "teacher" : null} scope={scope} current="/nastavnik/brz-put" crumbs={[t.fastPath.title]}>
      <div className={`page ${styles.page}`}>
        <h1>{t.fastPath.title}</h1>
        {access === "allowed" ? (
          <>
            <p className={styles.intro}>{t.fastPath.intro}</p>
            <p className={styles.sample}>{t.fastPath.sample}</p>
            <FastPath load={{ state: "ready", students: DEMO_FAST_PATH }} />
          </>
        ) : (
          <>
            <p role="status">{access === "denied" ? t.fastPath.denied : t.teacher[access]}</p>
            {access !== "unavailable" ? (
              <p>
                {/* An OIDC login: a real navigation, not a prefetchable Link. */}
                <a href="/api/auth/login?returnTo=%2Fnastavnik%2Fbrz-put">{t.teacher.signIn}</a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
