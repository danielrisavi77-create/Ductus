import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { appCookie, SESSION_COOKIE, signIn, signOutWithoutDialog } from "./support";

// #802 part B (DAN-325): every signed-in page in the shell has "Početna" in
// the top bar and a sign-out, at 1440 and 390 px; the signed-in home is in
// the shell. Fixed QA criterion (1)-(5) of the contract (#802 c.6403687712).
// All accounts and ids are invented.

const WIDTHS = [1440, 390] as const;
// An invented assignment id: the notice page shows its shell and "not found".
const NOTICE = "/zadatak/5d1c9a2e-7b3f-4e6a-9c8d-0f1e2d3c4b5a";
const PAGES = ["/", "/rad", "/upis", NOTICE, "/nastavnik", "/nastavnik/brz-put"] as const;

const homeCrumbOf = (page: Page) =>
  page.getByRole("navigation", { name: t.shell.breadcrumb }).getByRole("link", { name: t.shell.homeCrumb, exact: true });
const signOutOf = (page: Page) => page.getByRole("button", { name: t.shell.signOut, exact: true });

/** The sign-out: in the side bar from 800 px, behind ☰ on a phone. */
async function expectSignOut(page: Page, width: number): Promise<void> {
  if (width < 800) {
    await expect(signOutOf(page)).toBeHidden();
    await page.getByRole("button", { name: t.shell.openNav }).click();
  }
  await expect(signOutOf(page)).toBeVisible();
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

/** A cookie of the right shape that no open session has (as in sign-out.spec.ts row 1). */
async function closedSessionCookie(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: SESSION_COOKIE, value: "Z".repeat(43), domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax",
  }]);
}

for (const width of WIDTHS) {
  test(`QA (1): signed in, every page has Početna and a sign-out at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
    await signIn(page, "/upis");
    for (const path of PAGES) {
      await page.goto(path);
      await expect(homeCrumbOf(page), path).toBeVisible();
      await expectSignOut(page, width);
    }
  });
}

test("QA (2) and (4): a student's Početna leads to /rad; on a teacher page (no role) to / with a sign-out", async ({ page }) => {
  await signIn(page, "/upis");
  await expect(homeCrumbOf(page)).toHaveAttribute("href", "/rad");
  await expect(page.getByRole("link", { name: t.shell.home })).toHaveAttribute("href", "/rad");
  await homeCrumbOf(page).click();
  await page.waitForURL("http://localhost:3000/rad");

  await page.goto("/nastavnik/brz-put");
  await expect(homeCrumbOf(page)).toHaveAttribute("href", "/");
  await expect(page.getByText(t.shell.role.student, { exact: true })).toHaveCount(0);
  await expect(signOutOf(page)).toBeVisible();
});

test("QA (3): a student on a teacher page with an empty journal signs out without a dialog", async ({ page, context }) => {
  await signIn(page, "/nastavnik");
  await signOutWithoutDialog(page);
  expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
});

for (const width of WIDTHS) {
  test(`a cookie without an open session gets the home in the shell, Početna and the plain sign-out at ${width} px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
    await closedSessionCookie(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: t.home.welcome })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: t.home.workTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: t.home.openWorkspace })).toHaveAttribute("href", "/rad");
    await expect(page.getByRole("link", { name: t.home.openTeacher })).toHaveAttribute("href", "/nastavnik");
    await expect(page.getByRole("link", { name: t.home.enroll, exact: true })).toHaveAttribute("href", "/upis");
    await expect(homeCrumbOf(page)).toHaveAttribute("aria-current", "page");
    await snapshot(page, `home-signed-in-${width}`);
    await expectSignOut(page, width);
    await signOutOf(page).click();
    await page.waitForURL("http://localhost:3000/");
    expect(await appCookie(context, SESSION_COOKIE)).toBeUndefined();
    await expect(page.getByRole("link", { name: t.landing.enter }).first()).toBeVisible();
  });
}

test("QA (5): a signed-out visitor on / sees the public home, without Početna or a sign-out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: t.landing.enter }).first()).toBeVisible();
  await expect(homeCrumbOf(page)).toHaveCount(0);
  await expect(signOutOf(page)).toHaveCount(0);
});
