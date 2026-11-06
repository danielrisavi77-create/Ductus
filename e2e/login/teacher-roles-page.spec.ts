import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

// DAN-581 (A-02, PR 3/3): "Korisnici i uloge" for an administrator of the
// institution, on the server read of #1599. The administrator role comes from
// the local operator through the admin client, only for "Demo nastavnik", and
// only for this test (D-09 untouched: fake provider, local and CI only).
// Full-page shots in both themes at 1440 and 400 px (D-183, docs/SESSIONS.md
// §6). All accounts are invented.

const HREF = "/ustanova/korisnici";
const ADMIN = "demo-teacher@demo.ductus.test";

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Opens an operator-set administrator role (confirmed_by NULL) unless one is open; returns its id or null. */
const grantAdmin = () => withAdmin(async (client) => (await client.query<{ id: string }>(
  `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
     SELECT u.institution_id, u.id, 'admin', now() FROM identity.user_account u
      WHERE u.hr_edu_person_unique_id = $1
        AND NOT EXISTS (SELECT 1 FROM institution.institution_role r WHERE r.user_id = u.id
                          AND r.institution_id = u.institution_id AND r.role = 'admin' AND r.revoked_at IS NULL)
   RETURNING id`, [ADMIN])).rows[0]?.id ?? null);

let grantedRole: string | null = null;
test.afterEach(async () => {
  if (grantedRole === null) return;
  const id = grantedRole;
  grantedRole = null;
  await withAdmin((client) => client.query(
    "UPDATE institution.institution_role SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]));
});

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { level: 1, name: t.teacherRoles.title })).toBeVisible();
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

async function expectNotFound(page: Page): Promise<void> {
  const response = await page.goto(HREF);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: t.errorPage.notFoundTitle })).toBeVisible();
  await expect(page.getByText(t.teacherRoles.title)).toHaveCount(0);
}

test("A-02: an administrator sees both lists of the own institution, in the work nav", async ({ page }) => {
  await signIn(page, HREF, "Demo nastavnik");
  grantedRole = await grantAdmin();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HREF);
  await expect(page).toHaveTitle(`${t.teacherRoles.title} · ${t.app.name}`);
  await expect(page.getByRole("heading", { level: 1, name: t.teacherRoles.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: t.teacherRoles.pending.heading })).toBeVisible();
  await expect(page.getByRole("heading", { name: t.teacherRoles.confirmed.heading })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link", { name: t.shell.nav.users })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: t.shell.nav.users })).toHaveAttribute("href", HREF);
  await shoot(page, "a02-korisnici-i-uloge");
});

// The same 404 as A-01 (/ustanova): nothing tells them the page exists.
for (const account of ["Demo studentica", "Demo nastavnica"] as const) {
  test(`A-02: ${account} without the administrator role gets the 404 of a route that does not exist`, async ({ page }) => {
    await signIn(page, HREF, account);
    await expectNotFound(page);
  });
}
