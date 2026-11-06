import { messagesHr as t } from "@/lib/i18n/messages.hr";

/**
 * The side navigation of the design v3 shell (#476 6314969336, I3): which
 * items a role sees. The role is the one the server read for the page; the
 * browser never chooses it. Only routes that exist are listed, so no item
 * leads to a 404 (a unit test checks every href against `app/`).
 */
export type ShellRole = "teacher" | "student" | "admin";

export type NavItem = {
  href: string;
  label: string;
};

const NAV: Record<ShellRole, readonly NavItem[]> = {
  teacher: [
    { href: "/nastavnik", label: t.shell.nav.courses },
    { href: "/nastavnik/zadatak/novi", label: t.shell.nav.newCourse },
    { href: "/nastavnik/brz-put", label: t.shell.nav.fastPath },
    // DAN-492 (N-16): the works the teacher mentors (DAN-477).
    { href: "/nastavnik/mentorstva", label: t.shell.nav.mentoredWorks },
  ],
  student: [
    { href: "/zadaci", label: t.shell.nav.assignments },
    // DAN-344 (Archivum S02): the student's own courses, from the same read as /zadaci.
    { href: "/zadaci/kolegiji", label: t.shell.nav.courses },
    // DAN-309 (B2): the student's own works across courses, from app.student_workspace().
    { href: "/zadaci/radovi", label: t.shell.nav.works },
    { href: "/rad", label: t.shell.nav.workspace },
    { href: "/upis", label: t.shell.nav.enroll },
  ],
  // DAN-313 (A-01): the administrator's overview of their own institution.
  admin: [
    { href: "/ustanova", label: t.shell.nav.institution },
    // DAN-581 (A-02): the teacher roles of the same institution.
    { href: "/ustanova/korisnici", label: t.shell.nav.users },
  ],
};

/** The items of `role`; none without a role (signed out, or neither role). */
export function navFor(role: ShellRole | null): readonly NavItem[] {
  return role === null ? [] : NAV[role];
}

export type AccountPlace = "own" | "signOut" | "none";

/**
 * What the shell's account place holds (#802 part B): the page's own control
 * when it brings one, else the sign-out for anyone with a scope (a signed-in
 * person, with or without a role read for the page), else nothing.
 */
export function accountPlace(scope: string | null, ownAccount: boolean): AccountPlace {
  if (ownAccount) return "own";
  return scope !== null ? "signOut" : "none";
}

/**
 * Where "Početna" and the brand lead (#802 part B, D-202 t. 2): each role's
 * own home, the general home without a role. A student's home is S01 on
 * /zadaci (D-180), never the workspace; a teacher, also as a mentor (D-204),
 * goes to /nastavnik. Like the role itself, it only points the
 * way; every page still checks the session on its own.
 */
export function homeHref(role: ShellRole | null): string {
  if (role === "teacher") return "/nastavnik";
  if (role === "student") return "/zadaci";
  if (role === "admin") return "/ustanova";
  return "/";
}
