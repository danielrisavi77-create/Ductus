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

const t = messagesHr.student.assignments;
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// #711 contract 6404612273: the student's courses and assignments, from one
// RLS read under the session cookie. The page adds and filters nothing; /rad
// decides each assignment. Without a session there is no read at all.
// DAN-344: drawn as Archivum S01 by StudentHome; the first arrival
// (S01_prazna) holds the same EnrollForm as /upis.
export default async function MyAssignmentsPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  // The session is checked before the courses are read (readStudentHome).
  const { read, account: { role, scope } } = await readStudentHome(token, withActor);
  return (
    <AppShell session={shellSession(token)} role={role} scope={scope} current="/zadaci" crumbs={[t.title]}>
      <StudentHome read={read} enroll={<EnrollForm />} />
    </AppShell>
  );
}
