import { cookies } from "next/headers";

import ReplayView from "@/components/replay/ReplayView";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { isDocumentId } from "@/domain/collaboration";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.replay.titleTeacher} · ${t.app.name}` };

/**
 * N-09: the teacher's replay of one work (DAN-537, rb 261). Who may read the
 * record is decided by POST /api/evidence/replay on every request (#1895);
 * this page only checks that someone is signed in. It renders no text of the
 * work on the server, and the player is the student's own (PRODUCT §5 rule 5).
 */
export default async function TeacherReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  // The cookie digest and the server time of this render (D-118).
  const { tag, at } = shellSession(token);
  const principal = await sessionPrincipal(token, withActor);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const work = `/nastavnik/rad/${encodeURIComponent(id)}`;
  const role = session !== null && (await teacherAccess(token, withActor)) === "allowed" ? "teacher" : null;

  let body;
  if (!isDocumentId(id)) {
    body = <p role="status">{t.replay.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.replay.signInFirst}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a href={`/api/auth/login?returnTo=${encodeURIComponent(`${work}/reprodukcija`)}`}>{t.replay.signIn}</a></p>
      </>
    );
  } else {
    body = <ReplayView documentId={id} session={session} student={false} />;
  }

  return (
    <AppShell session={{ tag, at }} role={role} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={[t.replay.context]}>
      <div className="page">
        <h1>{t.replay.titleTeacher}</h1>
        {isDocumentId(id) ? <p><a href={work}>{t.replay.backToWork}</a></p> : null}
        {body}
      </div>
    </AppShell>
  );
}
