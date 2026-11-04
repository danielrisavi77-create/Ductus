import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import InstitutionOverview from "@/components/admin/InstitutionOverview";
import { institutionScreen } from "@/components/admin/institution-access";
import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readInstitutionOverview } from "@/server/institution/institution-overview";

import styles from "./page.module.css";

const t = messagesHr.institutionOverview;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One read per request, shared by the title and the page.
const resolveScreen = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const [read, principal] = await Promise.all([
    token === undefined ? null : readInstitutionOverview(token, withActor),
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

// DAN-313 (A-01): the administrator's overview of their own institution,
// under the session cookie only; the database decides which institution and
// whether the caller may see it. Anyone else gets the 404 of a route that does
// not exist; a failed read is an alert, never zeros.
export default async function InstitutionPage() {
  const { token, read, principal, screen } = await resolveScreen();
  if (screen === "notFound") notFound();

  const card = screen === "expired" || screen === "signedOut";
  let body;
  if (card) {
    body = <AccessCard kind={screen} returnTo="/ustanova" what="institution" />;
  } else if (screen === "unavailable" || read?.kind !== "ok") {
    body = (
      <>
        <p role="alert" className={styles.alert}>{t.unavailable}</p>
        <p><a className={styles.retry} href="/ustanova">{t.retry}</a></p>
      </>
    );
  } else {
    body = <InstitutionOverview overview={read.overview} />;
  }

  return (
    <AppShell session={shellSession(token)} role={screen === "allowed" ? "admin" : null}
      scope={accessShellScope(screen, principal)} current="/ustanova" crumbs={[t.title]}>
      <div className={`page ${styles.page}`}>
        {card ? null : <div className={styles.heading}>
          <h1>{t.title}</h1>
          <p className={styles.lead}>{t.lead}</p>
        </div>}
        {body}
      </div>
    </AppShell>
  );
}
