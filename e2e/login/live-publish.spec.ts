import { expect, test, type Page, type Request } from "@playwright/test";
import pg from "pg";

import { createWithActor } from "../../src/server/db/with-actor";
import { messagesHr as t } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { appCookie, logoutDialogOf, SESSION_COOKIE, signIn } from "./support";

// B-LIVE step 4 (DAN-216, contract #476 6275905316): the signed-in student's
// tab publishes the last state of the work with PUT /api/live/<id>
// (BACKEND 4.12 t. 7 and 8). It stops before the sign-out fence, starts again
// on "Ostani", and a student without a confirmed notice publishes nothing.
// Course, assignment and text are invented; the demo document is the one
// comments.spec.ts keeps, written through the admin login of the compose
// database, as no route creates it yet.

const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ?? "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const STUDENT = "demo-student@demo.ductus.test";
const LIVE = `/api/live/${LOCAL_DEMO_DOCUMENT_ID}`;
const TOKEN = "33333333-3333-4333-8333-333333333333";

const editorOf = (page: Page) => page.getByRole("textbox", { name: t.workspace.documentLabel });
const isPut = (request: Request) => request.method() === "PUT" && new URL(request.url()).pathname === LIVE;

/** Every PUT to the live route with the time it left. */
function recordPuts(page: Page): { at: number; body: string | null }[] {
  const puts: { at: number; body: string | null }[] = [];
  page.on("request", (request) => {
    if (isPut(request)) puts.push({ at: Date.now(), body: request.postData() });
  });
  return puts;
}

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const opened: { course: string | null } = { course: null };

/**
 * The demo student is a member of the course of the /rad document's
 * assignment and has confirmed its notice, so the route accepts the
 * publication. The document is made once (as comments.spec.ts makes it).
 */
