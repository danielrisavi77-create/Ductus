import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";

import { signIn } from "./support";
import { admin, closeWork, openWorkOf, seedSubmission, seedWork, STUDENT, workDocument } from "./work-seed";

// DAN-309 (M2.3-P02, contract on #1091, comment 6573005331): "Moji radovi" on
// /zadaci/radovi, from app.student_workspace() alone. Each row tells one state
// from the server's fields, the filter only narrows what was read, an empty
// list and an unavailable read look different, and a row leads through /rad
// into the same work. Every course, assignment and account is invented.
const w = t.student.works;
const OPEN = 30_000;
const STUDENT_2 = "demo-student-2@demo.ductus.test";

test.afterEach(closeWork);

async function titleOf(assignment: string): Promise<string> {
  return admin(async (client) => (await client.query<{ title: string }>(
    "SELECT title FROM institution.assignment_version WHERE assignment_id = $1 ORDER BY version_no DESC LIMIT 1",
    [assignment])).rows[0]!.title);
}

/** Publishes version 2 of an assignment, so the student's confirmation of version 1 no longer holds. */
async function newVersion(assignment: string): Promise<void> {
  await admin(async (client) => {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       SELECT assignment_id, 2, title, 'Upute v2.', work_type, opens_at, due_at, ai_policy, ai_purposes,
         evidence_profile, import_allowed, created_by
         FROM institution.assignment_version WHERE assignment_id = $1 AND version_no = 1`, [assignment]);
    await client.query("UPDATE institution.assignment SET current_version = 2 WHERE id = $1", [assignment]);
    await client.query("COMMIT");
  });
}

const rowOf = (page: Page, title: string) => page.getByRole("article", { name: title });

test("rows tell each state, the filter narrows, and a row returns to the same work", async ({ page }) => {
  await signIn(page, "/zadaci/radovi");
  const fresh = await seedWork({ acknowledged: true });
  const versioned = await seedWork({ acknowledged: true });
  await newVersion(versioned);
  const submitted = await seedWork({ acknowledged: true });
  // One course in an earlier academic year, for the year filter.
  await admin((client) => client.query(
    `UPDATE institution.course SET academic_year = '2025/2026'
      WHERE id = (SELECT course_id FROM institution.assignment WHERE id = $1)`, [fresh]));
  const [freshTitle, versionedTitle, submittedTitle] =
    [await titleOf(fresh), await titleOf(versioned), await titleOf(submitted)];
  const document = await openWorkOf(page, submitted);
  await page.goto(`/rad?zadatak=${submitted}`);
  // A committed revision first, as in evidence.spec.ts: the server takes it before the submission.
  const editor = page.getByRole("textbox", { name: t.workspace.documentLabel });
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: OPEN });
  await editor.click();
  await editor.press("Control+End");
  await page.keyboard.type("Izmišljena rečenica.");
  await expect(page.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "SYNCED", { timeout: OPEN });
  await seedSubmission(document);

  await page.goto("/zadaci/radovi");
  await expect(page.getByRole("heading", { level: 1, name: w.title })).toBeVisible();
  await expect(rowOf(page, freshTitle)).toContainText(w.state.notStarted);
  await expect(rowOf(page, freshTitle).getByRole("link")).toHaveAttribute("href", `/rad?zadatak=${fresh}`);
  await expect(rowOf(page, versionedTitle)).toContainText(w.state.newVersion.replace("{version}", "2"));
  await expect(rowOf(page, versionedTitle).getByRole("link")).toHaveText(w.readNotice);
  await expect(rowOf(page, submittedTitle)).toContainText(w.state.submitted.replace(" {time}", ""));

  // The filter is a GET form: it narrows the list and survives the back button.
  await page.getByLabel(w.search).fill(submittedTitle);
  await page.getByRole("button", { name: w.apply }).click();
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel(w.search).fill("");
  await page.getByLabel(w.year).selectOption("2025/2026");
  await page.getByRole("button", { name: w.apply }).click();
  await expect(rowOf(page, freshTitle)).toBeVisible();
  await expect(rowOf(page, submittedTitle)).toHaveCount(0);
  await page.getByLabel(w.search).fill("nijedan-takav-naslov");
  await page.getByRole("button", { name: w.apply }).click();
  await expect(page.getByText(w.noMatch)).toBeVisible();
  await page.goBack();
  await expect(rowOf(page, freshTitle)).toBeVisible();
  await expect(page.getByLabel(w.search)).toHaveValue("");
  await expect(page.getByLabel(w.year)).toHaveValue("2025/2026");
  await page.getByRole("link", { name: w.reset }).click();
  await expect(rowOf(page, submittedTitle)).toBeVisible();
  // The fields follow the cleared filter, so applying again does not bring it back.
  await expect(page.getByLabel(w.year)).toHaveValue("");
  await expect(page.getByLabel(w.search)).toHaveValue("");
  await page.getByRole("button", { name: w.apply }).click();
  await expect(rowOf(page, submittedTitle)).toBeVisible();

  // Back from the editor, the row opens the same assignment and the same document.
  await rowOf(page, submittedTitle).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/rad\\?zadatak=${submitted}$`));
  await expect(page.getByRole("textbox", { name: t.workspace.documentLabel })).toBeVisible({ timeout: OPEN });
  await page.goBack();
  await expect(page).toHaveURL(/\/zadaci\/radovi/);
  await rowOf(page, submittedTitle).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/rad\\?zadatak=${submitted}$`));
  expect(await workDocument(submitted, STUDENT)).toBe(document);
});

test("an empty list and an unavailable read are two different screens", async ({ page }) => {
  await signIn(page, "/zadaci/radovi", "Demo student 2");
  const parked = await admin(async (client) => (await client.query<{ id: string }>(
    `UPDATE institution.course_member m SET member_to = now() FROM identity.user_account u
      WHERE u.id = m.user_id AND u.hr_edu_person_unique_id = $1 AND m.role = 'student' AND m.member_to IS NULL
      RETURNING m.id`, [STUDENT_2])).rows.map((row) => row.id));
  try {
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: w.emptyHeading })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

    await admin((client) => client.query("REVOKE EXECUTE ON FUNCTION app.student_workspace() FROM ductus_app"));
    try {
      await page.reload();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(t.student.home.unavailableHeading);
      await expect(page.getByText(w.emptyHeading)).toHaveCount(0);
    } finally {
      await admin((client) => client.query("GRANT EXECUTE ON FUNCTION app.student_workspace() TO ductus_app"));
    }
  } finally {
    if (parked.length > 0) {
      await admin((client) => client.query("UPDATE institution.course_member SET member_to = NULL WHERE id = ANY($1::uuid[])", [parked]));
    }
  }
});

test("D-183: the full page in both themes at 1440 and 400 px, without a sideways scroll", async ({ page }) => {
  await signIn(page, "/zadaci/radovi");
  await seedWork({ acknowledged: false });
  await seedWork({ acknowledged: true });
  await page.reload();
  await expect(page.getByRole("list", { name: w.list })).toBeVisible();

  const shoot = async (name: string, width: number) => {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await test.info().attach(`radovi-${name}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  };

  await shoot("tamna", 1440);
  await shoot("tamna", 400);
  await page.getByRole("button", { name: t.shell.theme }).click();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "light");
  await shoot("svijetla", 400);
  await shoot("svijetla", 1440);
});
