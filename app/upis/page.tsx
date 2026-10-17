import Link from "next/link";
import { cookies } from "next/headers";

import AppHeader from "@/components/shell/AppHeader";
import EnrollForm, { SIGN_IN_HREF } from "@/components/student/EnrollForm";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.student.enroll.title} · ${t.app.name}` };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// F-7 (#336): enrollment by the teacher's code. The page only checks that a
// session cookie is present; the server route decides everything else, and a
// 401 from it shows the sign-in link in the form.
export default async function EnrollPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const signedIn = Boolean(token && TOKEN.test(token));
  return (
    <>
      <AppHeader context={t.student.enroll.title} />
      <main id="sadrzaj" tabIndex={-1} className="page">
        <h1>{t.student.enroll.title}</h1>
        {signedIn ? (
          <EnrollForm />
        ) : (
          <>
            <p role="status">{t.student.enroll.signedOut}</p>
            <p><a href={SIGN_IN_HREF}>{t.student.signIn}</a></p>
          </>
        )}
        <p><Link href="/">{t.teacher.backHome}</Link></p>
      </main>
    </>
  );
}
