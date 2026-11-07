import { createHash } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { THEME_KEY } from "../../src/components/shell/theme";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, signIn } from "./support";

// DAN-591 (A-03; contract on #1091, c.6708627828): /ustanova/kolegiji on the
// fake provider, read only. As in A-02 and A-04, the invented "Ustanova B:
// nastavnica" is appointed administrator through the operator procedure and
// revoked at the end. The invented courses of that institution are written
// once as the local admin, in academic years no other test uses (2030/2031
// and 2031/2032), so the newest year is always ours: two confirmed invented
// teachers, three invented students without names, a course with a holder,
// a team and two groups (one without a teacher), a course with nothing, and
// one course a year earlier. Shots in both themes, 1440 and 400 px (D-183).
const HREF = "/ustanova/kolegiji";
const REQUEST = "Zahtjev e2e A-03/2026";
const c = t.institutionCourses;
const NEWEST = "2031/2032";
const EARLIER = "2030/2031";
const ISSUER = "https://e2e-a03.invalid";

async function shoot(page: Page, name: string): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [THEME_KEY, theme]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      // axe at each width: the 400 px layout is its own page for contrast and reflow.
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations).toEqual([]);
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
  await expect(page.getByRole("heading", { name: c.title })).toHaveCount(0);
  await expect(page.getByRole("link", { name: t.shell.nav.institutionCourses })).toHaveCount(0);
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

