import { createHash } from "node:crypto";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr } from "../../src/lib/i18n/messages.hr";

// Shared by the specs that log in through the fake provider against
// `next dev` (playwright.login.config.ts). The demo accounts are invented
// (infra/fake-oidc); demo.ductus.test belongs to demo-fakultet (db/local/seed.sql).
export const SESSION_COOKIE = "__Host-ductus_session";
export const LOGIN_COOKIE = "__Host-ductus_login";

// The admin login of the compose database reads identity.session to check
// what the browser cannot see: the session row behind the cookie.
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";

export interface SessionRow {
  institution: string;
  unique_id: string;
  closed_at: Date | null;
  close_reason: string | null;
}

export async function sessionRow(token: string): Promise<SessionRow | undefined> {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
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

/** A button on the provider's "Demo prijava" page (infra/fake-oidc). */
export type DemoAccount = "Demo studentica" | "Demo student 2" | "Demo nastavnik" | "Demo nastavnica";

/** Signs in as a demo account (the student unless named) and returns the callback URL the provider sent. */
export async function signIn(page: Page, returnTo: string, account: DemoAccount = "Demo studentica"): Promise<string> {
  const callbacks: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://localhost:3000/api/auth/callback")) callbacks.push(request.url());
  });
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();
  await page.getByRole("button", { name: account }).click();
  await page.waitForURL(`http://localhost:3000${returnTo}`);
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
