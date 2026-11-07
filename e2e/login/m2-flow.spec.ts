import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { localAdminUrl } from "./local-db-url";
import { SESSION_COOKIE, appCookie, fillCodeDeadline, localInputAt, signIn } from "./support";

// DAN-526 (M2.E2E): the whole M2 path on the fake provider (D-09), in the
// invented "Demo fakultet B" so no other login spec's roles or courses move
// (workers: 1). The operator appoints "Ustanova B: nastavnica" administrator
// (DAN-525, on an invented request), she confirms "Ustanova B: asistent" as a
// teacher on /ustanova/korisnici, he creates a course and an assignment, and
// "Ustanova B: student" enrolls with the code and confirms the notice. The
// test takes the teacher role and the administrator back at the end, so the
// next run (and teacher-roles-page.spec.ts) meets the same clean stack.
const USERS = "/ustanova/korisnici";
const TEACHER_PAGE = "/nastavnik/zadatak/novi";
const REQUEST = "Zahtjev e2e M2/2026";
const TEACHER_NAME = "Tin Žagar";
const STUDENT_ID = "demo-b-student@b.demo.ductus.test";
// create_course returns the earlier course for the same teacher, year and name, so
// a local rerun on the same stack would land in a course that already has an assignment.
const COURSE_NAME = `Izmišljeni kolegij B, gradski parkovi ${Date.now() % 1_000_000}`;
const ASSIGNMENT_TITLE = "Izmišljeni zadatak o gradskim parkovima";

async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** The person behind the page's session cookie. */
async function userOf(page: Page): Promise<string> {
  const token = (await appCookie(page.context(), SESSION_COOKIE))?.value;
  expect(token).toBeDefined();
  const { rows } = await withAdmin((client) => client.query<{ user_id: string }>(
    "SELECT user_id FROM identity.session WHERE token_hash = $1",
    [createHash("sha256").update(token!, "utf8").digest()],
  ));
  expect(rows).toHaveLength(1);
  return rows[0]!.user_id;
}

/** Active (confirmed, unrevoked) roles of `userId`. */
async function activeRoles(userId: string): Promise<string[]> {
  const { rows } = await withAdmin((client) => client.query<{ role: string }>(
    `SELECT role FROM institution.institution_role
      WHERE user_id = $1 AND confirmed_at IS NOT NULL AND revoked_at IS NULL ORDER BY role`, [userId]));
  return rows.map((row) => row.role);
}

async function operator(userId: string, procedure: "appoint" | "revoke"): Promise<void> {
  await withAdmin((client) => client.query(`SELECT institution.${procedure}_institution_admin($1, $2)`, [userId, REQUEST]));
}

async function expectNotFound(page: Page): Promise<void> {
  const response = await page.goto(USERS);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: t.errorPage.notFoundTitle })).toBeVisible();
  await expect(page.getByRole("heading", { name: t.teacherRoles.title })).toHaveCount(0);
}

async function expectTeacherDenied(page: Page): Promise<void> {
  await page.goto(TEACHER_PAGE);
  await expect(page.getByRole("heading", { level: 1, name: t.access.deniedTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: t.teacher.course.submit })).toHaveCount(0);
}

/** "Potvrdi ulogu" or "Opozovi ulogu" on the row of the asistent, then the same in its dialog. */
async function roleAction(admin: Page, teacherId: string, action: "confirm" | "revoke"): Promise<void> {
  const button = action === "confirm" ? t.teacherRoles.confirmAction : t.teacherRoles.revokeAction;
  const title = action === "confirm" ? t.teacherRoles.confirmDialog.title : t.teacherRoles.revokeDialog.title;
  const path = `/api/institution/teachers/${teacherId}/${action === "confirm" ? "role-confirmation" : "role-revocation"}`;
  await admin.getByRole("listitem").filter({ hasText: TEACHER_NAME }).getByRole("button", { name: button }).click();
  const dialog = admin.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(TEACHER_NAME)).toBeVisible();
  const reply = admin.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === "POST");
  await dialog.getByRole("button", { name: button }).click();
  const answered = await reply;
  expect(answered.status()).toBe(200);
  expect(await answered.json()).toEqual(action === "confirm" ? { confirmed: true } : { revoked: true });
  const outcome = action === "confirm" ? t.teacherRoles.outcome.confirmed : t.teacherRoles.outcome.revoked;
  await expect(admin.getByRole("status").filter({ hasText: outcome })).toBeVisible();
}