/** Writes the invented courses of the institution once; a later run finds them and writes nothing. */
async function seedCourses(token: string): Promise<void> {
  await asAdmin(async (client) => {
    const { id: admin, institution } = await userOf(client, token);
    await client.query("BEGIN");
    try {
      const { rowCount } = await client.query(
        "SELECT 1 FROM institution.course WHERE institution_id = $1 AND academic_year IN ($2, $3)",
        [institution, NEWEST, EARLIER]);
      if (rowCount === 0) {
        const person = async (key: string, name?: [string, string]): Promise<string> => {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO identity.user_account (institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
             VALUES ($1, $2, $3, $4) RETURNING id`, [institution, ISSUER, `a03-${key}`, `a03-${key}@ustanova-b.invalid`]);
          const id = rows[0]!.id;
          if (name) {
            await client.query(
              "INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name) VALUES ($1, $2, $3, $4)",
              [id, institution, ...name]);
            await client.query(
              `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
               VALUES ($1, $2, 'teacher', $3, now())`, [institution, id, admin]);
          }
          return id;
        };
        const lucija = await person("nastavnica", ["Lucija", "Izmišljena"]);
        const petar = await person("nastavnik", ["Petar", "Primjerić"]);
        const students = [await person("student-1"), await person("student-2"), await person("student-3")];

        const course = async (name: string, year: string): Promise<string> => (await client.query<{ id: string }>(
          `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
           VALUES ($1, $2, $3, 'prohibited', $4) RETURNING id`, [institution, name, year, lucija])).rows[0]!.id;
        const member = (courseId: string, userId: string, role: "teacher" | "student") => client.query(
          "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
          [courseId, institution, userId, role]);
        const group = async (courseId: string, name: string): Promise<string> => (await client.query<{ id: string }>(
          `INSERT INTO institution.seminar_group (course_id, institution_id, name, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id`, [courseId, institution, name, lucija])).rows[0]!.id;
        const inGroup = (table: "seminar_group_teacher" | "seminar_group_member", groupId: string, courseId: string,
          userId: string) => client.query(
          `INSERT INTO institution.${table} (group_id, course_id, institution_id, user_id, assigned_by)
           VALUES ($1, $2, $3, $4, $5)`, [groupId, courseId, institution, userId, lucija]);

        const intro = await course("Uvod u izmišljene studije", NEWEST);
        await member(intro, lucija, "teacher");
        await member(intro, petar, "teacher");
        for (const s of students) await member(intro, s, "student");
        await client.query(
          "INSERT INTO institution.course_holder (course_id, institution_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)",
          [intro, institution, lucija, lucija]);
        const a = await group(intro, "Seminar A");
        const b = await group(intro, "Seminar B");
        await inGroup("seminar_group_teacher", a, intro, petar);
        await inGroup("seminar_group_member", a, intro, students[0]!);
        await inGroup("seminar_group_member", a, intro, students[1]!);
        await inGroup("seminar_group_member", b, intro, students[2]!);

        await course("Metode oglednog istraživanja", NEWEST);

        const earlier = await course("Ogledni kolegij prošle godine", EARLIER);
        await member(earlier, petar, "teacher");
        await member(earlier, students[0]!, "student");
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
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fustanova%2Fkolegiji");
  await expect(page.getByRole("link", { name: t.shell.nav.institutionCourses })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: c.title })).toHaveCount(0);
});

test("a student gets a 404, not the courses", async ({ page }) => {
  await signIn(page, "/zadaci", "Demo studentica");
  await expectNotFound(page);
});

test("the administrator reads the courses of each year, team and groups, and loses the page with the role", async ({ page }) => {
  await signIn(page, HREF, "Ustanova B: nastavnica");
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  await expectNotFound(page);
  await seedCourses(token!);

  await operator(token!, "appoint");
  try {
    await page.goto(HREF);
    await expect(page).toHaveTitle(`${c.title} · ${t.app.name}`);
    await expect(page.getByRole("heading", { level: 1, name: c.title })).toBeVisible();
    const nav = page.getByRole("navigation", { name: t.shell.workNav });
    await expect(nav.getByRole("link", { name: t.shell.nav.institutionCourses })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: t.shell.nav.users })).not.toHaveAttribute("aria-current", "page");

    // The newest year is chosen without a parameter.
    await expect(page.getByRole("heading", { level: 2, name: c.yearHeading.replace("{year}", "2031./2032.") })).toBeVisible();
    const years = page.getByRole("navigation", { name: c.yearsLabel });
    await expect(years.getByRole("link", { name: "2031./2032." })).toHaveAttribute("aria-current", "page");
    await expect(years.getByRole("link", { name: "2030./2031." })).not.toHaveAttribute("aria-current", "page");

    const intro = page.getByRole("article", { name: "Uvod u izmišljene studije" });
    await expect(intro).toContainText("3 upisana studenta");
    await expect(intro).toContainText(`${c.holder}Lucija Izmišljena`);
    await expect(intro).toContainText(`${c.team}Lucija Izmišljena, Petar Primjerić`);
    await expect(intro.getByRole("heading", { level: 4 })).toHaveText(["Seminar A", "Seminar B"]);
    await expect(intro).toContainText(`${c.groupTeacher.one}: Petar Primjerić`);
    await expect(intro).toContainText("2 studenta");
    await expect(intro).toContainText(c.noTeacher);
    const empty = page.getByRole("article", { name: "Metode oglednog istraživanja" });
    await expect(empty).toContainText("0 upisanih studenata");
    await expect(empty).toContainText(c.noHolder);
    await expect(empty).toContainText(c.noTeam);
    await expect(empty).toContainText(c.noGroups);
    await expect(page.getByRole("article", { name: "Ogledni kolegij prošle godine" })).toHaveCount(0);
    // Read only, and no student is named or identified.
    await expect(page.getByRole("main").locator("button, form, input")).toHaveCount(0);
    expect(await page.getByRole("main").innerText()).not.toMatch(/a03-|student-\d/);
    await shoot(page, "a03-kolegiji");

    await years.getByRole("link", { name: "2030./2031." }).click();
    await expect(page).toHaveURL(`${HREF}?godina=2030%2F2031`);
    await expect(page.getByRole("heading", { level: 2, name: c.yearHeading.replace("{year}", "2030./2031.") })).toBeVisible();
    const earlier = page.getByRole("article", { name: "Ogledni kolegij prošle godine" });
    await expect(earlier).toContainText("1 upisan student");
    await expect(earlier).toContainText(`${c.team}Petar Primjerić`);
    await expect(page.getByRole("article")).toHaveCount(1);

    // A year the institution has no course in, or no year at all, shows the newest year, never the asked one.
    for (const asked of ["1999/2000", "2031-2032", "<b>2031/2032</b>"]) {
      await page.goto(`${HREF}?godina=${encodeURIComponent(asked)}`);
      await expect(page.getByRole("heading", { level: 2, name: c.yearHeading.replace("{year}", "2031./2032.") })).toBeVisible();
      expect(await page.getByRole("main").innerText()).not.toContain(asked);
    }
  } finally {
    await operator(token!, "revoke");
  }
  await expectNotFound(page);
});
