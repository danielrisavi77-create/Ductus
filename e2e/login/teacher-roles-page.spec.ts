import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, signIn } from "./support";

// DAN-581 (A-02, PR 3/3): /ustanova/korisnici on the fake provider. The demo
// stack has no administrator, so the invented "Ustanova B: nastavnica" (used by
// no other login spec; workers: 1) is appointed through the operator procedure
// of DAN-525 on an invented request and revoked again at the end. Shots of the
// page beside docs/design/ductura reference, both themes, 1440 and 400 px (D-183).
const HREF = "/ustanova/korisnici";
const REQUEST = "Zahtjev e2e A-02/2026";

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectNoAxeViolations(page);
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await test.info().attach(`${name}-${theme}-${width}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png",
      });
    }
  }
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
}

/** The page is a 404 that names nothing of the institution (as A-01). */
async function expectNotFound(page: Page): Promise<void> {
  const response = await page.goto(HREF);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: t.errorPage.notFoundTitle })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(`^${t.errorPage.notFoundTitle}`));
  await expect(page.getByRole("heading", { name: t.teacherRoles.title })).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.shell.nav.users })).toHaveCount(0);
}

/** Runs the operator procedure for the person behind the session cookie. */
async function operator(token: string, procedure: "appoint" | "revoke"): Promise<void> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ user_id: string }>(
      "SELECT user_id FROM identity.session WHERE token_hash = $1",
      [createHash("sha256").update(token, "utf8").digest()],
    );
    expect(rows).toHaveLength(1);
    await client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [rows[0]!.user_id, REQUEST]);
  } finally {
    await client.end();
  }
}

test("signed out: the sign-in card leads back to the page, with no navigation item", async ({ page }) => {
  await page.goto(HREF);
  await expect(page.getByRole("heading", { level: 1, name: t.access.signedOutTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: t.prijava.button }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fustanova%2Fkorisnici");
  await expect(page.getByRole("link", { name: t.shell.nav.users })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: t.teacherRoles.title })).toHaveCount(0);
});

test("a student gets a 404, not the lists", async ({ page }) => {
  await signIn(page, "/zadaci", "Demo studentica");
  await expectNotFound(page);
});

test("only once the operator appoints the administrator does the page open, and it closes with the revocation", async ({ page }) => {
  await signIn(page, HREF, "Ustanova B: nastavnica");
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  await expectNotFound(page);

  await operator(token!, "appoint");
  try {
    await page.goto(HREF);
    await expect(page).toHaveTitle(`${t.teacherRoles.title} · ${t.app.name}`);
    await expect(page.getByRole("heading", { level: 1, name: t.teacherRoles.title })).toBeVisible();
    await expect(page.getByText(t.teacherRoles.lead)).toBeVisible();
    const nav = page.getByRole("navigation", { name: t.shell.workNav });
    await expect(nav.getByRole("link", { name: t.shell.nav.users })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: t.shell.nav.institution })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: t.teacherRoles.pending.heading })).toBeVisible();
    await expect(page.getByRole("heading", { name: t.teacherRoles.confirmed.heading })).toBeVisible();
    await shoot(page, "a02-korisnici-i-uloge");
  } finally {
    await operator(token!, "revoke");
  }
  await expectNotFound(page);
});