async function enrolAndConfirm(token: string): Promise<void> {
  const assignment = await admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [student] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!student) throw new Error("the demo student must have signed in");
    const { rows: [existing] } = await client.query<{ course: string; assignment: string; principal: string }>(
      `SELECT a.course_id AS course, a.id AS assignment, d.principal_id AS principal FROM evidence.document d
         JOIN evidence.project p ON p.id = d.project_id JOIN institution.assignment a ON a.id = p.assignment_id
        WHERE d.id = $1`, [LOCAL_DEMO_DOCUMENT_ID]);
    if (existing && existing.principal !== student.id) throw new Error("the demo document belongs to someone else");
    let course = existing?.course;
    let assignmentId = existing?.assignment;
    if (!course || !assignmentId) {
      const suffix = Date.now().toString(36);
      const { rows: [created] } = await client.query<{ id: string }>(
        `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
         VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [student.institution, `Izmišljeni kolegij ${suffix}`, student.id]);
      course = created!.id;
      const { rows: [made] } = await client.query<{ id: string }>(
        `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
         VALUES ($1, $2, 1, $3) RETURNING id`, [course, student.institution, student.id]);
      assignmentId = made!.id;
      await client.query(
        `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
           due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Izmišljeni zadatak', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
           'prohibited', '{}', 'basic', false, $2)`, [assignmentId, student.id]);
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [`e2e-live-${suffix}`, student.institution, assignmentId, student.id]);
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
         VALUES ($1, $2, $3, $4, repeat('0', 64))`, [LOCAL_DEMO_DOCUMENT_ID, student.institution, `e2e-live-${suffix}`, student.id]);
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
         VALUES ($1, $2, 0, $3, repeat('0', 64))`, [LOCAL_DEMO_DOCUMENT_ID, student.institution, student.id]);
    }
    await client.query(
      `INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')
       ON CONFLICT (course_id, user_id) WHERE member_to IS NULL DO NOTHING`, [course, student.institution, student.id]);
    await client.query("COMMIT");
    opened.course = course;
    const { rows: [version] } = await client.query<{ v: number }>(
      "SELECT current_version AS v FROM institution.assignment WHERE id = $1", [assignmentId]);
    return { id: assignmentId, version: version!.v };
  });
  // The student confirms the notice under their own session, as the notice screen does.
  const pool = new pg.Pool({ connectionString: APP_DATABASE_URL, max: 1 });
  try {
    await createWithActor(pool)(token, (tx) =>
      tx.query("SELECT institution.acknowledge_notice($1, $2)", [assignment.id, assignment.version]));
  } finally {
    await pool.end();
  }
}

test.afterEach(async () => {
  if (opened.course === null) return;
  await admin(async (client) => {
    await client.query("DELETE FROM collaboration.live_state WHERE document_id = $1", [LOCAL_DEMO_DOCUMENT_ID]);
    await client.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [opened.course]);
  });
  opened.course = null;
});

/** The live state as its owner reads it, through the same GET the teacher uses (rule 5). */
async function readLive(page: Page): Promise<{ status: number; body: string }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    return { status: response.status, body: response.status === 200 ? await response.text() : "" };
  }, LIVE);
}

test("a student without a confirmed notice publishes once, gets 404 and publishes nothing more", async ({ page }) => {
  const puts = recordPuts(page);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await editorOf(page).click();
  await page.keyboard.type("Izmišljena rečenica.");
  await expect.poll(() => puts.length).toBe(1);
  await page.keyboard.type(" Još jedna.");
  await page.waitForTimeout(3000);
  expect(puts).toHaveLength(1);
});

test("the signed-in student's text reaches the live route as the exact document, one request at a time", async ({ page, context }) => {
  await signIn(page, "/rad");
  await enrolAndConfirm((await appCookie(context, SESSION_COOKIE))!.value);
  await page.reload();
  const puts = recordPuts(page);
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  await editorOf(page).click();
  for (const word of ["Gradske ", "knjižnice ", "su ", "mjesto ", "susreta."]) {
    await page.keyboard.type(word);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await readLive(page)).body, { timeout: 10_000 })
    .toContain("Gradske knjižnice su mjesto susreta.");
  // The route holds exactly the bytes of the last PUT: the whole JCS document.
  const live = await readLive(page);
  expect(live.status).toBe(200);
  expect(live.body).toBe(puts.at(-1)!.body);
  expect(JSON.parse(live.body)).toMatchObject({ schemaVersion: 1 });
  // At least a second between the starts of two requests (4.12 t. 7).
  for (let i = 1; i < puts.length; i += 1) expect(puts[i]!.at - puts[i - 1]!.at).toBeGreaterThanOrEqual(950);
});

test("publishing stops at Odjava, starts again on Ostani, and nothing goes out after the sign-out", async ({ page }) => {
  // The route's answers are the test's here: this test is about when requests leave.
  await page.route(`**${LIVE}`, (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ outcome: "accepted", token: TOKEN }) })
    : route.fallback());
  const puts = recordPuts(page);
  await signIn(page, "/rad");
  await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  const dialog = logoutDialogOf(page);

  for (let round = 0; round < 3; round += 1) {
    await editorOf(page).click();
    await page.keyboard.type(` krug ${round}`);
    const before = puts.length;
    await expect.poll(() => puts.length).toBeGreaterThan(before);

    await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
    await expect(dialog).toBeVisible();
    const stoppedAt = Date.now();
    await page.waitForTimeout(2500);
    expect(puts.filter((p) => p.at > stoppedAt)).toEqual([]);
    await dialog.getByRole("button", { name: t.auth.logoutStay }).click();
    await expect(editorOf(page)).toHaveAttribute("contenteditable", "true");
  }

  await editorOf(page).click();
  await page.keyboard.type(" zadnje");
  await page.getByRole("button", { name: t.auth.logout, exact: true }).click();
  const fencedAt = Date.now();
  await dialog.getByRole("button", { name: t.auth.logoutConfirm }).click();
  await page.waitForURL("http://localhost:3000/");
  await page.waitForTimeout(2500);
  expect(puts.filter((p) => p.at > fencedAt)).toEqual([]);
});
