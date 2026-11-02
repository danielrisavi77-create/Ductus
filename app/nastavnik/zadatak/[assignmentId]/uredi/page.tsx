import Link from "next/link";
import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope, teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import AssignmentVersionForm from "@/components/teacher/AssignmentVersionForm";
import { readCurrentVersion } from "@/components/teacher/assignment-version-read";
import { teacherPageRead } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "../../novi/page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacher.newVersion.title} · ${t.app.name}` };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DAN-310 (M2.4-P02): a new version of a published assignment. The access
// check and the read are a UX boundary only; the POST route rechecks the
// teacher, the widening rules and the version in the database. Someone else's
// assignment, a missing one, a mentorship's and a malformed id read alike.
export default async function AssignmentVersionPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const { access, principal } = await teacherPageRead(token, withActor);
  const screen = teacherPageAccess(access, principal.kind, token);
  const card = screen === "expired" || screen === "signedOut" || screen === "denied";
  const read = screen === "allowed" ? await readCurrentVersion(token, assignmentId, withActor) : null;
  const returnTo = UUID.test(assignmentId) ? `/nastavnik/zadatak/${assignmentId.toLowerCase()}/uredi` : "/nastavnik";
  const n = t.teacher.newVersion;
  return (
    <AppShell
      session={shellSession(token)}
      scope={accessShellScope(screen, principal)}
      role={screen === "allowed" ? "teacher" : null}
      current="/nastavnik"
      crumbs={[t.teacherCourses.title, n.title]}
    >
      <div className={`page ${styles.page}`}>
        {card ? (
          <AccessCard kind={screen} returnTo={returnTo} what="assignmentVersion" />
        ) : (
          <h1 className={styles.title}>{n.title}</h1>
        )}
        {read?.kind === "notFound" || read?.kind === "signedOut" ? <p role="alert">{n.missing}</p> : null}
        {read?.kind === "unavailable" ? <p role="status">{n.unavailable}</p> : null}
        {read?.kind === "available" ? <AssignmentVersionForm key={read.current.versionNo} current={read.current} /> : null}
        {screen === "unavailable" ? <p role="status">{t.teacher.unavailable}</p> : null}
        {screen === "denied" ? null : <p><Link href="/nastavnik">{t.teacher.backCourses}</Link></p>}
      </div>
    </AppShell>
  );
}
