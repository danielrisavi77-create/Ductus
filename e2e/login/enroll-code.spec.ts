import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { signIn } from "./support";

// F-7 and FE-D4 (#476 row 4): enrollment by code, then straight to the notice
// of the open assignment (PRODUCT §5 rule 6). The enrollment route is the #314
// proposal and does not exist yet, so the tests that need its answer fulfil
// it in the shape the proposal gives (`{courseId}`, 422, 401) and seed the
// invented course, assignment and membership through the admin login of the
// compose database, as assignment-notice.spec.ts does. What happens after the
// answer (the page that finds the open assignment under RLS, and the notice)
// is the real server. Next.js keeps an empty route announcer with
// role="alert" outside the form.
const e = t.student.enroll;
const CODE = "ab12-cd34-ef56-7890";
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const STUDENT = "demo-student@demo.ductus.test";

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const host = new URL(ADMIN_DATABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("the e2e seed runs only against a local database");
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** An invented course the demo student is a student of, with one open assignment or none. */
async function seedCourse(withAssignment: boolean): Promise<{ course: string; assignment: string | null }> {
  return admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [me] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!me) throw new Error("the demo student must have signed in");
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`,
      [me.institution, `Izmišljeni kolegij D4 ${Date.now().toString(36)}`, me.id]);
    let assignment: string | null = null;
    if (withAssignment) {
      const { rows: [a] } = await client.query<{ id: string }>(
        `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
         VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, me.institution, me.id]);
      assignment = a!.id;
      await client.query(
        `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
           due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Izmišljeni zadatak D4', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
           'prohibited', '{}', 'basic', false, $2)`, [assignment, me.id]);
    }
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [course!.id, me.institution, me.id]);
    await client.query("COMMIT");
    return { course: course!.id, assignment };
  });
}

const leave = (course: string) => admin((client) => client.query(
  "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [course]));

async function submit(page: Page, code: string) {
  await page.getByLabel(e.label).fill(code);
  await page.getByRole("button", { name: e.submit }).click();
}

test("anonymous visitor sees no enrollment form", async ({ page }) => {
  await page.goto("/upis");
  await expect(page.getByRole("heading", { name: e.heading })).toBeVisible();
  await expect(page.getByText(e.signedOut)).toBeVisible();
  await expect(page.getByLabel(e.label)).toHaveCount(0);
  // The server page reads the sign-in URL from a module without "use client".
  await expect(page.getByRole("link", { name: t.student.signIn }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fupis");
});

test("signed-in student gets no enrollment without the server", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });

  // Empty: nothing to send yet.
  await expect(page.getByRole("button", { name: e.submit })).toBeDisabled();
  // A native submit before hydration would put a named field in the URL.
  await expect(page.getByLabel(e.label)).not.toHaveAttribute("name", /.*/);
  await submit(page, "12-34");
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.malformed);
  expect(posts).toHaveLength(0);

  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unavailable);
  expect(posts).toEqual(["/api/institution/enrollments"]);
  await expect(page.getByText(e.opening)).toHaveCount(0);
  await expect(page).toHaveURL(/\/upis$/);
});

test("a session the server closed offers sign-in again", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  // Stands in for the #314 route answering a cookie whose session has ended.
  await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 401, body: "" }));
  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unauthorized);
  await expect(page.locator("form").getByRole("link", { name: t.student.signIn }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fupis");
});

test("a wrong or expired code and a lost network are told apart", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 422, body: "" }));
  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.refused);
  await expect(page.getByLabel(e.label)).toHaveAttribute("aria-invalid", "true");
  // The signed-in form with its error, which e2e/accessibility.spec.ts cannot reach without a session.
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);

  await page.unroute("**/api/institution/enrollments");
  await page.route("**/api/institution/enrollments", (route) => route.abort("internetdisconnected"));
  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.offline);
  await expect(page).toHaveURL(/\/upis$/);
});

test("an enrolled student goes straight to the notice of the open assignment", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  // The membership is already there: a repeated code gets the same reply (enroll_with_code).
  const seeded = await seedCourse(true);
  try {
    const bodies: string[] = [];
    await page.route("**/api/institution/enrollments", async (route) => {
      bodies.push(route.request().postData() ?? "");
      await route.fulfill({ status: 200, json: { courseId: seeded.course } });
    });
    await submit(page, CODE);
    // Case and hyphens do not matter: the code goes out upper case and joined.
    expect(bodies).toEqual([JSON.stringify({ code: "AB12CD34EF567890" })]);
    await page.waitForURL(`**/zadatak/${seeded.assignment}`);
    await expect(page.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
  } finally {
    await leave(seeded.course);
  }
});

test("a course with no open assignment says so", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  const seeded = await seedCourse(false);
  try {
    await page.route("**/api/institution/enrollments", (route) =>
      route.fulfill({ status: 200, json: { courseId: seeded.course } }));
    await submit(page, CODE);
    await page.waitForURL(`**/upis/kolegij/${seeded.course}`);
    await expect(page.getByRole("status").filter({ hasText: e.course.none })).toBeVisible();
    await expect(page.getByRole("link", { name: e.course.another })).toHaveAttribute("href", "/upis");
  } finally {
    await leave(seeded.course);
  }
});

test("a course the account is not a student of shows no assignment", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  await page.goto("/upis/kolegij/cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  await expect(page.getByRole("status").filter({ hasText: e.course.notFound })).toBeVisible();
  await expect(page).toHaveURL(/\/upis\/kolegij\//);
});
