import Link from "next/link";
import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import TeacherSetup from "@/components/teacher/TeacherSetup";
import { teacherPageRead } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacher.title} · ${t.app.name}` };

// FE-D10 (screen 10, design demo-tok-v2 step 2). Server access check is only
// a UX boundary; both POST routes recheck every write in the database under
// the authenticated principal. DAN-378: in place of the form, Z-03 for a
// closed session, "not signed in" without one and Z-05 for a signed-in
// person without the teacher role, who is offered no new sign-in.
export default async function TeacherNewAssignmentPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  // One statement, one snapshot: the session and the role never disagree (#1242 round 1).
  const { access, principal } = await teacherPageRead(token, withActor);
  const screen = teacherPageAccess(access, principal.kind, token);
  const card = screen === "expired" || screen === "signedOut" || screen === "denied";
  return (
    <AppShell
      session={shellSession(token)}
      scope={principal.kind === "signed-in" ? principal.scope : null}
      role={screen === "allowed" ? "teacher" : null}
      current="/nastavnik/zadatak/novi"
      crumbs={[t.teacherCourses.title, t.teacher.title]}
    >
      <div className={`page ${styles.page}`}>
        {card ? (
          <AccessCard kind={screen} returnTo="/nastavnik/zadatak/novi" what="newCourse" />
        ) : (
          <h1 className={styles.title}>{t.teacher.title}</h1>
        )}
        {screen === "allowed" ? <TeacherSetup /> : null}
        {screen === "unavailable" ? <p role="status">{t.teacher.unavailable}</p> : null}
        {screen === "denied" ? null : <p><Link href="/nastavnik">{t.teacher.backCourses}</Link></p>}
      </div>
    </AppShell>
  );
}
