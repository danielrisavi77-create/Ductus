import { cookies } from "next/headers";

import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope, mentoredWorksAccess, teacherPageAccess } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import MentoredWorks from "@/components/teacher/MentoredWorks";
import { teacherPageRead } from "@/components/teacher/teacher-access";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { accessCookie } from "@/server/auth/ended-mark";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readMentoredWorks } from "@/server/institution/mentored-works";

import styles from "../page.module.css";

const t = messagesHr.mentoredWorks;
const HREF = "/nastavnik/mentorstva";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: `${t.title} · ${messagesHr.app.name}` };

// DAN-492 (M2.6-P02, N-16): the works a teacher mentors, from the same read
// as GET /api/teacher/mentorships (DAN-477), under the session cookie only;
// the database decides whose. The role and session come from one snapshot
// (teacherPageRead), so the access screens are those of the other teacher
// pages (DAN-378): Z-03, "not signed in" and Z-05, none of them a work.
export default async function MentoredWorksPage() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  const [{ access, principal }, read] = await Promise.all([
    teacherPageRead(token, withActor),
    readMentoredWorks(token, withActor),
  ]);
  const screen = teacherPageAccess(mentoredWorksAccess(access, read.kind), principal.kind, accessCookie(token, (name) => store.has(name)));
  const card = screen === "expired" || screen === "signedOut" || screen === "denied";
  let body;
  if (card) {
    body = <AccessCard kind={screen} returnTo={HREF} what="mentoredWorks" />;
  } else if (screen === "unavailable" || read.kind !== "ok") {
    // A failed read is said as such, never as "no works".
    body = (
      <>
        <p role="alert" className={styles.alert}>{t.unavailable}</p>
        <p><a className={styles.retry} href={HREF}>{t.retry}</a></p>
      </>
    );
  } else {
    body = <MentoredWorks works={read.works} />;
  }

  return (
    <AppShell session={shellSession(token)} role={screen === "allowed" ? "teacher" : null} scope={accessShellScope(screen, principal)} current={HREF} crumbs={[t.title]}>
      <div className={`page ${styles.page}`}>
        {card ? null : <div className={styles.head}>
          <div className={styles.heading}>
            <h1>{t.title}</h1>
            <p className={styles.lead}>{t.lead}</p>
          </div>
        </div>}
        {body}
      </div>
    </AppShell>
  );
}
