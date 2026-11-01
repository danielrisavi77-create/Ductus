import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import EnrollForm from "@/components/student/EnrollForm";
import StudentHome from "@/components/student/StudentHome";
import { readStudentHome } from "@/components/student/student-home-read";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const title = messagesHr.student.home.courses;
export const metadata = { title: `${title} · ${messagesHr.app.name}` };

// DAN-344, Archivum S02: the student's own courses and their assignments,
// from the same RLS read as /zadaci (#711 contract 6404612273). It adds and
// filters nothing; every assignment still goes through /rad.
export default async function MyCoursesPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  // The session is checked before the courses are read (readStudentHome).
  const { read, account: { role, scope } } = await readStudentHome(token, withActor);
  return (
    <AppShell session={shellSession(token)} role={role} scope={scope} current="/zadaci/kolegiji" crumbs={[title]}>
      <StudentHome read={read} enroll={<EnrollForm />} view="courses" />
    </AppShell>
  );
}
