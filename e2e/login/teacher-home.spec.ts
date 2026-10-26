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
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("anonymous visitor is asked to sign in; a student reads only that there are no courses", async ({ page }) => {
  await page.goto("/nastavnik");
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(page.getByText(messagesHr.teacher.signedOut)).toBeVisible();
  await expect(page.getByRole("link", { name: messagesHr.teacher.signIn }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fnastavnik");

  await signIn(page, "/nastavnik", "Demo studentica");
  await expect(page.getByRole("heading", { level: 2, name: t.empty })).toBeVisible();
  await expect(page.getByText(t.noAssignments)).toHaveCount(0);
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
    await expect(noScript.getByText(messagesHr.teacher.signedOut)).toBeVisible();
  } finally {
    await context.close();
  }
});
