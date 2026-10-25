import { expect, test } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, seedWork } from "./work-seed";

// #711 contract 6404612273: "Moji zadaci" lists the student's own courses and
// assignments from one RLS read and links each to /rad, which decides access
// and the notice. Every course, assignment and account here is invented.
test.afterEach(closeWork);

/** The seeded course's name and a second assignment in it, not acknowledged. */
async function secondAssignment(first: string): Promise<{ course: string; second: string; title: string }> {
  return admin(async (client) => {
    const { rows: [a] } = await client.query<{ course: string; name: string; institution: string; owner: string }>(
      `SELECT c.id AS course, c.name, a.institution_id AS institution, a.created_by AS owner
         FROM institution.assignment a JOIN institution.course c ON c.id = a.course_id WHERE a.id = $1`, [first]);
    const title = `Izmišljeni drugi zadatak ${Date.now().toString(36)}`;
    // current_version's key to assignment_version is deferred: both rows in one transaction, as seedWork.
    await client.query("BEGIN");
    const { rows: [second] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [a!.course, a!.institution, a!.owner]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, $2, 'Upute za izmišljeni zadatak.', 'essay', now() - interval '1 hour',
         now() + interval '40 days', 'prohibited', '{}', 'basic', false, $3)`, [second!.id, title, a!.owner]);
    await client.query("COMMIT");
    return { course: a!.name, second: second!.id, title };
  });
}

test("the student sees both assignments of the course, and each goes through /rad", async ({ page }) => {
  await signIn(page, "/zadaci");
  const first = await seedWork();
  const { course, second, title } = await secondAssignment(first);
  await page.reload();

  const section = page.getByRole("region", { name: course });
  await expect(section.getByRole("link")).toHaveCount(2);
  await expect(section.getByRole("link").first()).toHaveAttribute("href", `/rad?zadatak=${first}`);
  const unread = section.getByRole("link", { name: new RegExp(title) });
  await expect(unread).toHaveAttribute("href", `/rad?zadatak=${second}`);
  await expect(unread).toContainText(t.student.assignments.noticeFirst);
  await expect(section.getByRole("link").first()).not.toContainText(t.student.assignments.noticeFirst);

  // The list decides nothing: /rad sends the unacknowledged notice to /zadatak/<id>.
  await unread.click();
  await expect(page).toHaveURL(new RegExp(`/zadatak/${second}$`));
});

test("another student does not see the course, and a closed membership removes it", async ({ browser, page }) => {
  await signIn(page, "/zadaci");
  const first = await seedWork();
  const { course } = await secondAssignment(first);
  await page.reload();
  await expect(page.getByRole("region", { name: course })).toBeVisible();

  const other = await browser.newPage();
  await signIn(other, "/zadaci", "Demo student 2");
  await expect(other.getByRole("heading", { level: 1, name: t.student.assignments.heading })).toBeVisible();
  await expect(other.getByText(course)).toHaveCount(0);
  await other.close();

  await closeWork();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: t.student.assignments.heading })).toBeVisible();
  await expect(page.getByText(course)).toHaveCount(0);
});

test("without a session the page shows only the sign-in link", async ({ page }) => {
  await page.goto("/zadaci");
  await expect(page.getByText(t.student.assignments.signedOut)).toBeVisible();
  await expect(page.getByRole("link", { name: t.student.signIn })).toHaveAttribute("href", "/api/auth/login?returnTo=%2Fzadaci");
  await expect(page.locator("a[href^='/rad?zadatak=']")).toHaveCount(0);
});
