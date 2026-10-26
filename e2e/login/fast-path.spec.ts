import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { bySurname, fullName } from "../../src/components/teacher/fast-path";
import { DEMO_FAST_PATH } from "../../src/lib/i18n/demo-fast-path.hr";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";
import { localAdminUrl } from "./local-db-url";

// Screen 11, brz put (F-11, D-80 point 2; contracts #476 6274359158 and
// #757 6397637802). The route (B-11c) is answered here with invented data
// so the screen and its timing are tested apart from the server; the route
// has its own tests. The teacher role comes from the local operator command
// (K-3a), as in demo-flow.spec.ts, and is taken away again afterwards.

const t = messagesHr.fastPath;
const run = promisify(execFile);
const ASSIGNMENT = "6f1c2a4e-1111-4b2c-9d3e-000000000001";
const ROUTE = "**/api/teacher/fast-path";
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

/** Answers the fast path route with the invented works and counts what the page sent. */
async function answerRoute(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(ROUTE, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "ok", students: DEMO_FAST_PATH }) });
  });
  return bodies;
}

async function asTeacher(page: Page, path = `/nastavnik/brz-put?zadatak=${ASSIGNMENT}`, title: string = t.title): Promise<void> {
  await signIn(page, "/", "Demo nastavnik");
  roleGrantedByThisTest = !(await teacherRoleActive());
  await run("node", ["scripts/demo/provision-teacher.mjs"], { cwd: ROOT });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function snapshot(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("anonymous visitor and a student see no work", async ({ page }) => {
  await page.goto("/nastavnik/brz-put");
  await expect(page.getByText(messagesHr.teacher.signedOut)).toBeVisible();
  await expect(page.getByRole("navigation", { name: t.studentsLabel })).toHaveCount(0);

  await signIn(page, "/nastavnik/brz-put", "Demo studentica");
  await expect(page.getByText(t.denied)).toBeVisible();
  await expect(page.getByRole("navigation", { name: t.studentsLabel })).toHaveCount(0);
  await expect(page.getByText(DEMO_FAST_PATH[0]!.surname!)).toHaveCount(0);
});

test("the teacher goes through the works by surname; lines, switch and empty record", async ({ page }) => {
  const bodies = await answerRoute(page);
  await asTeacher(page);
  await expect(page.getByText(t.refresh)).toBeVisible();
  expect(bodies).toEqual([{ assignmentId: ASSIGNMENT }]);

  // I1: by surname, and nothing on the screen orders it otherwise.
  const nav = page.getByRole("navigation", { name: t.studentsLabel });
  const names = (await nav.locator("button span:first-child").allTextContents());
  expect(names).toEqual(bySurname(DEMO_FAST_PATH).map(fullName));
  // The shell's sign-out form sits outside the page; the page itself has no controls.
  await expect(page.getByRole("main").locator("select, input, textarea, form")).toHaveCount(0);
  await snapshot(page, "brz-put-1440");

  // The one with pastes without a source: a number, nothing to click (#757 O2, O3).
  const pasted = DEMO_FAST_PATH.find((s) => s.record && s.record.pastesWithoutSource > 0)!;
  await nav.getByRole("button", { name: fullName(pasted) }).click();
  await expect(nav.getByRole("button", { name: fullName(pasted) })).toHaveAttribute("aria-current", "true");
  const lines = page.locator("dl");
  await expect(lines.locator("dt")).toHaveText([t.lines.lastChange, t.lines.pastes, messagesHr.summary.recordState.label]);
  await expect(lines.locator("[data-line=pastes]")).toHaveText(String(pasted.record!.pastesWithoutSource));
  await expect(lines.locator("button")).toHaveCount(0);

  await page.getByRole("button", { name: t.views.summary }).click();
  await expect(page.getByRole("region", { name: messagesHr.summary.title })).toBeVisible();
  await expect(page.getByText(messagesHr.summary.sameForEveryone)).toBeVisible();
  await page.getByRole("button", { name: t.views.text }).click();
  await expect(page.getByRole("button", { name: t.views.text })).toHaveAttribute("aria-pressed", "true");

  // No record yet: no lines, no switch.
  const pending = DEMO_FAST_PATH.find((s) => s.record === null)!;
  await nav.getByRole("button", { name: fullName(pending) }).click();
  await expect(page.getByText(t.noRecordYet)).toBeVisible();
  await expect(page.locator("dl")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.views.summary })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("a new state comes at most once per five minutes (P-03)", async ({ page }) => {
  await page.clock.install();
  const bodies = await answerRoute(page);
  await asTeacher(page);
  await expect(page.getByText(t.refresh)).toBeVisible();
  expect(bodies).toHaveLength(1);
  // A few seconds of margin: the clock also runs while the page loads.
  await page.clock.runFor("04:55");
  expect(bodies).toHaveLength(1);
  await page.clock.runFor("00:10");
  await expect.poll(() => bodies.length).toBe(2);
});

test("without an assignment the page asks for one and sends nothing", async ({ page }) => {
  const bodies = await answerRoute(page);
  await asTeacher(page, "/nastavnik/brz-put");
  await expect(page.getByText(t.pickAssignment)).toBeVisible();
  await expect(page.getByRole("navigation", { name: t.studentsLabel })).toHaveCount(0);
  expect(bodies).toEqual([]);
});

test("the course screen opens the fast path of each assignment", async ({ page }) => {
  await asTeacher(page, "/nastavnik", messagesHr.teacherCourses.title);
  const links = page.getByRole("main").getByRole("link", { name: messagesHr.shell.nav.fastPath });
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
    expect(href).toMatch(/^\/nastavnik\/brz-put\?zadatak=[0-9a-f-]{36}$/);
  }
});

test("at 390 px the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await answerRoute(page);
  await asTeacher(page);
  await expect(page.getByRole("navigation", { name: t.studentsLabel })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await snapshot(page, "brz-put-390");
});
