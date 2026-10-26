import { messagesHr as t } from "@/lib/i18n/messages.hr";

/**
 * The side navigation of the design v3 shell (#476 6314969336, I3): which
 * items a role sees. The role is the one the server read for the page; the
 * browser never chooses it. Only routes that exist are listed, so no item
 * leads to a 404 (a unit test checks every href against `app/`).
 */
export type ShellRole = "teacher" | "student";

export type NavItem = {
  href: string;
  label: string;
};

const NAV: Record<ShellRole, readonly NavItem[]> = {
  teacher: [
    { href: "/nastavnik", label: t.shell.nav.courses },
    { href: "/nastavnik/zadatak/novi", label: t.shell.nav.newCourse },
    { href: "/nastavnik/brz-put", label: t.shell.nav.fastPath },
  ],
  student: [
    { href: "/rad", label: t.shell.nav.workspace },
    { href: "/upis", label: t.shell.nav.enroll },
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
 * Where "Početna" and the brand lead (#802 part B): each role's own space,
 * the general home without a role. Like the role itself, it only points the
 * way; every page still checks the session on its own.
 */
export function homeHref(role: ShellRole | null): string {
  if (role === "teacher") return "/nastavnik";
  if (role === "student") return "/rad";
  return "/";
}
