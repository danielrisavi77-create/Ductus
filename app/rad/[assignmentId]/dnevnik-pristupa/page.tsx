import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { readShellRole } from "@/components/shell/shell-role";
import { AccessLogDays, AccessLogUnavailable } from "@/components/student/AccessLogView";
import { assignmentParam, readWorkContext } from "@/components/student/work-context-read";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readWorkDocument } from "@/server/evidence/work-document-read";
import { pagesParam, readMyAccessLogPages } from "@/server/privacy/my-access-log-pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.accessLog.context} · ${t.app.name}` };

/**
 * S-42: the student's own access log (DAN-294, M10.4; contract on #1836,
 * c.6814737263; PRODUCT §5 rule 17). The work is found as on
 * `/rad/<id>/reprodukcija`; loading this page never starts a work. The log is
 * read on the server through app.read_my_access_log, which answers only for
 * the owner of the session; another student's work, an unknown one and a
 * failed read never show a row.
 */
export default async function StudentAccessLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ stranica?: string | string[] }>;
}) {
  const { assignmentId: raw } = await params;
  const pages = pagesParam((await searchParams).stranica);
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
  const here = `/rad/${encodeURIComponent(raw)}/dnevnik-pristupa`;

  let body;
  if (assignmentId === null) {
    body = <p role="status">{t.accessLog.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.accessLog.signInFirst}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(here)}`}>{t.accessLog.signIn}</a></p>
      </>
    );
  } else if (read.kind === "ready" && doc.kind === "notOpened") {
    body = <p role="status">{t.accessLog.notStarted}</p>;
  } else if (read.kind !== "ready" || doc.kind !== "document") {
    body = <p role="status">{t.accessLog.notFound}</p>;
  } else {
    const log = await readMyAccessLogPages(token, withActor, doc.documentId, pages);
    if (log.kind === "ok") {
      body = <AccessLogDays days={log.days} olderHref={log.more ? `${here}?stranica=${pages + 1}` : null} />;
    } else if (log.kind === "unavailable") {
      body = <AccessLogUnavailable retryHref={pages > 1 ? `${here}?stranica=${pages}` : here} />;
    } else {
      body = <p role="status">{log.kind === "unauthorized" ? t.accessLog.signInFirst : t.accessLog.notFound}</p>;
    }
  }

  const work = read.kind === "ready" ? read : null;
  return (
    <AppShell session={{ tag, at }} role={role} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={[t.accessLog.context]}>
      <div className="page access-log">
        <h1>{t.accessLog.title}</h1>
        {work ? <p className="muted">{`${work.course} / ${work.notice.title}`}</p> : null}
        {assignmentId ? <p><Link href={`/rad?zadatak=${assignmentId}`}>{t.accessLog.backToWork}</Link></p> : null}
        {work ? <p className="access-log__note">{t.accessLog.note}</p> : null}
        {body}
      </div>
    </AppShell>
  );
}
