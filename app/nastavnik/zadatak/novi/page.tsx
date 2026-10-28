import Link from "next/link";
import { cookies } from "next/headers";

import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import TeacherSetup from "@/components/teacher/TeacherSetup";
import { teacherAccess } from "@/components/teacher/teacher-access";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.teacher.title} · ${t.app.name}` };

// FE-D10 (screen 10, design demo-tok-v2 step 2). Server access check is only
// a UX boundary; both POST routes recheck every write in the database under
// the authenticated principal.
export default async function TeacherNewAssignmentPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [access, principal] = await Promise.all([teacherAccess(token, withActor), sessionPrincipal(token, withActor)]);
  return (
    <AppShell
      session={shellSession(token)}
      scope={principal.kind === "signed-in" ? principal.scope : null}
      role={access === "allowed" ? "teacher" : null}
      current="/nastavnik/zadatak/novi"
      crumbs={[t.teacherCourses.title, t.teacher.title]}
    >
      <div className={`page ${styles.page}`}>
        <h1 className={styles.title}>{t.teacher.title}</h1>
        {access === "allowed" ? (
          <TeacherSetup />
        ) : (
          <>
            <p role="status">
              {t.teacher[access]}
            </p>
            {access !== "unavailable" ? (
              <p>
                {/* This API route starts an OIDC login. Use a real navigation
                    rather than Next's prefetchable client-side Link. */}
                <a href="/api/auth/login?returnTo=%2Fnastavnik%2Fzadatak%2Fnovi">
                  {t.teacher.signIn}
                </a>
              </p>
            ) : null}
          </>
        )}
        <p><Link href="/nastavnik">{t.teacher.backCourses}</Link></p>
      </div>
    </AppShell>
  );
}
