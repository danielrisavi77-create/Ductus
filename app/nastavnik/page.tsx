import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import TeacherHome from "@/components/teacher/TeacherHome";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readAssignmentWorksMany } from "@/server/evidence/assignment-works";
import { readTeacherCourses } from "@/server/institution/teacher-courses";

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
  const [read, principal] = await Promise.all([
    token === undefined ? null : readTeacherCourses(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  // F2 (#711): the works of each assignment, under the same cookie; the database decides whose.
  // F-142: all of them in one read, so a page load holds one connection however many assignments there are.
  const ids = read?.kind === "ok" ? read.courses.flatMap((course) => course.assignments).map(({ id }) => id) : [];
  const answer = ids.length > 0 && token !== undefined ? await readAssignmentWorksMany(token, ids, withActor) : null;
  const works = Object.fromEntries(ids.map((id) => [id, answer?.kind === "ok" ? answer.works.get(id.toLowerCase()) ?? [] : null]));

  // DAN-344, Archivum T01 (#923): the heading and states live in TeacherHome.
  return (
    <AppShell session={shellSession(token)} role={read?.kind === "ok" ? "teacher" : null} scope={principal.kind === "signed-in" ? principal.scope : null} current="/nastavnik" crumbs={[t.title]}>
      <TeacherHome read={read} works={works} />
    </AppShell>
  );
}
