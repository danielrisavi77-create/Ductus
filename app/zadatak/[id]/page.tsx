import Link from "next/link";
import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { readShellAccount } from "@/components/shell/shell-role";
import AssignmentNotice from "@/components/student/AssignmentNotice";
import styles from "@/components/student/AssignmentNotice.module.css";
import { readNotice } from "@/components/student/assignment-notice-read";
import { noticeWindow } from "@/components/student/notice-window";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.student.title} · ${t.app.name}` };

// F-7 (#336): the first screen of every assignment is the S3 notice (C-3).
// Reading goes through RLS under the session principal; the page writes
// nothing and loads no editor. FE-D8 (#476 row 05): Ductura layout.
export default async function AssignmentNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, { role, scope }] = await Promise.all([readNotice(token, id, withActor), readShellAccount(token, withActor)]);
  const here = `/zadatak/${encodeURIComponent(id)}`;
  return (
    <AppShell session={shellSession(token)} role={role} scope={scope} crumbs={[t.student.title]}>
      <div className={`page ${styles.screen}`}>
        {read.kind === "available" ? (
          <AssignmentNotice view={read.view} timing={noticeWindow(read.view.opensAt, read.view.dueAt, Date.now())} />
        ) : (
          <section className={styles.card} aria-labelledby="zadatak">
            <h1 id="zadatak">{t.student.title}</h1>
            <p className={styles.status} role="status">{t.student[read.kind]}</p>
            <p className={styles.links}>
              {/* An API route that starts an OIDC login: a real navigation. */}
              {read.kind === "signedOut"
                ? <a className="btn" href={`/api/auth/login?returnTo=${encodeURIComponent(here)}`}>{t.student.signIn}</a>
                : null}
              {read.kind === "unavailable" ? <a className="btn" href={here}>{t.auth.retry}</a> : null}
              {read.kind === "notFound" ? <Link className="btn" href="/upis">{t.student.enroll.title}</Link> : null}
            </p>
          </section>
        )}
        <p className={styles.status}><Link href="/">{t.teacher.backHome}</Link></p>
      </div>
    </AppShell>
  );
}
