import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { fillCodeDeadline, signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

// Z3 (A), "Moji kolegiji" at /nastavnik (#476 6289158306). The list comes from
// the same read as GET /api/teacher/courses; the teacher role comes from the
// local operator command (K-3a), as in fast-path.spec.ts, and is taken away
// again afterwards. Course names are invented.

const t = messagesHr.teacherCourses;
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEACHER_ID = "demo-teacher@demo.ductus.test";
const ACTIVE_ROLE = `FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
  WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher' AND r.revoked_at IS NULL`;
let roleGrantedByThisTest = false;

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const teacherRoleActive = () => withAdmin(async (client) =>
  (await client.query(`SELECT 1 ${ACTIVE_ROLE} AND r.confirmed_at IS NOT NULL`, [TEACHER_ID])).rowCount === 1);

test.afterEach(async () => {
  if (!roleGrantedByThisTest) return;
  await withAdmin((client) => client.query(
    `UPDATE institution.institution_role SET revoked_at = now() WHERE id IN (SELECT r.id ${ACTIVE_ROLE} AND r.confirmed_by IS NULL)`,
    [TEACHER_ID]));
  roleGrantedByThisTest = false;
});

async function asTeacher(page: Page): Promise<void> {
  await signIn(page, "/", "Demo nastavnik");
  roleGrantedByThisTest = !(await teacherRoleActive());
  await run("node", ["scripts/demo/provision-teacher.mjs"], { cwd: ROOT });
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
}

// DAN-378: Z-05 tells the student the page is not theirs and offers no new sign-in (#1233).
test("anonymous visitor is asked to sign in; a student reads that the page is not theirs", async ({ page }) => {
  await page.goto("/nastavnik");
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.access.signedOutTitle })).toBeVisible();
  await expect(page.getByText(messagesHr.access.signedOutBody.replace("{what}", messagesHr.access.what.courses))).toBeVisible();
  await expect(page.getByRole("link", { name: messagesHr.prijava.button }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fnastavnik");

  await signIn(page, "/nastavnik", "Demo studentica");
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.access.deniedTitle })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: t.empty })).toHaveCount(0);
  await expect(page.getByText(t.noAssignments)).toHaveCount(0);
  await expect(page.locator('a[href^="/api/auth/login"]')).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: messagesHr.access.backToOwn })).toHaveAttribute("href", "/");
});

// DAN-325: a confirmed teacher, with or without courses, lands on the list from "/" and from /prijava.
test("a signed-in teacher's home page and sign-in page lead to the course list", async ({ page }) => {
  await asTeacher(page);
  for (const path of ["/", "/prijava"]) {
    await page.goto(path);
    await expect(page).toHaveURL("http://localhost:3000/nastavnik");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  }
});

