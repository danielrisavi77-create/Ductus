import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope, teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { assignmentParam } from "@/components/student/work-context-read";
import { FastPath, FastPathLive } from "@/components/teacher/FastPath";
import { teacherPageRead } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.fastPath.title} · ${t.app.name}` };

// Screen 11 (F-11, D-80 point 2). The access check is the same UX boundary
// as the teacher's course screen. The works and names of the assignment come
// from the fast path route (B-11c, #757), which decides on every request who
// may read them; the page renders none of them on the server. DAN-378: the
// access screens of the other teacher pages, Z-05 without a sign-in.
export default async function FastPathPage({ searchParams }: { searchParams: Promise<{ zadatak?: string | string[] }> }) {
  const assignmentId = assignmentParam((await searchParams).zadatak);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const { tag, at } = shellSession(token);
  // One statement, one snapshot: the session and the role never disagree (#1242 round 1).
  const { access, principal } = await teacherPageRead(token, withActor);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const returnTo = assignmentId === null ? "/nastavnik/brz-put" : `/nastavnik/brz-put?zadatak=${encodeURIComponent(assignmentId)}`;
  // An OIDC login: a real navigation, not a prefetchable Link.
  const signInHref = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  const screen = teacherPageAccess(access, principal.kind, token);
  return (
    <AppShell session={{ tag, at }} role={screen === "allowed" ? "teacher" : null} scope={accessShellScope(screen, principal)} current="/nastavnik/brz-put" crumbs={[t.fastPath.title]}>
      <div className={`page ${styles.page}`}>
        {screen === "allowed" ? (
          <>
            <h1>{t.fastPath.title}</h1>
            <p className={styles.intro}>{t.fastPath.intro}</p>
            {assignmentId !== null && session !== null ? (
              <FastPathLive assignmentId={assignmentId} session={session} signInHref={signInHref} />
            ) : (
              <FastPath load={{ state: "pickAssignment" }} />
            )}
          </>
        ) : screen === "unavailable" ? (
          <>
            <h1>{t.fastPath.title}</h1>
            <p role="status">{t.teacher.unavailable}</p>
          </>
        ) : (
          <AccessCard kind={screen} returnTo={returnTo} what="fastPath" />
        )}
      </div>
    </AppShell>
  );
}
