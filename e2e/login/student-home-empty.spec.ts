import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE, signIn } from "./support";
import { localAppUrl } from "./local-db-url";
import { admin } from "./work-seed";

// DAN-344, Archivum S01_prazna: a student without an open course sees the
// first arrival, never the unavailable state, with the same EnrollForm as
// /upis inline. The account is the invented "Demo student 2"; its open
// memberships are parked for the test and given back afterwards. The course
// and code come from the product RPCs, as in enroll-code.spec.ts.
const home = t.student.home;
const e = t.student.enroll;
const STUDENT_2 = "demo-student-2@demo.ductus.test";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROVISION_TEACHER = fileURLToPath(new URL("../../scripts/demo/provision-teacher.mjs", import.meta.url));

/** Closes the account's open student memberships; returns them to reopen. */
async function park(): Promise<string[]> {
  return admin(async (client) => (await client.query<{ id: string }>(
    `UPDATE institution.course_member m SET member_to = now() FROM identity.user_account u
      WHERE u.id = m.user_id AND u.hr_edu_person_unique_id = $1 AND m.role = 'student' AND m.member_to IS NULL
      RETURNING m.id`, [STUDENT_2])).rows.map((row) => row.id));
}

async function unpark(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await admin((client) => client.query("UPDATE institution.course_member SET member_to = NULL WHERE id = ANY($1::uuid[])", [ids]));
}

/** An invented course with one open assignment and an enrolment code, made by the demo teacher. */
async function seedCourse(browser: Browser): Promise<{ course: string; code: string; assignment: string }> {
  const teacherPage = await browser.newPage({ baseURL: "http://localhost:3000" });
  const pool = new pg.Pool({ connectionString: localAppUrl() });
  try {
    await signIn(teacherPage, "/", "Demo nastavnik");
    const token = (await appCookie(teacherPage.context(), SESSION_COOKIE))?.value;
    const provision = spawnSync(process.execPath, [PROVISION_TEACHER], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    expect(provision.status).toBe(0);
    const withActor = createWithActor(pool);
    return await withActor(token, async (tx) => {
      const course = (await tx.query<{ id: string }>(
        "SELECT institution.create_course($1, '2026/2027', 'prohibited') AS id", [`Izmišljeni kolegij S01 ${randomUUID()}`])).rows[0]!.id;
      const code = (await tx.query<{ code: string }>(
        "SELECT institution.create_enrollment_code($1, now() + interval '1 day') AS code", [course])).rows[0]!.code;
      const assignment = (await tx.query<{ id: string }>(
        `SELECT institution.create_assignment($1, 'Izmišljeni zadatak S01', 'Upute za izmišljeni zadatak.',
           'essay', now() - interval '1 minute', now() + interval '30 days',
           'prohibited', '{}'::text[], 'basic', false, NULL, NULL) AS id`, [course])).rows[0]!.id;
      return { course, code, assignment };
    });
  } finally {
    await pool.end();
    await teacherPage.close();
  }
}

const leave = (course: string) => admin((client) => client.query(
  "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [course]));

async function firstArrival(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: home.heading })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: home.empty.heading })).toBeVisible();
  await expect(page.getByText(home.unavailableHeading)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: home.courses })).toHaveCount(0);
}

test("S01_prazna: the first arrival, with the inline form, in both themes and at 390 px", async ({ page }) => {
  await signIn(page, "/zadaci", "Demo student 2");
  const parked = await park();
  try {
    await page.reload();
    await firstArrival(page);
    const code = page.getByRole("region", { name: home.empty.codeHeading });
    await expect(code.getByLabel(e.label)).toBeVisible();
    await expect(code.getByRole("button", { name: e.submit })).toBeDisabled();
    await expect(page.getByRole("region", { name: home.empty.nextHeading }).getByRole("listitem")).toHaveCount(3);

    const shoot = async (name: string, width: number) => {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await test.info().attach(`s01-prazna-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    };
    await shoot("tamna", 1440);
    await shoot("tamna", 390);
    await page.getByRole("button", { name: t.shell.theme }).click();
    await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
    await shoot("svijetla", 390);
    await shoot("svijetla", 1440);
  } finally {
    await unpark(parked);
  }
});

test("S01_prazna: the inline form keeps its outcomes and a real code goes to the notice", async ({ page, browser }) => {
  await signIn(page, "/zadaci", "Demo student 2");
  const parked = await park();
  const seeded = await seedCourse(browser);
  try {
    await page.reload();
    await firstArrival(page);
    const code = page.getByRole("region", { name: home.empty.codeHeading });

    // An outage of the enrolment route is the form's own message, and the page stays the first arrival.
    await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
    await code.getByLabel(e.label).fill(seeded.code);
    await code.getByRole("button", { name: e.submit }).click();
    await expect(code.getByText(e.errors.unavailable)).toBeVisible();
    await expect(page).toHaveURL(/\/zadaci$/);
    await firstArrival(page);
    await page.unroute("**/api/institution/enrollments");

    // The real POST, as on /upis: straight to the notice of the open assignment (PRODUCT §5 rule 6).
    await code.getByRole("button", { name: e.submit }).click();
    await page.waitForURL(`**/zadatak/${seeded.assignment}`);
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
  } finally {
    await leave(seeded.course);
    await unpark(parked);
  }
});
