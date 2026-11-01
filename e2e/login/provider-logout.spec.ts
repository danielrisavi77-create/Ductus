import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import {
  appCookie, clickSignOut, ROLE_HOME, SESSION_COOKIE, sessionRow, signIn, signOutWithoutDialog,
} from "./support";

// DAN-212 (plan #1245): a sign-out also ends the session at the provider
// (RP-initiated logout), so on a shared computer the next sign-in asks for the
// account again. No test here clears the provider's cookies (A5): only the
// sign-out may end the provider's session. Every test runs in a fresh browser
// context; all accounts and text are invented.

const APP = "http://localhost:3000";
const PROVIDER = "http://localhost:8090";
const END_SESSION = `${PROVIDER}/session/end`;
const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const chipOf = (page: Page) => page.locator(".workspace__status .sync-chip");
const logoutOf = (page: Page) => page.getByRole("button", { name: t.auth.logout, exact: true });

/** Every request this page made to the provider's end_session. */
function providerLogouts(page: Page): URL[] {
  const seen: URL[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(END_SESSION)) seen.push(new URL(request.url()));
  });
  return seen;
}

/** The first visit carries only the client and the configured way back (C6, E1). */
function expectProviderLogout(seen: URL[]): void {
  expect(seen.length).toBeGreaterThan(0);
  const first = seen[0]!;
  expect(first.pathname).toBe("/session/end");
  expect([...first.searchParams].sort()).toEqual([
    ["client_id", "ductus-local"],
    ["post_logout_redirect_uri", `${APP}/`],
  ]);
}

async function expectSignedOut(page: Page, token: string): Promise<void> {
  expect(page.url()).toBe(`${APP}/`);
  expect(await appCookie(page.context(), SESSION_COOKIE)).toBeUndefined();
  expect(await sessionRow(token)).toMatchObject({ close_reason: "logout", closed_at: expect.any(Date) });
}

async function writeAndWait(page: Page, text: string): Promise<void> {
  await editorOf(page).click();
  await page.keyboard.type(text);
  await expect(chipOf(page)).toHaveAttribute("data-state", "LOCAL_DURABLE");
}

async function journalNames(page: Page): Promise<string[]> {
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
  return names.filter((name) => name.startsWith("ductus-journal-v1-"));
}

test("A1, A4, A5, G2: after a sign-out from the shell, the AAI@EduHr button leads to the account choice again", async ({ page, context }) => {
  const seen = providerLogouts(page);
  await signIn(page, "/upis");
  const first = (await appCookie(context, SESSION_COOKIE))!.value;
  await signOutWithoutDialog(page);
  await expectSignedOut(page, first);
  expectProviderLogout(seen);

  // G2: the way back shows the public home, signed out, with AAI@EduHr as the only way in.
  await expect(page.getByRole("link", { name: t.landing.enter }).first()).toBeVisible();
  await expect(logoutOf(page)).toHaveCount(0);
  await page.goto("/prijava");
  await expect(page.locator("input[type=password], input[type=email]")).toHaveCount(0);
  await page.getByRole("link", { name: t.prijava.button }).click();

  // A1: the provider asks again; nothing signs A in silently.
  await expect(page).toHaveURL(new RegExp(`^${PROVIDER}/interaction/`));
  await expect(page.getByRole("heading", { level: 1, name: "Demo prijava" })).toBeVisible();

  // A4: the next person is signed in as themselves.
  await page.getByRole("button", { name: "Demo student 2" }).click();
  await page.waitForURL(ROLE_HOME);
  const second = (await appCookie(context, SESSION_COOKIE))!.value;
  expect(second).not.toBe(first);
  expect(await sessionRow(second)).toMatchObject({ unique_id: "demo-student-2@demo.ductus.test", closed_at: null });
});

test("A2, G1: from the editor with work on the device, the dialog's sign-out also ends the provider's session", async ({ page, context }) => {
  const seen = providerLogouts(page);
  await signIn(page, "/rad");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await writeAndWait(page, "Nacrt P: siva bilježnica");
  await clickSignOut(page);
  await page.waitForURL(`${APP}/`);
  await expectSignedOut(page, token);
  expectProviderLogout(seen);
  // D-118: the work stays on the device, under this person's journal.
  expect(await journalNames(page)).toHaveLength(1);

  // G1: Back shows neither the work nor a signed-in person.
  for (let step = 0; step < 3; step += 1) {
    if (!(await page.goBack())) break;
    await page.waitForURL(new RegExp(`^${APP}/`));
    await expect(page.getByText("Nacrt P: siva bilježnica")).toHaveCount(0);
    await expect(logoutOf(page)).toHaveCount(0);
    expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
    if (page.url() === `${APP}/rad`) break;
  }

  // Another account in the same browser gets the choice and never sees that work.
  await signIn(page, "/rad", "Demo student 2");
  await expect(editorOf(page)).toHaveText("");
});

test("A3: from the editor without work on the device, Odjava ends the provider's session too", async ({ page, context }) => {
  const seen = providerLogouts(page);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expectProviderLogout(seen);
  // The same person signs in again only through the account choice.
  await signIn(page, "/rad");
});

test("B5: a stale second tab that signs out afterwards leaves no session open here or at the provider", async ({ page, context }) => {
  await signIn(page, "/upis");
  const token = (await appCookie(context, SESSION_COOKIE))!.value;
  const stale = await context.newPage();
  await stale.goto("/upis");
  await expect(logoutOf(stale)).toBeVisible();

  const seen = providerLogouts(page);
  await signOutWithoutDialog(page);
  await expectSignedOut(page, token);
  expectProviderLogout(seen);

  await logoutOf(stale).click();
  await stale.waitForURL(`${APP}/`);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
  await expect(logoutOf(stale)).toHaveCount(0);
  await signIn(stale, "/upis");
});

test("F2: the fake provider refuses a way back it does not know", async ({ page }) => {
  const response = await page.goto(
    `${END_SESSION}?client_id=ductus-local&post_logout_redirect_uri=${encodeURIComponent("https://napadac.test/")}`,
  );
  expect(response?.status()).toBe(400);
  expect(page.url().startsWith(PROVIDER)).toBe(true);
});
