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

// Screen 11, brz put (F-11, D-80 point 2; contract #476 6274359158). The
// screen shows invented data until Backend gives the teacher the works of
// an assignment. The teacher role comes from the local operator command
// (K-3a), as in demo-flow.spec.ts, and is taken away again afterwards.

const t = messagesHr.fastPath;
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
  await page.goto("/nastavnik/brz-put");
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
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
  await expect(page.getByText(DEMO_FAST_PATH[0]!.surname)).toHaveCount(0);
});

test("the teacher goes through the works by surname; lines, marking, switch and empty state", async ({ page }) => {
  await asTeacher(page);
  await expect(page.getByText(t.sample)).toBeVisible();

  // I1: by surname, and nothing on the screen orders it otherwise.
  const nav = page.getByRole("navigation", { name: t.studentsLabel });
  const names = (await nav.locator("button span:first-child").allTextContents());
  expect(names).toEqual(bySurname(DEMO_FAST_PATH).map(fullName));
  // The shell's sign-out form sits outside the page; the page itself has no controls.
  await expect(page.getByRole("main").locator("select, input, textarea, form")).toHaveCount(0);
  await snapshot(page, "brz-put-1440");

  // The one with a paste without a source.
  const pasted = DEMO_FAST_PATH.find((s) => s.record && s.record.pastesWithoutSource.length > 0)!;
  await nav.getByRole("button", { name: fullName(pasted) }).click();
  await expect(nav.getByRole("button", { name: fullName(pasted) })).toHaveAttribute("aria-current", "true");
  const lines = page.locator("dl");
  await expect(lines.locator("dt")).toHaveText([t.lines.lastChange, t.lines.revisions, t.lines.pastes, t.lines.declaration, messagesHr.summary.recordState.label]);
  await expect(page.locator("[data-marked=true]")).toHaveCount(0);

  // The summary, then the paste line brings the text back with the paragraph marked.
  await page.getByRole("button", { name: t.views.summary }).click();
  await expect(page.getByRole("region", { name: messagesHr.summary.title })).toBeVisible();
  await expect(page.getByText(messagesHr.summary.sameForEveryone)).toBeVisible();
  await lines.locator("[data-line=pastes] button").click();
  await expect(page.getByRole("button", { name: t.views.text })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-marked=true]")).toHaveCount(pasted.record!.pastesWithoutSource.length);
  await expect(page.locator("[data-marked=true]")).toContainText(t.pastedTag);

  // No record yet: no lines, no switch.
  const pending = DEMO_FAST_PATH.find((s) => s.record === null)!;
  await nav.getByRole("button", { name: fullName(pending) }).click();
  await expect(page.getByText(t.noRecordYet)).toBeVisible();
  await expect(page.locator("dl")).toHaveCount(0);
  await expect(page.getByRole("button", { name: t.views.summary })).toHaveCount(0);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("at 390 px the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asTeacher(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await snapshot(page, "brz-put-390");
});
