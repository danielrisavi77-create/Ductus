import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, signIn } from "./support";

// DAN-431 (M11.10, J-02; contract on #1836): "Kako Ductura radi" on the fake
// provider, for the four reader classes of the contract. The page is the same
// for all of them; the shell follows the session. The administrator is the
// invented "Ustanova B: nastavnica", appointed through the operator procedure
// and revoked at the end, as in the A-04 spec. Shots in both themes, 1440 and
// 400 px (D-183), compared with
// docs/design/ductura/m11-javno-reference/j02-kako-radi.html.
const HREF = "/kako-radi";
const REQUEST = "Zahtjev e2e J-02/2026";
const h = t.howItWorks;

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await test.info().attach(`${name}-${theme}-${width}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png",
      });
    }
  }
}

/** The whole page, in the reference's order, and the shell link marked as the page. */
async function expectPage(page: Page): Promise<void> {
  const response = await page.goto(HREF);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(`${h.title} · ${t.app.name}`);
  await expect(page.getByRole("heading", { level: 1, name: h.title })).toBeVisible();
  const headings = await page.locator("main h2").allInnerTexts();
  expect(headings).toEqual([
    h.recorded.heading, h.notRecorded.heading, h.seen.heading, h.saving.heading, h.check.heading, h.rules.heading,
  ]);
  const table = page.getByRole("table", { name: h.seen.heading });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("rowheader", { name: h.seen.rows.replay })).toBeVisible();
  await expect(page.getByRole("link", { name: t.shell.howItWorks })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main form, main input")).toHaveCount(0);
}

async function operator(token: string, procedure: "appoint" | "revoke"): Promise<void> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `SELECT s.user_id AS id FROM identity.session s WHERE s.token_hash = $1`,
      [createHash("sha256").update(token, "utf8").digest()],
    );
    expect(rows).toHaveLength(1);
    await client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [rows[0]!.id, REQUEST]);
  } finally {
    await client.end();
  }
}

test("signed out: the page, with no navigation and no sign-out", async ({ page }) => {
  await expectPage(page);
  await expect(page.getByRole("navigation", { name: t.shell.workNav })).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.shell.signOut })).toHaveCount(0);
  await shoot(page, "kako-radi-odjavljen");
});

test("a student: the same page in the student shell", async ({ page }) => {
  await signIn(page, "/zadaci", "Demo studentica");
  await expectPage(page);
  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link", { name: t.shell.nav.assignments })).toBeVisible();
  await shoot(page, "kako-radi-student");
});

test("a teacher: the same page in the teacher shell, reached from the side bar", async ({ page }) => {
  await signIn(page, "/nastavnik", "Demo nastavnik");
  await page.getByRole("link", { name: t.shell.howItWorks }).click();
  await expect(page).toHaveURL(new RegExp(`${HREF}$`));
  await expectPage(page);
  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link", { name: t.shell.nav.courses })).toBeVisible();
  await shoot(page, "kako-radi-nastavnik");
});

test("an administrator: the same page, in the shell of the base role", async ({ page }) => {
  await signIn(page, "/zadaci", "Ustanova B: nastavnica");
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  await operator(token!, "appoint");
  try {
    await expectPage(page);
    await expect(page.getByRole("link", { name: t.shell.nav.institution })).toHaveCount(0);
    await shoot(page, "kako-radi-administrator");
  } finally {
    await operator(token!, "revoke");
  }
});
