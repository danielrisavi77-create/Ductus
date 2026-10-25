import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/shell/AppShell";
import { readShellRole } from "@/components/shell/shell-role";
import Submission from "@/components/student/Submission";
import { assignmentParam, readWorkContext } from "@/components/student/work-context-read";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal, sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.submission.title} · ${t.app.name}` };

/**
 * The student's submission of one assignment (F-10, #476 contract
 * 6384297464; Ductura INTEGRACIJA §1 `/rad/[id]/predaja`). The assignment is
 * read as on `/rad?zadatak=`: only a current notice this student acknowledged
 * opens the page; otherwise the notice comes first (PRODUCT §5 rule 6). The
 * page renders no text of the work on the server: the client reads it from
 * the open route and submits exactly that revision.
 */
export default async function SubmissionPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId: raw } = await params;
  const assignmentId = assignmentParam(raw);
  const at = Date.now();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const tag = sessionTag(token);
  const [principal, read, role] = await Promise.all([
    sessionPrincipal(token, withActor),
    readWorkContext(token, assignmentId, withActor),
    readShellRole(token, withActor),
  ]);
  if (read.kind === "noticeFirst" && assignmentId) redirect(`/zadatak/${assignmentId}`);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const here = `/rad/${encodeURIComponent(raw)}/predaja`;

  let body;
  if (assignmentId === null) {
    body = <p role="status">{t.submission.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.submission.signedOut}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(here)}`}>{t.submission.signIn}</a></p>
      </>
    );
  } else if (read.kind !== "ready") {
    body = <p role="status">{t.submission.outcome.notFound}</p>;
  } else {
    body = <Submission assignmentId={assignmentId} session={session} />;
  }

  const work = read.kind === "ready" ? read : null;
  // The shell marks this session for the other tabs (D-118, F-113 t.1).
  return (
    <AppShell session={{ tag, at }} role={role} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={[t.submission.title]}>
      <div className="page">
        <h1>{t.submission.title}</h1>
        {work ? <p className="muted">{`${work.course} / ${work.notice.title}`}</p> : null}
        {body}
        {assignmentId ? (
          <p><Link href={`/rad?zadatak=${assignmentId}`}>{t.submission.backToWork}</Link></p>
        ) : null}
      </div>
    </AppShell>
  );
}
