import Link from "next/link";
import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope, coursesAccess, teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import TeacherCourses from "@/components/teacher/TeacherCourses";
import { readWorkAccommodationsMany } from "@/components/teacher/work-accommodations-read";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { liveSessionToken } from "@/server/auth/ended-mark";
import { sessionPrincipal } from "@/server/auth/principal";
import { withActor } from "@/server/db";
import { readAssignmentSubmissionsMany } from "@/server/evidence/assignment-submissions";
import { readTeacherCourses } from "@/server/institution/teacher-courses";

import styles from "./page.module.css";

const t = messagesHr.teacherCourses;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// Z3 (A), #476 6289158306: the teacher's entry. The courses come from the
// same read as GET /api/teacher/courses, under the session cookie only; the
// database decides whose. DAN-378: no session reads "not signed in", a
// closed one Z-03 and a person who is not a teacher Z-05, none of them a
// course or whether one exists.
export default async function TeacherHomePage() {
  const token = liveSessionToken(await cookies());
  pageActivity(token);
  const [read, principal] = await Promise.all([
    token === undefined ? null : readTeacherCourses(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  const listed = read?.kind === "ok" && read.courses.length > 0;
  // F2 (#711): the works of each assignment, under the same cookie; the database decides whose.
  // F-142: all of them in one read, so a page load holds one connection however many assignments there are.
  // DAN-332 PR 4: that read is R1, so each work and the state of its submission come from one snapshot.
  const ids = read?.kind === "ok" ? read.courses.flatMap((course) => course.assignments).map(({ id }) => id) : [];
  const answer = ids.length > 0 && token !== undefined ? await readAssignmentSubmissionsMany(token, ids, withActor) : null;
  const works = Object.fromEntries(
    ids.map((id) => [id, answer?.kind === "ok" ? answer.submissions.get(id.toLowerCase()) ?? [] : null]),
  );
  // DAN-380 (M2.9-P02): which of those works carry an accommodation mark, for every work in one more read.
  // A separate snapshot: a mark changed between the two reads shows as it is in the second (#1091 c.6725196643).
  const pairs = answer?.kind === "ok"
    ? [...answer.submissions].flatMap(([assignmentId, rows]) =>
      rows.flatMap((row) => (row.documentId === null ? [] : [{ assignmentId, studentId: row.studentId }])))
    : [];
  const marks = pairs.length > 0 ? await readWorkAccommodationsMany(token, pairs, withActor) : null;
  const accommodations = Object.fromEntries(
    ids.map((id) => [id, marks === null ? [] : marks.kind === "ok" ? marks.marked[id.toLowerCase()] ?? [] : null]),
  );

  const screen = teacherPageAccess(coursesAccess(read?.kind ?? null), principal.kind, token);
  const card = screen === "expired" || screen === "signedOut" || screen === "denied";
  let body;
  if (card) {
    body = <AccessCard kind={screen} returnTo="/nastavnik" what="courses" />;
  } else if (screen === "unavailable") {
    body = (
      <>
        <p role="alert" className={styles.alert}>{t.unavailable}</p>
        <p><a className={styles.retry} href="/nastavnik">{t.retry}</a></p>
      </>
    );
  } else {
    body = <TeacherCourses courses={read?.kind === "ok" ? read.courses : []} works={works} accommodations={accommodations} />;
  }
  const role = screen === "allowed" ? "teacher" : null;

  return (
    <AppShell endsOnDevice session={shellSession(token)} role={role} scope={accessShellScope(screen, principal)} current="/nastavnik" crumbs={[t.title]}>
      <div className={`page ${styles.page}`}>
        {card ? null : <div className={styles.head}>
          <div className={styles.heading}>
            <h1>{t.title}</h1>
            <p className={styles.lead}>{t.lead}</p>
          </div>
          {listed ? <Link className="btn" href="/nastavnik/zadatak/novi">{t.newCourse}</Link> : null}
        </div>}
        {body}
      </div>
    </AppShell>
  );
}
