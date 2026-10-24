import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/shell/AppShell";
import { readShellRole } from "@/components/shell/shell-role";
import { SIGN_IN_HREF } from "@/components/student/enroll-code";
import styles from "@/components/student/Enroll.module.css";
import { courseHref, readOpenAssignment } from "@/components/student/open-assignment";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.student.enroll.title} · ${t.app.name}` };

const c = t.student.enroll.course;

// FE-D4 (#476 row 4, PRODUCT §5 rule 6): the step between the enrollment and
// the notice. The open assignment of the course is read under the session
// principal and the student goes straight to its notice; this page only shows
// something when there is no notice to go to.
export default async function EnrolledCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const read = await readOpenAssignment(token, courseId, withActor);
  // redirect() throws, so it stays outside any try block.
  if (read.kind === "assignment") redirect(`/zadatak/${encodeURIComponent(read.assignmentId)}`);
  const role = await readShellRole(token, withActor);
  return (
    <AppShell role={role} current="/upis" crumbs={[t.student.enroll.title]}>
      <div className={`page ${styles.screen}`}>
        <section className={styles.card}>
          <h1>{t.student.enroll.title}</h1>
          <p className={styles.status} role="status">
            {read.kind === "signedOut" ? t.student.enroll.signedOut : c[read.kind]}
          </p>
          <div className={styles.links}>
            {read.kind === "signedOut" ? <a href={SIGN_IN_HREF}>{t.student.signIn}</a> : null}
            {read.kind === "none" || read.kind === "unavailable"
              ? <Link href={courseHref(courseId)} prefetch={false}>{c.retry}</Link>
              : null}
            {read.kind !== "signedOut" ? <Link href="/upis">{c.another}</Link> : null}
          </div>
        </section>
        <p><Link href="/">{t.teacher.backHome}</Link></p>
      </div>
    </AppShell>
  );
}
