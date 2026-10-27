import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { assignmentParam } from "@/components/student/work-context-read";
import { liveContext, type LiveContext } from "@/components/teacher/live-context";
import LiveWorkView from "@/components/teacher/LiveWorkView";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { isDocumentId } from "@/domain/collaboration";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal, sessionTag } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readAssignmentWorks } from "@/server/evidence/assignment-works";
import { readTeacherCourses } from "@/server/institution/teacher-courses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.liveView.context} · ${t.app.name}` };

/**
 * The teacher's live view of one work (DAN-86 step 2b). Who may read the
 * text is decided by the live route and its RPC on every request (BACKEND
 * 4.12 t. 4); this page only checks that someone is signed in, so a person
 * without a session is offered sign-in instead of a view that cannot load.
 * The page renders no text of the work on the server (4.12, attack 24).
 *
 * Archivum T05 (DAN-344, #923 contract 6430008106 §4): with
 * `?zadatak=<assignmentId>` from the works list, the header names the course
 * and the assignment from the teacher's own course read and whose work it is
 * from the works read of that assignment, both under the session cookie. The
 * parameter is only an address: a foreign assignment or a document not among
 * its works gives no header, and the live route still decides the text.
 */
export default async function LiveWorkPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zadatak?: string | string[] }>;
}) {
  const { id } = await params;
  const assignmentId = assignmentParam((await searchParams).zadatak);
  const at = Date.now();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const tag = sessionTag(token);
  const principal = await sessionPrincipal(token, withActor);
  const session = principal.kind === "signed-in" && tag !== null ? { tag, at } : null;
  const returnTo = `/nastavnik/rad/${encodeURIComponent(id)}`;
  // Only which navigation to show; the live route decides who may read the work.
  const role = session !== null && (await teacherAccess(token, withActor)) === "allowed" ? "teacher" : null;
  const context = role === "teacher" && assignmentId !== null && isDocumentId(id) ? await readContext(token, assignmentId, id) : null;

  let body;
  if (!isDocumentId(id)) {
    body = <p role="status">{t.liveView.invalid}</p>;
  } else if (session === null) {
    body = (
      <>
        <p role="status">{t.liveView.signInFirst}</p>
        {/* The login route answers with a redirect: a plain link, never a prefetched one. */}
        <p><a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>{t.liveView.signIn}</a></p>
      </>
    );
  } else {
    body = <LiveWorkView documentId={id} session={session} context={context} />;
  }

  return (
    <AppShell session={{ tag, at }} role={role} scope={principal.kind === "signed-in" ? principal.scope : null} crumbs={[t.liveView.context]}>
      <div className="page">
        {/* LiveWorkView draws its own h1: the assignment's title, or this one. */}
        {session !== null && isDocumentId(id) ? null : <h1 className="visually-hidden">{t.liveView.context}</h1>}
        {body}
      </div>
    </AppShell>
  );
}

async function readContext(token: string | undefined, assignmentId: string, documentId: string): Promise<LiveContext | null> {
  if (token === undefined) return null;
  const [courses, works] = await Promise.all([
    readTeacherCourses(token, withActor),
    readAssignmentWorks(token, assignmentId, withActor),
  ]);
  if (courses.kind !== "ok" || works.kind !== "ok") return null;
  return liveContext(courses.courses, works.works, assignmentId, documentId);
}
