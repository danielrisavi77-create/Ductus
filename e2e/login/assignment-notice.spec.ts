import { expect, test } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-7: the screens without a notice, and (DAN-227, #476 row 1) the notice a
// student of the course reads before the first sentence, with the text of
// D-142 and D-143. No route creates a course for the demo student yet, so the
// invented course, assignment and membership are written through the admin
// login of the compose database, as in comments.spec.ts. Assignment versions
// are immutable, so they stay; the membership is closed afterwards.
const PATH = "/zadatak/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const STUDENT = "demo-student@demo.ductus.test";

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** An invented course and assignment the demo student is a student of. */
async function seedAssignment(): Promise<{ assignment: string; course: string }> {
  return admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [me] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!me) throw new Error("the demo student must have signed in");
    const suffix = Date.now().toString(36);
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [me.institution, `Izmišljeni kolegij S3 ${suffix}`, me.id]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, me.institution, me.id]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak S3', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
         'prohibited', '{}', 'basic', false, $2)`, [assignment!.id, me.id]);
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [course!.id, me.institution, me.id]);
    await client.query("COMMIT");
    return { assignment: assignment!.id, course: course!.id };
  });
}

test("anonymous visitor sees no notice and no confirmation", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: t.student.title })).toBeVisible();
  await expect(page.getByText(t.student.signedOut)).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test("signed-in student outside the course sees no notice", async ({ page }) => {
  await signIn(page, PATH, "Demo studentica");
  await expect(page.getByText(t.student.notFound)).toBeVisible();
  await expect(page.getByRole("button", { name: t.student.confirm })).toHaveCount(0);
});

test("a student of the course reads the live view and the mentor-only replay before the first sentence", async ({ page }) => {
  // The account exists once it has signed in; the notice is not there yet.
  await signIn(page, PATH, "Demo studentica");
  const seeded = await seedAssignment();
  try {
    await page.goto(`/zadatak/${seeded.assignment}`);
    await expect(page.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();
    for (const text of [t.student.recorded.live, t.student.notRecorded.inputs, t.student.teacher.state,
      t.student.teacher.replay, t.student.teacher.purpose]) {
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
    await expect(page.getByText("Pojedinačni unosi")).toHaveCount(0);
    await expect(page.getByText("Istu reprodukciju vidiš i ti")).toHaveCount(0);
    await test.info().attach("s3-obavijest-d142-d143", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await admin((client) => client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]));
  }
});
