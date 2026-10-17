import Link from "next/link";
import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import TeacherSetup from "@/components/teacher/TeacherSetup";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacher.title} · ${t.app.name}` };

// Server access check is only a UX boundary; both POST routes recheck every
// write in the database under the authenticated principal.
export default async function TeacherCoursesPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const access = await teacherAccess(token, withActor);
  return (
    <>
      <AppHeader context={t.teacher.title} />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.teacher.title}</h1>
        {access === "allowed" ? (
          <TeacherSetup />
        ) : (
          <>
            <p role="status">
              {access === "unavailable" ? t.teacher.unavailable : t.teacher.denied}
            </p>
            {access === "denied" ? (
              <p>
                {/* This API route starts an OIDC login. Use a real navigation
                    rather than Next's prefetchable client-side Link. */}
                <a href="/api/auth/login?returnTo=%2Fnastavnik%2Fkolegiji">
                  {t.teacher.signIn}
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
