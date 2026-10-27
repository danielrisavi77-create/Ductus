import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import CourseView, { courseOf } from "@/components/teacher/CourseView";
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

// DAN-344, Archivum T02 (#923 c.6433823712 §3). The course comes from the same
// read as /nastavnik, under the session cookie only; the id in the address
// is only an address. A course the read does not return, whether it does not
// exist or is another teacher's, gets one "not found".
export default async function TeacherCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, principal] = await Promise.all([
    token === undefined ? null : readTeacherCourses(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  const course = courseOf(read, id);
  // F2 (#711): the works of each assignment, under the same cookie; the database decides whose.
  // F-142: all of them in one read, so a page load holds one connection however many assignments there are.
  const ids = course?.assignments.map((assignment) => assignment.id) ?? [];
  const answer = ids.length > 0 && token !== undefined ? await readAssignmentWorksMany(token, ids, withActor) : null;
  const works = Object.fromEntries(ids.map((assignment) => [assignment, answer?.kind === "ok" ? answer.works.get(assignment.toLowerCase()) ?? [] : null]));
  return (
    <AppShell session={shellSession(token)} role={read?.kind === "ok" ? "teacher" : null} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={course ? [t.title, course.name] : [t.title]}>
      <CourseView read={read} courseId={id} works={works} />
    </AppShell>
  );
}
