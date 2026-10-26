import { createHash } from "node:crypto";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";

// Shared by the specs that log in through the fake provider against
// `next dev` (playwright.login.config.ts). The demo accounts are invented
// (infra/fake-oidc); demo.ductus.test belongs to demo-fakultet (db/local/seed.sql).
export const SESSION_COOKIE = "__Host-ductus_session";
export const LOGIN_COOKIE = "__Host-ductus_login";

/**
 * The chip once typed text is in the journal (3d-2c2, G2 c.6393716541): on
 * `/rad?zadatak=` the evidence session sends it on while the browser is
 * online, so the chip may already have moved on to sending or to the signed
 * receipt. Offline and on `/rad` without an assignment it stays LOCAL_DURABLE.
 */
export const SAVED_HERE = /^(LOCAL_DURABLE|SYNCING|SYNCED)$/;

/**
 * The first opening of an assignment's work POSTs the open and refreshes the
 * render, which mounts the editor and its panel afresh (#731). A test acts on
 * the sheet only once the refreshed editor shows its toolbar.
 */
export async function editorMounted(page: Page): Promise<void> {
  await expect(page.getByRole("toolbar", { name: messagesHr.toolbar.label })).toBeVisible({ timeout: 30_000 });
}

// The admin login of the compose database reads identity.session to check
// what the browser cannot see: the session row behind the cookie.

export interface SessionRow {
  institution: string;
  unique_id: string;
  closed_at: Date | null;
  close_reason: string | null;
}

export async function sessionRow(token: string): Promise<SessionRow | undefined> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<SessionRow>(
      `SELECT i.slug AS institution, u.hr_edu_person_unique_id AS unique_id, s.closed_at, s.close_reason
         FROM identity.session s
         JOIN identity.user_account u ON u.id = s.user_id
         JOIN identity.institution i ON i.id = s.institution_id
        WHERE s.token_hash = $1`,
      [createHash("sha256").update(token, "utf8").digest()],
    );
    return rows[0];
  } finally {
    await client.end();
  }
}

export async function appCookie(context: BrowserContext, name: string) {
  return (await context.cookies("http://localhost:3000")).find((c) => c.name === name);
}

/** Where "/" sends a signed-in person: the teacher's page or the workspace (DAN-325). */
export const ROLE_HOME = /^http:\/\/localhost:3000\/(rad|nastavnik)$/;

/** A button on the provider's "Demo prijava" page (infra/fake-oidc). */
export type DemoAccount = "Demo studentica" | "Demo student 2" | "Demo nastavnik" | "Demo nastavnica";

/**
 * Signs in as a demo account (the student unless named) and returns the callback URL the provider sent.
 * "/" sends a signed-in person on to their own page (DAN-325), which depends on the roles the test
 * set up, so it waits for either.
 */
export async function signIn(page: Page, returnTo: string, account: DemoAccount = "Demo studentica"): Promise<string> {
  const callbacks: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://localhost:3000/api/auth/callback")) callbacks.push(request.url());
  });
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();
  await page.getByRole("button", { name: account }).click();
  await page.waitForURL(returnTo === "/" ? ROLE_HOME : `http://localhost:3000${returnTo}`);
  expect(callbacks).toHaveLength(1);
  return callbacks[0]!;
}

/** The sign-out dialog of the writing page (FE-D7, D-118). */
/** A `datetime-local` value `ms` from now, in the browser's own zone (the form reads it there). */
export function localInputAt(page: Page, ms: number): Promise<string> {
  return page.evaluate((offset) => {
    const at = new Date(Date.now() + offset);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
  }, ms);
}

/** DAN-36 (#576): "Stvori kolegij" also issues the code, so the form asks for its deadline first. */
export async function fillCodeDeadline(page: Page): Promise<void> {
  await page.getByLabel(messagesHr.teacher.enrollmentCode.validUntil).fill(await localInputAt(page, 7 * 24 * 3_600_000));
}

export function logoutDialogOf(page: Page) {
  return page.getByRole("dialog", { name: messagesHr.auth.logoutTitle });
}

/** Signs out from the writing page: "Odjava", then "Odjavi se" in the dialog. */
export async function clickSignOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: messagesHr.auth.logout, exact: true }).click();
  await logoutDialogOf(page).getByRole("button", { name: messagesHr.auth.logoutConfirm }).click();
}

/**
 * Signs out where nothing of this person stays on the device (D-118, O1 of
 * #476 c.6396707923): "Odjava" leads straight to the home page. A dialog
 * would hold the page, so the wait for "/" fails if one opens.
 */
export async function signOutWithoutDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: messagesHr.auth.logout, exact: true }).click();
  await page.waitForURL("http://localhost:3000/");
}

/**
 * Signs out where the evidence session may or may not have had the work
 * confirmed yet (3d-2c2b): still on its way, the dialog opens and is
 * confirmed; confirmed, nothing stays and "Odjava" leads straight home (O1).
 * For tests about what the next person sees, not about the dialog itself.
 */
export async function signOutHoweverHeld(page: Page): Promise<void> {
  await page.getByRole("button", { name: messagesHr.auth.logout, exact: true }).click();
  const confirm = logoutDialogOf(page).getByRole("button", { name: messagesHr.auth.logoutConfirm });
  const home = page.waitForURL("http://localhost:3000/");
  const first = await Promise.race([
    home.then(() => "home" as const),
    confirm.waitFor({ state: "visible" }).then(() => "dialog" as const, () => "home" as const),
  ]);
  if (first === "dialog") await confirm.click();
  await home;
}
