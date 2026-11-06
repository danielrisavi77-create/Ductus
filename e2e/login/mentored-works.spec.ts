import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { signIn, type DemoAccount } from "./support";
import { admin, openWorkOf, STUDENT, TEACHER } from "./work-seed";
import { APP_ORIGIN } from "./origin";

// DAN-492 (M2.6-P02, N-16; contract on #1091, c.6578099855): the works a
// teacher mentors, on /nastavnik/mentorstva, from GET-side read DAN-477 alone.
// The mentorships are seeded as the local admin between invented demo
// accounts; the teacher roles come from the local operator command and are
// taken away again afterwards. Every title is invented.

const t = messagesHr.mentoredWorks;
const types = messagesHr.teacher.assignment.workTypes;
const PATH = "/nastavnik/mentorstva";
const OPEN = 30_000;
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STUDENT_2 = "demo-student-2@demo.ductus.test";
const TEACHER_2 = "demo-teacher-2@demo.ductus.test";
const ACTIVE_ROLE = `FROM institution.institution_role r JOIN identity.user_account u ON u.id = r.user_id
  WHERE u.hr_edu_person_unique_id = $1 AND r.role = 'teacher' AND r.revoked_at IS NULL`;

const granted: string[] = [];
const mentorships: string[] = [];

test.afterEach(async () => {
  const ids = mentorships.splice(0);
  const accounts = granted.splice(0);
  await admin(async (client) => {
    if (ids.length > 0) {
      await client.query("UPDATE institution.mentorship SET ended_at = now() WHERE id = ANY($1::uuid[]) AND ended_at IS NULL", [ids]);
    }
    for (const account of accounts) {
      await client.query(
        `UPDATE institution.institution_role SET revoked_at = now() WHERE id IN (SELECT r.id ${ACTIVE_ROLE} AND r.confirmed_by IS NULL)`,
        [account]);
    }
  });
});

/** A page of its own browser context, signed in as the account. */
async function signedIn(browser: Browser, account: DemoAccount): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, "/", account);
  return page;
}

/** Gives the demo teacher (or "Demo nastavnica") the teacher role, remembering a grant this test made. */
async function teacherRole(account: "demo-teacher" | "demo-teacher-2"): Promise<void> {
  const id = account === "demo-teacher" ? TEACHER : TEACHER_2;
  const active = await admin(async (client) =>
    (await client.query(`SELECT 1 ${ACTIVE_ROLE} AND r.confirmed_at IS NOT NULL`, [id])).rowCount === 1);
  await run("node", ["scripts/local/provision-teacher.mjs", ...(account === "demo-teacher" ? [] : [account])], { cwd: ROOT });
  if (!active) granted.push(id);
}

type WorkType = "bachelor_thesis" | "master_thesis";

/**
 * An open mentorship of the demo teacher over the student, with its assignment
 * and the student's acknowledgment of version 1; returns the assignment id.
 * The faculty's rule for the work type is added once when it is missing and
 * kept: a version that allows nothing is within any rule.
 */
