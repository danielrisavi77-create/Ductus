import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";

import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE, sessionRow, signIn } from "./support";
import { localAdminUrl, localAppUrl } from "./local-db-url";

// F-7 and FE-D4 (#476 row 4): enrollment by code, then straight to the notice
// of the open assignment (PRODUCT §5 rule 6). The real path uses fake OIDC,
// a locally provisioned synthetic teacher, and the existing course/code RPCs.
// Next.js keeps an empty route announcer with role="alert" outside the form.
const e = t.student.enroll;
const CODE = "ab12-cd34-ef56-7890";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PROVISION_TEACHER = fileURLToPath(new URL("../../scripts/local/provision-teacher.mjs", import.meta.url));
const STUDENT = "demo-student@demo.ductus.test";

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Only the local operator confirms the invented teacher; product RPCs create the fixture. */
async function seedCourse(browser: Browser, withAssignment: boolean): Promise<{ course: string; code: string; assignment: string | null }> {
  const teacherPage = await browser.newPage({ baseURL: "http://localhost:3000" });
  const pool = new pg.Pool({ connectionString: localAppUrl() });
  try {
    await signIn(teacherPage, "/", "Demo nastavnik");
    const teacherToken = (await appCookie(teacherPage.context(), SESSION_COOKIE))?.value;
    expect(teacherToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const provision = spawnSync(process.execPath, [PROVISION_TEACHER], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    expect(provision.error).toBeUndefined();
    expect(provision.status).toBe(0);
    const withActor = createWithActor(pool);
    const course = (await withActor(teacherToken, async (tx) =>
      (await tx.query<{ id: string }>(
        "SELECT institution.create_course($1, '2026/2027', 'prohibited') AS id",
        [`Izmišljeni kolegij D4 ${randomUUID()}`],
      )).rows[0].id));
    const code = (await withActor(teacherToken, async (tx) =>
      (await tx.query<{ code: string }>(
        "SELECT institution.create_enrollment_code($1, now() + interval '1 day') AS code", [course],
      )).rows[0].code));
    const assignment = withAssignment ? (await withActor(teacherToken, async (tx) =>
      (await tx.query<{ id: string }>(
        `SELECT institution.create_assignment($1, 'Izmišljeni zadatak D4', 'Upute za izmišljeni zadatak.',
           'essay', now() - interval '1 minute', now() + interval '30 days',
           'prohibited', '{}'::text[], 'basic', false, NULL, NULL) AS id`, [course],
      )).rows[0].id)) : null;
    return { course, code, assignment };
  } finally {
    await pool.end();
    await teacherPage.close();
  }
}

const leave = (course: string) => admin((client) => client.query(
  "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [course]));

async function studentState(course: string, student: string) {
  return admin(async (client) => {
    const { rows: [row] } = await client.query<{ members: string; attempts: string }>(
      `SELECT (SELECT count(*) FROM institution.course_member WHERE course_id = $1 AND user_id = $2 AND member_to IS NULL) AS members,
              (SELECT count(*) FROM institution.enrollment_attempt WHERE user_id = $2) AS attempts`, [course, student]);
    return { members: Number(row.members), attempts: Number(row.attempts) };
  });
}

async function studentId() {
  return admin(async (client) => {
    const { rows: [student] } = await client.query<{ id: string }>(
      "SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    expect(student).toBeDefined();
    return student.id;
  });
}

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

test("a signed-in student gets the shell with the student items only (I3)", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  const nav = page.getByRole("navigation", { name: t.shell.workNav });
  await expect(nav.getByRole("link")).toHaveText([t.shell.nav.assignments, t.shell.nav.courses, t.shell.nav.workspace, t.shell.nav.enroll]);
  await expect(nav.getByRole("link", { name: t.shell.nav.enroll })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(t.shell.space.student)).toBeAttached();
  await expect(page.getByRole("button", { name: t.shell.signOut, includeHidden: true })).toBeAttached();
});

test("signed-in student rejects malformed input and reports a simulated server outage", async ({ page }) => {
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

  // This case tests only UI handling of an outage; real responses are covered below.
  await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unavailable);
  expect(posts).toEqual(["/api/institution/enrollments"]);
  await expect(page.getByText(e.opening)).toHaveCount(0);
  await expect(page).toHaveURL(/\/upis$/);
});

test("a session the server closed offers sign-in again", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  // Controlled UI-only 401; the exported POST integration covers a real expired session.
  await page.route("**/api/institution/enrollments", (route) => route.fulfill({ status: 401, body: "" }));
  await submit(page, CODE);
  await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.unauthorized);
  await expect(page.locator("form").getByRole("link", { name: t.student.signIn }))
    .toHaveAttribute("href", "/api/auth/login?returnTo=%2Fupis");
});

test("a wrong code and a lost network are told apart", async ({ page }) => {
  await signIn(page, "/upis", "Demo studentica");
  const student = await studentId();
  const before = await admin((client) => client.query<{ id: string }>(
    "SELECT id FROM institution.enrollment_attempt WHERE user_id = $1", [student]));
  let newAttempt = "";
  try {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/institution/enrollments") && r.request().method() === "POST");
    await submit(page, CODE);
    const refused = await response;
    expect(refused.status()).toBe(422);
    expect(refused.headers()["cache-control"]).toBe("no-store");
    await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.refused);
    await expect(page.getByLabel(e.label)).toHaveAttribute("aria-invalid", "true");
    const after = await admin((client) => client.query<{ id: string }>(
      "SELECT id FROM institution.enrollment_attempt WHERE user_id = $1", [student]));
    const oldIds = new Set(before.rows.map((row) => row.id));
    const added = after.rows.filter((row) => !oldIds.has(row.id));
    expect(added).toHaveLength(1); // The real 422 committed its attempt.
    newAttempt = added[0].id;
    // The signed-in form with its error, which e2e/accessibility.spec.ts cannot reach without a session.
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);

    await page.route("**/api/institution/enrollments", (route) => route.abort("internetdisconnected"));
    await submit(page, CODE);
    await expect(page.locator("form").getByRole("alert")).toHaveText(e.errors.offline);
    await expect(page).toHaveURL(/\/upis$/);
  } finally {
    if (newAttempt) await admin((client) => client.query("DELETE FROM institution.enrollment_attempt WHERE id = $1", [newAttempt]));
  }
});

