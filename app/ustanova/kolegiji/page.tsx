import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import InstitutionCourses from "@/components/admin/InstitutionCourses";
import { institutionScreen } from "@/components/admin/institution-access";
import { chosenYear, coursesPage, yearParam } from "@/components/admin/institution-courses-view";
import AccessCard from "@/components/auth/AccessCard";
import { accessShellScope } from "@/components/auth/access-kind";
import AppShell from "@/components/shell/AppShell";
import { shellSession } from "@/components/shell/shell-session";
import { messagesHr } from "@/lib/i18n/messages.hr";
import { pageActivity } from "@/server/auth/activity";
import { accessCookie } from "@/server/auth/ended-mark";
import { sessionPrincipal } from "@/server/auth/principal";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import { readAcademicYears, readInstitutionCourses } from "@/server/institution/institution-courses";

import styles from "./page.module.css";

const t = messagesHr.institutionCourses;
const HREF = "/ustanova/kolegiji";

type Props = { searchParams: Promise<{ godina?: string | string[] }> };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One read per request, shared by the title and the page. The years and the
// principal are read in parallel; the courses only for one of the
// institution's own years, after them (coursesPage joins the two answers).
const resolveScreen = cache(async (asked: string | undefined) => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  pageActivity(token);
  const [years, principal] = await Promise.all([
    token === undefined ? null : readAcademicYears(token, withActor),
    sessionPrincipal(token, withActor),
  ]);
  const year = years?.kind === "ok" ? chosenYear(years.years, asked) : null;
  const courses = year === null ? null : await readInstitutionCourses(token, year, withActor);
  const read = years === null ? null : coursesPage(years, courses);
  return { token, read, principal, screen: institutionScreen(read?.kind ?? null, principal.kind, accessCookie(token, (name) => store.has(name))) };
});

// No static title: the browser would apply it after a 404 and name the page in
// the tab. The 404 takes the title of a route that does not exist.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { screen } = await resolveScreen(yearParam((await searchParams).godina));
  const title = screen === "notFound" ? messagesHr.errorPage.notFoundTitle : t.title;
  return { title: `${title} · ${messagesHr.app.name}` };
}

// DAN-591 (A-03): the administrator reads the courses of their own
// institution by academic year, under the session cookie only, as A-01, A-02
// and A-04. The database decides which institution and whether the caller
// may see it; anyone else gets the 404 of a route that does not exist. A
// failed read is an alert, never an empty year. Read only: no action here.
export default async function InstitutionCoursesPage({ searchParams }: Props) {
  const { token, read, principal, screen } = await resolveScreen(yearParam((await searchParams).godina));
  if (screen === "notFound") notFound();

  const card = screen === "expired" || screen === "signedOut";
  let body;
  if (card) {
    body = <AccessCard kind={screen} returnTo={HREF} what="institutionCourses" />;
  } else if (screen === "unavailable" || read?.kind !== "ok") {
    body = (
      <div className={styles.unavailable}>
        <p role="alert">{t.unavailable}</p>
        <a className={styles.retry} href={HREF}>{t.retry}</a>
      </div>
    );
  } else {
    body = <InstitutionCourses href={HREF} years={read.years} year={read.year} courses={read.courses} />;
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
