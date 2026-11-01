import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { SESSION_COOKIE, signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

// DAN-378 (M1.8): Z-03 for a closed session, "not signed in" without one and
// Z-05 for a signed-in person without the teacher role, after the UX pass of
// #1091 c.6561627758 and docs/design/ductura/prijava-v5.dc.html. Full-page
// shots in both themes at 1440 and 400 px (D-183). All accounts are invented.

const TEACHER_PAGES = ["/nastavnik", "/nastavnik/zadatak/novi", "/nastavnik/brz-put"] as const;
const SECOND_TEACHER = "demo-teacher-2@demo.ductus.test";

async function shoot(page: Page, name: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      await test.info().attach(`${name}-${colorScheme}-${width}`, {
        body: await page.screenshot({ fullPage: true }), contentType: "image/png",
      });
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
}

/** A cookie of the right shape that no open session has (as in home-shell.spec.ts). */
async function closedSessionCookie(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: SESSION_COOKIE, value: "Z".repeat(43), domain: "localhost", path: "/",
    secure: true, httpOnly: true, sameSite: "Lax",
  }]);
}

/** Z-05: the own account, no new sign-in and nothing of the page asked for (#1233). */
async function expectDenied(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: t.access.deniedTitle })).toBeVisible();
  await expect(page.getByText(t.access.deniedPending)).toBeVisible();
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.prijava.button })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: t.access.backToOwn })).toHaveAttribute("href", "/");
}

test("Z-03: a closed session on a teacher page, and /prijava leads there instead of round in a circle (#1231)", async ({ page }) => {
  await closedSessionCookie(page);
  await page.goto(`/prijava?returnTo=${encodeURIComponent("/nastavnik")}`);
  await expect(page).toHaveURL("http://localhost:3000/nastavnik");
  await expect(page.getByRole("heading", { level: 1, name: t.access.expiredTitle })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: t.access.expiredBody })).toBeVisible();
  await expect(page.getByRole("button", { name: t.shell.signOut })).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.prijava.button }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fnastavnik");
  await expectNoAxeViolations(page);
  await shoot(page, "z03-sesija-istekla");

  // /prijava never forwards back to itself.
  await page.goto(`/prijava?returnTo=${encodeURIComponent("/prijava")}`);
  await expect(page).toHaveURL("http://localhost:3000/");
  await expect(page.getByRole("heading", { level: 1, name: t.access.expiredTitle })).toBeVisible();
});

test("without a cookie every teacher page says it is not signed in, never that a session expired (#1234)", async ({ page }) => {
  for (const path of TEACHER_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: t.access.signedOutTitle }), path).toBeVisible();
    await expect(page.getByText(t.access.expiredTitle), path).toHaveCount(0);
    await expect(page.getByRole("link", { name: t.prijava.button }), path)
      .toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(path)}`);
  }
  await page.goto("/nastavnik");
  await expectNoAxeViolations(page);
  await shoot(page, "401-niste-prijavljeni");
});

test("Z-05: a student on every teacher page reads that it is not theirs, without a sign-in", async ({ page }) => {
  await signIn(page, "/rad");
  for (const path of TEACHER_PAGES) {
    await page.goto(path);
    await expectDenied(page);
  }
  await page.goto("/nastavnik/brz-put?zadatak=5d1c9a2e-7b3f-4e6a-9c8d-0f1e2d3c4b5a");
  await expectDenied(page);
  await expectNoAxeViolations(page);
  await shoot(page, "z05-studentica");
});

test("Z-05: a teacher without a confirmed role reads the same screen", async ({ page }) => {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `SELECT 1 FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
        WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher' AND r.revoked_at IS NULL`, [SECOND_TEACHER]);
    expect(rowCount).toBe(0);
  } finally {
    await client.end();
  }
  await signIn(page, "/", "Demo nastavnica");
  await page.goto("/nastavnik/zadatak/novi");
  await expectDenied(page);
  await expect(page.getByRole("button", { name: t.teacher.course.submit })).toHaveCount(0);
  await shoot(page, "z05-nastavnica-bez-uloge");
});
