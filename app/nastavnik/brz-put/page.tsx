import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { assignmentParam } from "@/components/student/work-context-read";
import { FastPath, FastPathLive } from "@/components/teacher/FastPath";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.fastPath.title} · ${t.app.name}` };

// Screen 11 (F-11, D-80 point 2). The access check is the same UX boundary
// as the teacher's course screen. The works and names of the assignment come
// from the fast path route (B-11c, #757), which decides on every request who
// may read them; the page renders none of them on the server.
export default async function FastPathPage({ searchParams }: { searchParams: Promise<{ zadatak?: string | string[] }> }) {
  const assignmentId = assignmentParam((await searchParams).zadatak);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const { tag, at } = shellSession(token);
  const [access, principal] = await Promise.all([teacherAccess(token, withActor), sessionPrincipal(token, withActor)]);
  const scope = principal.kind === "signed-in" ? principal.scope : null;
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const returnTo = assignmentId === null ? "/nastavnik/brz-put" : `/nastavnik/brz-put?zadatak=${encodeURIComponent(assignmentId)}`;
  // An OIDC login: a real navigation, not a prefetchable Link.
  const signInHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <AppShell session={{ tag, at }} role={access === "allowed" ? "teacher" : null} scope={scope} current="/nastavnik/brz-put" crumbs={[t.fastPath.title]}>
      <div className={`page ${styles.page}`}>
        <h1>{t.fastPath.title}</h1>
        {access === "allowed" ? (
          <>
            <p className={styles.intro}>{t.fastPath.intro}</p>
            {assignmentId !== null && session !== null ? (
              <FastPathLive assignmentId={assignmentId} session={session} signInHref={signInHref} />
            ) : (
              <FastPath load={{ state: "pickAssignment" }} />
            )}
          </>
        ) : (
          <>
            <p role="status">{access === "denied" ? t.fastPath.denied : t.teacher[access]}</p>
            {access !== "unavailable" ? (
              <p>
                <a href={signInHref}>{t.teacher.signIn}</a>
              </p>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
