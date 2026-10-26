import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { readShellAccount } from "@/components/shell/shell-role";
import MyAssignments from "@/components/student/MyAssignments";
import { readMyAssignments } from "@/components/student/my-assignments-read";
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
export default async function MyAssignmentsPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, { role, scope }] = await Promise.all([
    readMyAssignments(token, withActor),
    readShellAccount(token, withActor),
  ]);
  return (
    <AppShell session={shellSession(token)} role={role} scope={scope} current="/zadaci" crumbs={[t.title]}>
      <div className="page">
        <h1>{t.heading}</h1>
        {read.kind === "signedOut" ? (
          <>
            <p role="status">{t.signedOut}</p>
            {/* An OIDC login: a real navigation, not a prefetchable Link. */}
            <p><a className="btn" href="/api/auth/login?returnTo=%2Fzadaci">{messagesHr.student.signIn}</a></p>
          </>
        ) : read.kind === "unavailable" ? (
          <p role="alert">{t.unavailable}</p>
        ) : (
          <MyAssignments courses={read.courses} />
        )}
      </div>
    </AppShell>
  );
}
