import Link from "next/link";
import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import EnrollForm from "@/components/student/EnrollForm";
import { SIGN_IN_HREF } from "@/components/student/enroll-code";
import styles from "@/components/student/Enroll.module.css";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.student.enroll.title} · ${t.app.name}` };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// F-7 (#336), screen 04 of #476: enrollment by the teacher's code, then the
// notice of the open assignment. The page only checks that a session cookie
// is present; the server route decides everything else, and a 401 from it
// shows the sign-in link in the form.
export default async function EnrollPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const signedIn = Boolean(token && TOKEN.test(token));
  return (
    <>
      <AppHeader context={t.student.enroll.title} />
      <main id="sadrzaj" tabIndex={-1} className={`page ${styles.screen}`}>
        <section className={styles.card}>
          <h1>{t.student.enroll.heading}</h1>
          {signedIn ? (
            <EnrollForm />
          ) : (
            <>
              <p className={styles.hint} role="status">{t.student.enroll.signedOut}</p>
              <p><a className="btn" href={SIGN_IN_HREF}>{t.student.signIn}</a></p>
            </>
          )}
        </section>
        <p><Link href="/">{t.teacher.backHome}</Link></p>
      </main>
    </>
  );
}
