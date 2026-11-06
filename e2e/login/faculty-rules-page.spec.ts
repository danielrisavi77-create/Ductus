import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, signIn } from "./support";

// DAN-590 (A-04; contract on #1091, c.6695058963): /ustanova/pravila on the
// fake provider. As in A-02, the invented "Ustanova B: nastavnica" is
// appointed administrator through the operator procedure and revoked at the
// end. Rule versions cannot be removed, so the invented rules of that
// institution are written once as the local admin and kept: a converted
// version 1 and an administrator's version 2 of the master thesis, a version 1
// of the bachelor thesis. Shots in both themes, 1440 and 400 px (D-183).
const HREF = "/ustanova/pravila";
const REQUEST = "Zahtjev e2e A-04/2026";
const r = t.facultyRuleVersions;
const types = t.teacher.assignment.workTypes;

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

/** The page is a 404 that names nothing of the institution (as A-01). */
async function expectNotFound(page: Page): Promise<void> {
  const response = await page.goto(HREF);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: t.errorPage.notFoundTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: r.currentHeading })).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.shell.nav.facultyRules })).toHaveCount(0);
}

async function asAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function userOf(client: pg.Client, token: string): Promise<{ id: string; institution: string }> {
  const { rows } = await client.query<{ id: string; institution: string }>(
    `SELECT u.id, u.institution_id AS institution FROM identity.session s JOIN identity.user_account u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [createHash("sha256").update(token, "utf8").digest()],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** Runs the operator procedure for the person behind the session cookie. */
async function operator(token: string, procedure: "appoint" | "revoke"): Promise<void> {
  await asAdmin(async (client) => {
    const { id } = await userOf(client, token);
    await client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [id, REQUEST]);
  });
}

/** Writes the invented rules of the institution once; a later run finds them and writes nothing. */
async function seedRules(token: string): Promise<void> {
  await asAdmin(async (client) => {
    const { id, institution } = await userOf(client, token);
    await client.query("BEGIN");
    try {
      const { rowCount } = await client.query(
        "SELECT 1 FROM institution.faculty_rule_version WHERE institution_id = $1 AND work_type IN ('master_thesis', 'bachelor_thesis')",
        [institution]);
      if (rowCount === 0) {
        const insert = `INSERT INTO institution.faculty_rule_version (institution_id, work_type, version_no, ai_policy,
          ai_purposes, evidence_profile, import_allowed, origin, published_by, published_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
        await client.query(insert, [institution, "master_thesis", 1, "partially_allowed",
          ["proofreading", "literature_search"], "basic", false, "operator", null, "2026-09-15T08:00:00Z"]);
        await client.query(insert, [institution, "master_thesis", 2, "partially_allowed",
          ["proofreading", "literature_search", "translation"], "extended", true, "administrator", id, "2026-10-20T09:00:00Z"]);
        await client.query(
          `INSERT INTO audit.faculty_rule_event (institution_id, work_type, version_no, kind, actor_id, occurred_at)
           VALUES ($1, 'master_thesis', 2, 'published', $2, '2026-10-20T09:00:00Z')`, [institution, id]);
        await client.query(insert, [institution, "bachelor_thesis", 1, "prohibited", [], "basic", false, "operator", null,
          "2026-09-15T08:00:00Z"]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

test("signed out: the sign-in card leads back to the page, with no navigation item", async ({ page }) => {
  await page.goto(HREF);
  await expect(page.getByRole("heading", { level: 1, name: t.access.signedOutTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: t.prijava.button }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fustanova%2Fpravila");
  await expect(page.getByRole("link", { name: t.shell.nav.facultyRules })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: r.currentHeading })).toHaveCount(0);
});

test("a student gets a 404, not the rules", async ({ page }) => {
  await signIn(page, "/zadaci", "Demo studentica");
  await expectNotFound(page);
});

test("the administrator reads each rule in force and its versions, and loses the page with the role", async ({ page }) => {
  await signIn(page, HREF, "Ustanova B: nastavnica");
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  await expectNotFound(page);
  await seedRules(token!);

  await operator(token!, "appoint");
  try {
    await page.goto(HREF);
    await expect(page).toHaveTitle(`${r.title} · ${t.app.name}`);
    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    const nav = page.getByRole("navigation", { name: t.shell.workNav });
    await expect(nav.getByRole("link", { name: t.shell.nav.facultyRules })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: t.shell.nav.users })).not.toHaveAttribute("aria-current", "page");

    const master = page.getByRole("article", { name: types.master_thesis });
    await expect(master.getByText(r.versionOf.replace("{n}", "2").replace("{date}", "20. listopada 2026."))).toBeVisible();
    await expect(master.getByText(r.profiles.extended)).toBeVisible();
    const history = master.getByRole("table").getByRole("row");
    await expect(history).toHaveCount(3);
    await expect(history.nth(1)).toContainText(r.inForce.replace("{n}", "2"));
    await expect(history.nth(2)).toContainText(r.origins.operator);
    await expect(page.getByRole("article", { name: types.bachelor_thesis }).getByText(r.purposesNone)).toBeVisible();
    await expect(page.getByRole("heading", { name: r.notSetHeading })).toBeVisible();
    await expect(page.getByRole("main").locator("button, form, input")).toHaveCount(0);
    await shoot(page, "a04-pravila-fakulteta");
  } finally {
    await operator(token!, "revoke");
  }
  await expectNotFound(page);
});
