import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { readShellAccountOrFailure } from "@/components/shell/shell-role";
import { shellSession } from "@/components/shell/shell-session";
import StudentWorkspace from "@/components/student/StudentWorkspace";
import { paramOf } from "@/components/student/student-workspace-view";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readStudentWorkspace, type StudentWorkspaceRead } from "@/server/institution/student-workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const t = messagesHr.student.works;
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// DAN-309 (M2.3-P02, contract on #1091, comment 6573005331): "Moji radovi",
// one read of app.student_workspace() under the session cookie. The shell
// account is read first, as on /zadaci (F-171): a failed read is unavailable,
// no session is signed out, and only then is the workspace read. `?q=` and
// `?godina=` only narrow what that read returned.
export default async function MyWorksPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  const params = await searchParams;
  const account = await readShellAccountOrFailure(token, withActor);
  const read: StudentWorkspaceRead = account === null
    ? { kind: "unavailable" }
    : account.role === null ? { kind: "unauthorized" } : await readStudentWorkspace(token, withActor);
  return (
    <AppShell session={shellSession(token)} role={account?.role ?? null} scope={account?.scope ?? null}
      current="/zadaci/radovi" crumbs={[t.title]}>
      <StudentWorkspace read={read} filter={{ q: paramOf(params.q), year: paramOf(params.godina) }} />
    </AppShell>
  );
}