test("a teacher sees their course with its assignment, in the route's order, and a way to a new one", async ({ page }) => {
  await asTeacher(page);
  const courseName = `Izmišljeni kolegij ${Date.now().toString(36)}`;
  await page.goto("/nastavnik/zadatak/novi");
  await page.getByLabel(messagesHr.teacher.course.name).fill(courseName);
  // DAN-36 (#576 6362017778): the deadline starts empty and has no default; without it nothing is sent.
  const deadline = page.getByLabel(messagesHr.teacher.enrollmentCode.validUntil);
  await expect(deadline).toHaveValue("");
  await page.getByRole("button", { name: messagesHr.teacher.course.submit }).click();
  await expect(page.getByRole("alert").filter({ hasText: messagesHr.teacher.enrollmentCode.errors.missing })).toBeVisible();
  await expect(deadline).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: messagesHr.teacher.course.created })).toHaveCount(0);
  await fillCodeDeadline(page);
  await page.getByRole("button", { name: messagesHr.teacher.course.submit }).click();
  await expect(page.getByRole("status").filter({ hasText: messagesHr.teacher.course.created })).toBeVisible();
  // DAN-36: the issued code and its deadline sit inside the page's landmarks.
  await expect(page.getByText(messagesHr.teacher.enrollmentCode.shownOnce)).toBeVisible();
  const setupAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(setupAxe.violations).toEqual([]);
  await snapshot(page, "nastavnik-kod-za-upis");

  // The way back from the form is the list, not the public home page.
  await page.getByRole("main").getByRole("link", { name: messagesHr.teacher.backCourses }).click();
  await expect(page).toHaveURL("http://localhost:3000/nastavnik");
  const course = page.getByRole("region", { name: courseName });
  await expect(course).toBeVisible();
  await expect(course.getByText(t.noAssignments)).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: t.newCourse })).toHaveAttribute("href", "/nastavnik/zadatak/novi");
  // The shell (design v3) lists the teacher's items only, and marks this page.
  const nav = page.getByRole("navigation", { name: messagesHr.shell.workNav });
  await expect(nav.getByRole("link")).toHaveText([
    messagesHr.shell.nav.courses, messagesHr.shell.nav.newCourse, messagesHr.shell.nav.fastPath,
  ]);
  await expect(nav.getByRole("link", { name: messagesHr.shell.nav.courses })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: messagesHr.shell.signOut })).toBeVisible();
  // Nothing on the screen offers another order.
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(t.countNote)).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await snapshot(page, "nastavnik-moji-kolegiji");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await snapshot(page, "nastavnik-moji-kolegiji-390");
  // The drawer closes on its item for this very page, where no navigation happens.
  await page.getByRole("button", { name: messagesHr.shell.openNav }).click();
  await nav.getByRole("link", { name: messagesHr.shell.nav.courses }).click();
  await expect(page.locator("main#sadrzaj")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("complementary", { name: messagesHr.shell.sideNav })).toBeHidden();

  // The light theme with the navigation and its current item passes axe too.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: messagesHr.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  const lightAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(lightAxe.violations).toEqual([]);
});

// DAN-249 (#876): V3 and A2. The form before any input has no dates and no
// live data (its years are a fixed list), so its baseline is stable. Only the
// `main` element is compared, so the `next dev` indicator is not in the image;
// nothing is masked and the tolerances are Playwright's defaults. The baseline
// is made on the CI runner and committed after review (docs/TESTING.md §2).
test("V3 and A2: the new course and assignment form matches its baseline; the teacher navigation keeps its items", async ({ page }) => {
  await asTeacher(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/nastavnik/zadatak/novi");
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.teacher.title })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole("navigation", { name: messagesHr.shell.workNav })).toMatchAriaSnapshot(`
    - navigation "Radni prostor":
      - list:
        - listitem:
          - link "Moji kolegiji":
            - /url: /nastavnik
        - listitem:
          - link "Novi kolegij i zadatak":
            - /url: /nastavnik/zadatak/novi
        - listitem:
          - link "Brz put":
            - /url: /nastavnik/brz-put
  `);
  await expect(page.getByRole("main")).toHaveScreenshot("nastavnik-novi-zadatak.png");
});

test("without JavaScript a teacher on a phone still reaches signing out in the shell (I5)", async ({ page, browser }) => {
  await asTeacher(page);
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const noScript = await context.newPage();
    await noScript.goto("/nastavnik");
    const signOut = noScript.getByRole("button", { name: messagesHr.shell.signOut });
    await expect(signOut).toBeVisible();
    await signOut.click();
    await noScript.waitForLoadState();
    await noScript.goto("/nastavnik");
    await expect(noScript.getByRole("heading", { level: 1, name: messagesHr.access.signedOutTitle })).toBeVisible();
  } finally {
    await context.close();
  }
});

async function publishAssignment(page: Page, title: string): Promise<void> {
  const a = messagesHr.teacher.assignment;
  await page.getByLabel(a.title).fill(title);
  await page.getByLabel(a.opensAt).fill("2026-11-02T09:00");
  await page.getByLabel(a.dueAt).fill("2026-12-15T09:00");
  await page.getByRole("button", { name: a.publish }).click();
  await expect(page.getByRole("status").filter({ hasText: a.publishedNotice })).toBeVisible();
}