test("the real enrollment POST takes a new student straight to the open notice and is idempotent", async ({ page, context, browser }) => {
  await signIn(page, "/upis", "Demo studentica");
  const cookie = (await appCookie(context, SESSION_COOKIE))?.value;
  expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await sessionRow(cookie!)).toMatchObject({ institution: "demo-fakultet", unique_id: STUDENT, closed_at: null });
  const student = await studentId();
  const settings = await admin((client) => client.query<{
    display_name: string; enrollment_attempt_limit: number; enrollment_attempt_window: string;
  }>(`SELECT s.display_name, s.enrollment_attempt_limit, s.enrollment_attempt_window::text
        FROM institution.institution_settings s JOIN identity.user_account u ON u.institution_id = s.institution_id
       WHERE u.id = $1`, [student]));
  expect(settings.rows).toEqual([{
    display_name: "Demo fakultet (test)", enrollment_attempt_limit: 5, enrollment_attempt_window: "00:15:00",
  }]); // From normal local:prepare seed, never inserted by this spec.
  const seeded = await seedCourse(browser, true);
  try {
    const before = await studentState(seeded.course, student);
    expect(before.members).toBe(0);
    const input = seeded.code.toLowerCase().replaceAll("-", " - ");
    const normalized = seeded.code.replaceAll("-", "");
    const firstResponse = page.waitForResponse((r) => r.url().endsWith("/api/institution/enrollments") && r.request().method() === "POST");
    await submit(page, input);
    const first = await firstResponse;
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    expect(first.request().postDataJSON()).toEqual({ code: normalized });
    expect(await first.json()).toEqual({ courseId: seeded.course });
    await page.waitForURL(`**/zadatak/${seeded.assignment}`);
    await expect(page.getByRole("heading", { name: t.student.teacherHeading })).toBeVisible();
    await expect(page.getByText(t.student.checkbox)).toBeVisible();
    expect(await studentState(seeded.course, student)).toEqual({ members: 1, attempts: before.attempts });

    await page.goto("/upis"); // Same browser cookie, second real POST.
    const secondResponse = page.waitForResponse((r) => r.url().endsWith("/api/institution/enrollments") && r.request().method() === "POST");
    await submit(page, seeded.code);
    const second = await secondResponse;
    expect(second.status()).toBe(200);
    expect(await second.json()).toEqual({ courseId: seeded.course });
    await page.waitForURL(`**/zadatak/${seeded.assignment}`);
    expect(await studentState(seeded.course, student)).toEqual({ members: 1, attempts: before.attempts });
  } finally {
    await leave(seeded.course);
  }
});

test("a course with no open assignment says so after real enrollment", async ({ page, browser }) => {
  await signIn(page, "/upis", "Demo studentica");
  const seeded = await seedCourse(browser, false);
  try {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/institution/enrollments") && r.request().method() === "POST");
    await submit(page, seeded.code);
    const enrolled = await response;
    expect(enrolled.status()).toBe(200);
    expect(await enrolled.json()).toEqual({ courseId: seeded.course });
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
