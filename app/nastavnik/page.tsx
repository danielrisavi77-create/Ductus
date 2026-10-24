import Link from "next/link";
import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import TeacherCourses from "@/components/teacher/TeacherCourses";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readTeacherCourses } from "@/server/institution/teacher-courses";

import styles from "./page.module.css";

const t = messagesHr.teacherCourses;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// Z3 (A), #476 6289158306: the teacher's entry. The courses come from the
// same read as GET /api/teacher/courses, under the session cookie only; the
// database decides whose. A refused session or a person who is not a teacher
// both read "no courses", without saying which.
export default async function TeacherHomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const read = token === undefined ? null : await readTeacherCourses(token, withActor);
  const listed = read?.kind === "ok" && read.courses.length > 0;

  let body;
  if (read === null) {
    body = (
      <>
        <p role="status">{messagesHr.teacher.signedOut}</p>
        <p>
          {/* An OIDC login: a real navigation, not a prefetchable Link. */}
          <a href="/api/auth/login?returnTo=%2Fnastavnik">{messagesHr.teacher.signIn}</a>
        </p>
      </>
    );
  } else if (read.kind === "unavailable") {
    body = (
      <>
        <p role="alert" className={styles.alert}>{t.unavailable}</p>
        <p><a className={styles.retry} href="/nastavnik">{t.retry}</a></p>
      </>
    );
  } else {
    body = <TeacherCourses courses={read.kind === "ok" ? read.courses : []} />;
  }

  return (
    <AppShell role={read?.kind === "ok" ? "teacher" : null} current="/nastavnik" crumbs={[t.title]}>
      <div className={`page ${styles.page}`}>
        <div className={styles.head}>
          <div className={styles.heading}>
            <h1>{t.title}</h1>
            <p className={styles.lead}>{t.lead}</p>
          </div>
          {listed ? <Link className="btn" href="/nastavnik/zadatak/novi">{t.newCourse}</Link> : null}
        </div>
        {body}
      </div>
    </AppShell>
  );
}