async function seedMentorship(student: string, workType: WorkType, title: string): Promise<string> {
  return admin(async (client) => {
    await client.query("BEGIN");
    const people = (await client.query<{ unique_id: string; id: string; institution: string }>(
      `SELECT hr_edu_person_unique_id AS unique_id, id, institution_id AS institution FROM identity.user_account
        WHERE hr_edu_person_unique_id = ANY($1)`, [[TEACHER, student]])).rows;
    const mentor = people.find((p) => p.unique_id === TEACHER);
    const who = people.find((p) => p.unique_id === student);
    if (!mentor || !who) throw new Error("the demo teacher and the student must have signed in");
    await client.query(
      `INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
       VALUES ($1, $2, 'prohibited', '{}', 'basic', false) ON CONFLICT DO NOTHING`, [mentor.institution, workType]);
    const { rows: [mentorship] } = await client.query<{ id: string }>(
      `INSERT INTO institution.mentorship (institution_id, mentor_id, student_id, work_type)
       VALUES ($1, $2, $3, $4) RETURNING id`, [mentor.institution, mentor.id, who.id, workType]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (mentorship_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [mentorship!.id, mentor.institution, mentor.id]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, $2, 'Upute za izmišljeni mentorski rad.', $3, now() - interval '1 day', now() + interval '365 days',
         'prohibited', '{}', 'basic', false, $4)`, [assignment!.id, title, workType, mentor.id]);
    await client.query(
      "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignment!.id, who.id, mentor.institution]);
    await client.query("COMMIT");
    mentorships.push(mentorship!.id);
    return assignment!.id;
  });
}

const MASTER = "Izmišljeni diplomski rad o lokalnoj samoupravi";
const BACHELOR = "Izmišljeni završni rad o javnim politikama";

/** Two mentorships of the demo teacher; the first student opens hers. Returns the document of the open one. */
async function twoWorks(browser: Browser): Promise<{ teacher: Page; document: string }> {
  const teacher = await signedIn(browser, "Demo nastavnik");
  await teacherRole("demo-teacher");
  const second = await signedIn(browser, "Demo student 2");
  await second.context().close();
  const student = await signedIn(browser, "Demo studentica");
  const master = await seedMentorship(STUDENT, "master_thesis", MASTER);
  await seedMentorship(STUDENT_2, "bachelor_thesis", BACHELOR);
  const document = await openWorkOf(student, master);
  await student.context().close();
  return { teacher, document };
}

test("the mentor sees each work by surname, in words, and opens the live view of a started one", async ({ browser }) => {
  const { teacher: page, document } = await twoWorks(browser);
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  // The shell's own entry, whether the side bar is open or folded at this width.
  const entry = page.locator(`nav[aria-label="${messagesHr.shell.workNav}"] a[href="${PATH}"]`);
  await expect(entry).toHaveText(messagesHr.shell.nav.mentoredWorks);
  await expect(entry).toHaveAttribute("aria-current", "page");

  const list = page.getByRole("region", { name: t.listTitle });
  const rows = list.getByRole("listitem");
  // Đaković before Ljubić, as Croatian sorts them; nothing on the screen orders them otherwise.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Lucija Đaković");
  await expect(rows.nth(0)).toContainText(MASTER);
  await expect(rows.nth(0)).toContainText(`${types.master_thesis} · ${t.state.in_progress}`);
  await expect(rows.nth(1)).toContainText("Marko Ljubić");
  await expect(rows.nth(1)).toContainText(BACHELOR);
  await expect(rows.nth(1)).toContainText(`${types.bachelor_thesis} · ${t.state.not_started}`);
  await expect(page.getByText(t.orderNote)).toBeVisible();
  // The shell's sign-out form sits outside the page; the page itself has no controls.
  await expect(page.getByRole("main").locator("select, input, textarea, form")).toHaveCount(0);

  // A work not yet started has nothing to open.
  await expect(rows.nth(1).getByRole("link")).toHaveCount(0);
  const live = rows.nth(0).getByRole("link", { name: t.open });
  await expect(live).toHaveAttribute("href", `/nastavnik/rad/${encodeURIComponent(document)}`);
  await live.click();
  await expect(page).toHaveURL(`${APP_ORIGIN}/nastavnik/rad/${encodeURIComponent(document)}`);
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.liveView.context })).toBeAttached({ timeout: OPEN });
  await expect(page.getByText(messagesHr.liveView.invalid)).toHaveCount(0);
  await page.context().close();
});

test("another teacher sees no work, a student and an anonymous visitor see the closed page", async ({ browser, page }) => {
  await page.goto(PATH);
  await expect(page.getByRole("heading", { level: 1, name: messagesHr.access.signedOutTitle })).toBeVisible();
  await expect(page.getByText(t.listTitle)).toHaveCount(0);

  const { teacher } = await twoWorks(browser);
  await teacher.context().close();

  const other = await signedIn(browser, "Demo nastavnica");
  await teacherRole("demo-teacher-2");
  await other.goto(PATH);
  await expect(other.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
  await expect(other.getByRole("heading", { level: 2, name: t.empty })).toBeVisible();
  for (const text of ["Đaković", "Ljubić", MASTER, BACHELOR]) await expect(other.getByText(text)).toHaveCount(0);
  await expect(other.getByRole("link", { name: t.open })).toHaveCount(0);
  await other.context().close();

  const student = await signedIn(browser, "Demo studentica");
  await student.goto(PATH);
  await expect(student.getByRole("heading", { level: 1, name: messagesHr.access.deniedTitle })).toBeVisible();
  for (const text of [MASTER, BACHELOR, "Ljubić"]) await expect(student.getByText(text)).toHaveCount(0);
  await student.context().close();
});

test("D-183: the full page in both themes at 1440 and 400 px, without a sideways scroll", async ({ browser }) => {
  const { teacher: page } = await twoWorks(browser);
  await page.goto(PATH);
  await expect(page.getByRole("region", { name: t.listTitle }).getByRole("listitem")).toHaveCount(2);

  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`mentorstva-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  };

  await shoot("tamna", 1440);
  await shoot("tamna", 400);
  await page.getByRole("button", { name: messagesHr.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  await shoot("svijetla", 400);
  await shoot("svijetla", 1440);
  await page.context().close();
});
