import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import TeacherHome from "@/components/teacher/TeacherHome";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readTeacherCourses } from "@/server/institution/teacher-courses";

const t = messagesHr.teacherCourses;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// Z3 (A), #476 6289158306: the teacher's entry. The courses come from the
// same read as GET /api/teacher/courses, under the session cookie only; the
// database decides whose. A refused session or a person who is not a teacher
// both read "no courses", without saying which. DAN-344 T01 (#923): the
// assignments and their works are on each course's page (T02) now.
export default async function TeacherHomePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, principal] = await Promise.all([
    token === undefined ? null : readTeacherCourses(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  return (
    <AppShell session={shellSession(token)} role={read?.kind === "ok" ? "teacher" : null} scope={principal.kind === "signed-in" ? principal.scope : null} current="/nastavnik" crumbs={[t.title]}>
      <TeacherHome read={read} />
    </AppShell>
  );
}