test("M2: the administrator confirms the teacher, who publishes an assignment the student enrolls in and confirms", async ({ browser }) => {
  const teacher = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  // Filled by the steps; an object, so the finally block sees what they set.
  const ids = { admin: "", teacher: "", appointed: false };
  try {
    await test.step("the asistent signs in and is no teacher yet", async () => {
      await signIn(teacher, TEACHER_PAGE, "Ustanova B: asistent");
      ids.teacher = await userOf(teacher);
      expect(await activeRoles(ids.teacher)).toEqual([]);
      await expectTeacherDenied(teacher);
    });

    await test.step("the nastavnica is no administrator until the operator appoints her", async () => {
      await signIn(admin, USERS, "Ustanova B: nastavnica");
      ids.admin = await userOf(admin);
      expect(await activeRoles(ids.admin)).not.toContain("admin");
      await expectNotFound(admin);
      await operator(ids.admin, "appoint");
      ids.appointed = true;
      await admin.goto(USERS);
      await expect(admin.getByRole("heading", { level: 1, name: t.teacherRoles.title })).toBeVisible();
    });

    await test.step("the administrator confirms the asistent as a teacher", async () => {
      await roleAction(admin, ids.teacher, "confirm");
      const confirmed = admin.getByRole("listitem").filter({ hasText: TEACHER_NAME });
      await expect(confirmed.getByRole("button", { name: t.teacherRoles.revokeAction })).toBeVisible();
      await expect(confirmed.getByRole("button", { name: t.teacherRoles.confirmAction })).toHaveCount(0);
      expect(await activeRoles(ids.teacher)).toEqual(["teacher"]);
    });

    let code = "";
    let course = "";
    await test.step("the teacher creates a course and publishes an assignment", async () => {
      await teacher.goto(TEACHER_PAGE);
      await expect(teacher.getByRole("heading", { name: t.teacher.title })).toBeVisible();
      await teacher.getByLabel(t.teacher.course.name).fill(COURSE_NAME);
      await fillCodeDeadline(teacher);
      const reply = teacher.waitForResponse((response) =>
        /\/api\/institution\/courses\/[^/]+\/enrollment-code$/.test(new URL(response.url()).pathname)
        && response.request().method() === "POST");
      await teacher.getByRole("button", { name: t.teacher.course.submit }).click();
      const issued = await reply;
      expect(issued.status()).toBe(200);
      expect(issued.headers()["cache-control"]).toBe("no-store");
      ({ code } = await issued.json() as { code: string });
      expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
      course = new URL(issued.url()).pathname.split("/")[4]!;
      await expect(teacher.getByRole("status").filter({ hasText: t.teacher.course.created })).toBeVisible();
      await expect(teacher.locator("form[aria-labelledby=kolegij] code")).toHaveText(code);
      // The course is the asistent's own, in institution B.
      const { rows: [owner] } = await withAdmin((client) => client.query<{ slug: string; teachers: string }>(
        `SELECT i.slug, (SELECT count(*) FROM institution.course_member m
                          WHERE m.course_id = c.id AND m.user_id = $2 AND m.role = 'teacher' AND m.member_to IS NULL) AS teachers
           FROM institution.course c JOIN identity.institution i ON i.id = c.institution_id WHERE c.id = $1`,
        [course, ids.teacher]));
      expect(owner).toEqual({ slug: "demo-fakultet-b", teachers: "1" });

      await teacher.getByLabel(t.teacher.assignment.title).fill(ASSIGNMENT_TITLE);
      // Opened an hour ago, so the student can confirm its notice straight away.
      await teacher.getByLabel(t.teacher.assignment.opensAt).fill(await localInputAt(teacher, -3_600_000));
      await teacher.getByLabel(t.teacher.assignment.dueAt).fill(await localInputAt(teacher, 30 * 24 * 3_600_000));
      await teacher.getByLabel(t.teacher.assignment.instructions).fill("Napiši kratak izmišljeni rad o gradskim parkovima.");
      await expect(teacher.getByText(t.teacher.tools.source).first()).toBeVisible();
      await expect(teacher.getByText(t.teacher.assignment.studentsNotified)).toBeVisible();
      await teacher.getByRole("button", { name: t.teacher.assignment.publish }).click();
      await expect(teacher.getByRole("status").filter({ hasText: t.teacher.assignment.publishedNotice })).toBeVisible();
    });

    await test.step("the student enrolls with the code and confirms the notice", async () => {
      await signIn(student, "/upis", "Ustanova B: student");
      const submit = student.getByRole("button", { name: t.student.enroll.submit });
      // A fill before hydration sets only the DOM value (as in demo-flow.spec.ts): fill until the form has it.
      await expect(async () => {
        await student.getByLabel(t.student.enroll.label).fill(code.toLowerCase());
        await expect(submit).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 30_000 });
      const reply = student.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/institution/enrollments" && response.request().method() === "POST");
      await submit.click();
      const enrolled = await reply;
      expect(enrolled.status()).toBe(200);
      expect(enrolled.request().postDataJSON()).toEqual({ code: code.replaceAll("-", "") });
      expect(await enrolled.json()).toEqual({ courseId: course });

      await student.waitForURL(/\/zadatak\/[0-9a-f-]{36}$/);
      const assignment = new URL(student.url()).pathname.split("/").pop()!;
      const { rows: [current] } = await withAdmin((client) => client.query<{ version: number }>(
        "SELECT current_version AS version FROM institution.assignment WHERE id = $1 AND course_id = $2",
        [assignment, course]));
      expect(current).toBeDefined();
      await expect(student.getByRole("heading", { level: 1, name: ASSIGNMENT_TITLE })).toBeVisible();
      await expect(student.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();

      const confirm = student.getByRole("button", { name: t.student.confirm });
      await expect(confirm).toBeDisabled();
      await student.getByRole("checkbox", { name: t.student.checkbox }).check();
      const acknowledged = student.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/institution/assignments/${assignment}/acknowledgment`);
      await confirm.click();
      const response = await acknowledged;
      expect(response.status()).toBe(200);
      const sent = response.request().postDataJSON() as { versionNo: number; fingerprint: string };
      expect(sent).toEqual({ versionNo: current!.version, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
      const { rows } = await withAdmin((client) => client.query<{ version_no: number; notice_fingerprint: string }>(
        `SELECT n.version_no, n.notice_fingerprint FROM institution.notice_acknowledgment n
           JOIN identity.user_account u ON u.id = n.student_id
          WHERE n.assignment_id = $1 AND u.hr_edu_person_unique_id = $2`, [assignment, STUDENT_ID]));
      expect(rows).toEqual([{ version_no: current!.version, notice_fingerprint: sent.fingerprint }]);
    });

    await test.step("the administrator revokes the role and the teacher page closes again", async () => {
      await admin.reload();
      await roleAction(admin, ids.teacher, "revoke");
      expect(await activeRoles(ids.teacher)).toEqual([]);
      await expectTeacherDenied(teacher);
    });

    await test.step("the operator revokes the administrator and the page is a 404 again", async () => {
      await operator(ids.admin, "revoke");
      ids.appointed = false;
      expect(await activeRoles(ids.admin)).not.toContain("admin");
      await expectNotFound(admin);
    });
  } finally {
    // A failed step must not leave a role behind for the next run: the
    // teacher role through the administrator's own route, then the operator revocation.
    if (ids.appointed && ids.teacher && (await activeRoles(ids.teacher)).includes("teacher")) {
      await admin.goto(USERS);
      await admin.evaluate((id) => fetch(`/api/institution/teachers/${id}/role-revocation`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }).then((r) => r.status), ids.teacher);
    }
    if (ids.appointed) await operator(ids.admin, "revoke");
    for (const page of [teacher, admin, student]) await page.context().close();
  }
});
