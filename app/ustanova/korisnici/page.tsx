import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import TeacherRoles from "@/components/admin/TeacherRoles";
import { institutionScreen } from "@/components/admin/institution-access";
import { teacherRolesView } from "@/components/admin/teacher-roles-view";
import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readTeacherRoles } from "@/server/institution/teacher-roles";

import styles from "./page.module.css";

const t = messagesHr.teacherRoles;
const HREF = "/ustanova/korisnici";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One read per request, shared by the title and the page.
const resolveScreen = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, principal] = await Promise.all([
    token === undefined ? null : readTeacherRoles(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  return { token, read, principal, screen: institutionScreen(read?.kind ?? null, principal.kind, token) };
});

// No static title: the browser would apply it after a 404 and name the page in
// the tab. The 404 takes the title of a route that does not exist.
export async function generateMetadata(): Promise<Metadata> {
  const { screen } = await resolveScreen();
  const title = screen === "notFound" ? messagesHr.errorPage.notFoundTitle : t.title;
  return { title: `${title} · ${messagesHr.app.name}` };
}

// DAN-581 (A-02): the administrator confirms and revokes the teacher role of
// their own institution, under the session cookie only, as A-01 (/ustanova).
// The database decides which institution and whether the caller may see it;
// anyone else gets the 404 of a route that does not exist. A failed read is an
// alert, never an empty list.
export default async function TeacherRolesPage() {
  const { token, read, principal, screen } = await resolveScreen();
  if (screen === "notFound") notFound();

  const card = screen === "expired" || screen === "signedOut";
  let body;
  if (card) {
    body = <AccessCard kind={screen} returnTo={HREF} what="users" />;
  } else if (screen === "unavailable" || read?.kind !== "ok") {
    body = (
      <div className={styles.unavailable}>
        <p role="alert">{t.unavailable}</p>
        <a className={styles.retry} href={HREF}>{t.retry}</a>
      </div>
    );
  } else {
    body = <TeacherRoles view={teacherRolesView(read)} />;
  }

  return (
    <AppShell session={shellSession(token)} role={screen === "allowed" ? "admin" : null}
      scope={accessShellScope(screen, principal)} current={HREF} crumbs={[t.title]}>
      <div className={`page ${styles.page}`}>
        {card ? null : <header className={styles.heading}>
          <h1>{t.title}</h1>
          <p className={styles.lead}>{t.lead}</p>
        </header>}
        {body}
      </div>
    </AppShell>
  );
}
