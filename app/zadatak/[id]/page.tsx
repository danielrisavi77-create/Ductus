import Link from "next/link";
import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import AssignmentNotice from "@/components/student/AssignmentNotice";
import { readNotice } from "@/components/student/assignment-notice-read";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.student.title} · ${t.app.name}` };

// F-7 (#336): the first screen of every assignment is the S3 notice (C-3).
// Reading goes through RLS under the session principal; the page writes
// nothing and loads no editor.
export default async function AssignmentNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const read = await readNotice(token, id, withActor);
  return (
    <>
      <AppHeader context={t.student.title} />
      <main id="sadrzaj" tabIndex={-1} className="page">
        {read.kind === "available" ? (
          <AssignmentNotice view={read.view} />
        ) : (
          <>
            <h1>{t.student.title}</h1>
            <p role="status">{t.student[read.kind]}</p>
            {read.kind === "signedOut" ? (
              <p>
                {/* An API route that starts an OIDC login: a real navigation. */}
                <a href={`/api/auth/login?returnTo=${encodeURIComponent(`/zadatak/${encodeURIComponent(id)}`)}`}>
                  {t.student.signIn}
                </a>
              </p>
            ) : null}
          </>
        )}
        <p><Link href="/">{t.teacher.backHome}</Link></p>
      </main>
    </>
  );
}
