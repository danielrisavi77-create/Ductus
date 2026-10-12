import Link from "next/link";
import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import CourseForm from "@/components/teacher/CourseForm";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacherCourses.title} · ${t.app.name}` };

// Server access check is only a UX boundary; F-6a POST rechecks every write
// against institution.create_course under the authenticated DB principal.
export default async function TeacherCoursesPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const access = await teacherAccess(token, withActor);
  return (
    <>
      <AppHeader context={t.teacherCourses.title} />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.teacherCourses.title}</h1>
        {access === "allowed" ? (
          <>
            <p>{t.teacherCourses.lead}</p>
            <CourseForm />
          </>
        ) : (
          <>
            <p role="status">
              {access === "unavailable" ? t.teacherCourses.unavailable : t.teacherCourses.denied}
            </p>
            {access === "denied" ? (
              <p>
                {/* This API route starts an OIDC login. Use a real navigation
                    rather than Next's prefetchable client-side Link. */}
                <a href="/api/auth/login?returnTo=%2Fnastavnik%2Fkolegiji">
                  {t.teacherCourses.signIn}
                </a>
              </p>
            ) : null}
          </>
        )}
        <p><Link href="/">{t.teacherCourses.backHome}</Link></p>
      </main>
    </>
  );
}