// DAN-310 (M2.4-P01): a further assignment in a course the teacher already has,
// from that course's row, with no second course form and the same code.
test("a teacher adds a second assignment to an existing course from the course list", async ({ page }) => {
  const e = messagesHr.teacher.existingCourse;
  await asTeacher(page);
  const suffix = Date.now().toString(36);
  const courseName = `Izmišljeni kolegij ${suffix}`;
  await page.goto("/nastavnik/zadatak/novi");
  await page.getByLabel(messagesHr.teacher.course.name).fill(courseName);
  await fillCodeDeadline(page);
  await page.getByRole("button", { name: messagesHr.teacher.course.submit }).click();
  await expect(page.getByRole("status").filter({ hasText: messagesHr.teacher.course.created })).toBeVisible();
  await publishAssignment(page, `Prvi izmišljeni zadatak ${suffix}`);

  await page.goto("/nastavnik");
  const course = page.getByRole("region", { name: courseName });
  await course.getByRole("link", { name: e.link }).click();
  await expect(page).toHaveURL(/\/nastavnik\/zadatak\/novi\?kolegij=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: e.title })).toBeVisible();
  const summary = page.getByRole("region", { name: messagesHr.teacher.course.heading });
  await expect(summary.getByText(courseName)).toBeVisible();
  await expect(summary.getByText(e.codeKept)).toBeVisible();
  await expect(page.getByLabel(messagesHr.teacher.course.name)).toHaveCount(0);
  await expect(page.getByRole("button", { name: messagesHr.teacher.course.submit })).toHaveCount(0);
  await expect(page.getByLabel(messagesHr.teacher.enrollmentCode.validUntil)).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  // D-183: the whole page, both themes, 1440 and 400 px.
  for (const pass of [0, 1]) {
    if (pass === 1) await page.getByRole("button", { name: messagesHr.shell.theme }).click();
    const theme = await page.locator("[data-theme]").first().getAttribute("data-theme");
    for (const width of [1440, 400]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await snapshot(page, `nastavnik-zadatak-u-kolegiju-${theme}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await publishAssignment(page, `Drugi izmišljeni zadatak ${suffix}`);
  await page.goto("/nastavnik");
  await expect(page.getByRole("region", { name: courseName }).locator("li").filter({ hasText: /izmišljeni zadatak/u }))
    .toHaveCount(2);
});

// DAN-310, T001 to T004 for the new entry: no session, no teacher role and a
// course outside the teacher's own read never show a course or a publish button.
test("a course id the account cannot read shows neither a course nor a publish button", async ({ page }) => {
  const foreign = "00000000-0000-4000-8000-00000000dead";
  const path = `/nastavnik/zadatak/novi?kolegij=${foreign}`;
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.access.signedOutTitle })).toBeVisible();
  await expect(page.getByRole("link", { name: messagesHr.prijava.button }))
    .toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(path)}`);
  await expect(page.getByRole("button", { name: messagesHr.teacher.assignment.publish })).toHaveCount(0);

  await signIn(page, path, "Demo studentica");
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.access.deniedTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: messagesHr.teacher.assignment.publish })).toHaveCount(0);
});

test("a teacher reads a course outside their own list as not available", async ({ page }) => {
  const e = messagesHr.teacher.existingCourse;
  await asTeacher(page);
  await page.goto("/nastavnik/zadatak/novi?kolegij=00000000-0000-4000-8000-00000000dead");
  await expect(page.getByRole("alert").filter({ hasText: e.missing })).toBeVisible();
  await expect(page.getByRole("button", { name: messagesHr.teacher.assignment.publish })).toHaveCount(0);
  await expect(page.getByLabel(messagesHr.teacher.course.name)).toHaveCount(0);
});
