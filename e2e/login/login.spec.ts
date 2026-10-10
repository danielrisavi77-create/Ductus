import { createHash } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

// The full login through the fake provider against `next dev`
// (playwright.login.config.ts). The demo accounts are invented
// (infra/fake-oidc); demo.ductus.test belongs to demo-fakultet (db/local/seed.sql).
const SESSION_COOKIE = "__Host-ductus_session";
const LOGIN_COOKIE = "__Host-ductus_login";

// The admin login of the compose database reads identity.session to check
// what the browser cannot see: the session row behind the cookie.
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";

interface SessionRow {
  institution: string;
  unique_id: string;
  closed_at: Date | null;
  close_reason: string | null;
}

async function sessionRow(token: string): Promise<SessionRow | undefined> {
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

async function appCookie(context: BrowserContext, name: string) {
  return (await context.cookies("http://localhost:3000")).find((c) => c.name === name);
}

/** Signs in as the demo student and returns the callback URL the provider sent. */
async function signIn(page: Page, returnTo: string): Promise<string> {
  const callbacks: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("http://localhost:3000/api/auth/callback")) callbacks.push(request.url());
  });
  await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page).toHaveURL(/^http:\/\/localhost:8090\/interaction\//);
  await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL(`http://localhost:3000${returnTo}`);
  expect(callbacks).toHaveLength(1);
  return callbacks[0]!;
}

async function expectNeutralPage(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "hr");
  await expect(page.getByRole("heading", { level: 1, name: "Prijava nije dovršena" })).toBeVisible();
}

test("the demo student signs in and lands on returnTo with a session", async ({ page, context }) => {
  await signIn(page, "/rad");

  const session = await appCookie(context, SESSION_COOKIE);
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  expect(session!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await appCookie(context, LOGIN_COOKIE)).toBeUndefined();

  expect(await sessionRow(session!.value)).toEqual({
    institution: "demo-fakultet",
    unique_id: "demo-student@demo.ductus.test",
    closed_at: null,
    close_reason: null,
  });
});

test("logout closes the session and clears the cookie", async ({ page, context }) => {
  await signIn(page, "/");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    return response.status;
  });
  // fetch follows the 303 to the home page.
  expect(status).toBe(200);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
});

test("a replayed callback ends on the neutral page and opens no session", async ({ page, context }) => {
  const callback = await signIn(page, "/");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;

  const response = await page.goto(callback);
  expect(response?.status()).toBe(400);
  await expectNeutralPage(page);
  // The replay neither replaced nor closed the session it found.
  expect((await appCookie(context, SESSION_COOKIE))?.value).toBe(token);
  expect(await sessionRow(token)).toMatchObject({ closed_at: null });
});

test("a callback with another state ends on the neutral page without a session", async ({ page, context }) => {
  // A redirect target cannot be routed, so the provider's redirects after the
  // account choice are followed here, and the browser gets the callback with
  // its state swapped for one the login cookie does not hold.
  await page.route("http://localhost:8090/interaction/*/login", async (route) => {
    let response = await route.fetch({ maxRedirects: 0 });
    for (let hop = 0; hop < 5; hop++) {
      const location = new URL(response.headers()["location"] ?? "", "http://localhost:8090");
      if (location.href.startsWith("http://localhost:3000/api/auth/callback?")) {
        location.searchParams.set("state", "x".repeat(43));
        return route.fulfill({ status: 303, headers: { location: location.href } });
      }
      response = await context.request.get(location.href, { maxRedirects: 0 });
    }
    throw new Error("the provider never redirected to the callback");
  });
  await page.goto("/api/auth/login");
  await page.getByRole("button", { name: "Demo studentica" }).click();
  await page.waitForURL(/^http:\/\/localhost:3000\/api\/auth\/callback\?/);
  await expectNeutralPage(page);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  expect(await appCookie(context, LOGIN_COOKIE)).toBeUndefined();
});
