import Link from "next/link";
import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope, teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { workLanguageExceptionHref } from "@/components/teacher/work-language";
import { teacherPageRead } from "@/components/teacher/teacher-access";
import { readWorkLanguageException } from "@/components/teacher/work-language-exception-read";
import WorkLanguageExceptionCard from "@/components/teacher/WorkLanguageExceptionCard";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { liveSessionToken } from "@/server/auth/ended-mark";
import { withActor } from "@/server/db";

import styles from "../../../../novi/page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacher.workLanguageException.title} · ${t.app.name}` };

// DAN-386 (M2.10-P02d, contract on #1836 c.6858305983): the language of one
// work, keyed by its assignment and the work's document id, as the course
// list links it; the student id never leaves the server, and the card's POST
// names the work by its document id too (QA on #1986 c.6861733018). The read
// is a UX boundary only; the POST route and set_work_language() decide again
// who may change it.
// Someone else's work, a missing one and a malformed id read alike. No
// student name is shown: the teacher reaches this page from the work's row.
export default async function WorkLanguageExceptionPage(
  { params }: { params: Promise<{ assignmentId: string; documentId: string }> },
) {
  // Next decodes the segment once, as for the live view (/nastavnik/rad/[id]).
  const { assignmentId, documentId } = await params;
  const token = liveSessionToken(await cookies());
  pageActivity(token);
  const { access, principal } = await teacherPageRead(token, withActor);
  const screen = teacherPageAccess(access, principal.kind, token);
  const card = screen === "expired" || screen === "signedOut" || screen === "denied";
  const read = screen === "allowed" ? await readWorkLanguageException(token, assignmentId, documentId, withActor) : null;
  const returnTo = workLanguageExceptionHref(assignmentId, documentId) ?? "/nastavnik";
  const e = t.teacher.workLanguageException;
  return (
    <AppShell
      endsOnDevice
      session={shellSession(token)}
      scope={accessShellScope(screen, principal)}
      role={screen === "allowed" ? "teacher" : null}
      current="/nastavnik"
      crumbs={[t.teacherCourses.title, e.title]}
    >
      <div className={`page ${styles.page}`}>
        {card ? (
          <AccessCard kind={screen} returnTo={returnTo} what="workLanguage" />
        ) : (
          <h1 className={styles.title}>{e.title}</h1>
        )}
        {read?.kind === "available" ? <p>{read.title}</p> : null}
        {read?.kind === "notFound" || read?.kind === "signedOut" ? <p role="alert">{e.notFound}</p> : null}
        {read?.kind === "unavailable" ? <p role="status">{e.unavailable}</p> : null}
        {read?.kind === "available" ? (
          <WorkLanguageExceptionCard assignmentId={read.assignmentId} documentId={read.documentId}
            assignmentLanguage={read.assignmentLanguage} exception={read.exception} />
        ) : null}
        {screen === "unavailable" ? <p role="status">{t.teacher.unavailable}</p> : null}
        {screen === "denied" ? null : <p><Link href="/nastavnik">{t.teacher.backCourses}</Link></p>}
      </div>
    </AppShell>
  );
}
