import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import ReplayView from "@/components/replay/ReplayView";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { readShellRole } from "@/components/shell/shell-role";
import { assignmentParam, readWorkContext } from "@/components/student/work-context-read";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readWorkDocument } from "@/server/evidence/work-document-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.replay.titleStudent} · ${t.app.name}` };

/**
 * S-34: the student's replay of their own work (DAN-537, rb 261). The work is
 * found as on `/rad/<id>/predaja`; loading this page never starts a work. The
 * record is read by the client from POST /api/evidence/replay, which decides
 * access on every request (#1895); the player is the teacher's own
 * (PRODUCT §5 rule 5). No text of the work is rendered on the server.
 */
export default async function StudentReplayPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId: raw } = await params;
  const assignmentId = assignmentParam(raw);
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  // The cookie digest and the server time of this render (D-118).
  const { tag, at } = shellSession(token);
  const [principal, read, role, doc] = await Promise.all([
    sessionPrincipal(token, withActor),
    readWorkContext(token, assignmentId, withActor),
    readShellRole(token, withActor),
    readWorkDocument(token, assignmentId, withActor),
  ]);
  if (read.kind === "noticeFirst" && assignmentId) redirect(`/zadatak/${assignmentId}`);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const here = `/rad/${encodeURIComponent(raw)}/reprodukcija`;

  let body;
  if (assignmentId === null) {
    body = <p role="status">{t.replay.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.replay.signInFirst}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(here)}`}>{t.replay.signIn}</a></p>
      </>
    );
  } else if (read.kind === "ready" && doc.kind === "notOpened") {
    body = <p role="status">{t.replay.notStarted}</p>;
  } else if (read.kind !== "ready" || doc.kind !== "document") {
    body = <p role="status">{t.replay.notFound}</p>;
  } else {
    body = <ReplayView documentId={doc.documentId} session={session} student />;
  }

  const work = read.kind === "ready" ? read : null;
  return (
    <AppShell session={{ tag, at }} role={role} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={[t.replay.context]}>
      <div className="page">
        <h1>{t.replay.titleStudent}</h1>
        {work ? <p className="muted">{`${work.course} / ${work.notice.title}`}</p> : null}
        {assignmentId ? <p><Link href={`/rad?zadatak=${assignmentId}`}>{t.replay.backToWork}</Link></p> : null}
        {body}
      </div>
    </AppShell>
  );
}
