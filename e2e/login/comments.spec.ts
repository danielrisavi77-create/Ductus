import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createTextAnchor } from "../../src/domain/collaboration";
import type { NodeId } from "../../src/domain/document";
import { messagesHr } from "../../src/lib/i18n/messages.hr";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { signIn } from "./support";

// F-9 step 1 (DAN-86): a teacher's comment next to a paragraph reaches the
// student on /rad, through the B-10 route and RPCs. Until the teacher view
// of the saved work (B-11) exists, nothing on screen lets the teacher pick a
// paragraph, so the teacher's step is the same POST the page will send, made
// with the teacher's own session cookie; everything the student sees and
// does runs in the interface. The course, assignment and evidence document
// are invented and written through the admin login of the compose database,
// as no route creates them yet (K-3a #313, F-3 drain). Revisions and
// assignment versions are immutable, so the document and its course stay;
// afterwards the test removes the comments and closes the memberships and the
// teacher role it opened, so no other spec can read the document.

const t = messagesHr.comments;
const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const ORIGIN = "http://localhost:3000";
const TEACHER = "demo-teacher@demo.ductus.test";
const STUDENT = "demo-student@demo.ductus.test";
const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";
const QUOTE = "mjesto susreta";
const BODY = "Dodaj izvor za ovu tvrdnju. <img src=x onerror=alert(1)>";

async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Removes the comments of an earlier run. */
async function removeComments(client: pg.Client): Promise<void> {
  await client.query("DELETE FROM collaboration.comment WHERE thread_id IN (SELECT id FROM collaboration.comment_thread WHERE document_id = $1)", [LOCAL_DEMO_DOCUMENT_ID]);
  await client.query("DELETE FROM collaboration.comment_thread WHERE document_id = $1", [LOCAL_DEMO_DOCUMENT_ID]);
}

/** What seed() opened that a later spec must not inherit. */
const seeded: { course: string | null; role: string | null } = { course: null, role: null };

/**
 * The demo teacher teaches the course of the assignment the demo student's
 * /rad document belongs to. The document (revision 0) is made once and kept;
 * each run opens new memberships on its course.
 */
async function seed(): Promise<void> {
  await admin(async (client) => {
    await client.query("BEGIN");
    await removeComments(client);
    const { rows: [ids] } = await client.query<{ teacher: string; student: string; institution: string }>(
      `SELECT t.id AS teacher, s.id AS student, t.institution_id AS institution
         FROM identity.user_account t JOIN identity.user_account s ON s.institution_id = t.institution_id
        WHERE t.hr_edu_person_unique_id = $1 AND s.hr_edu_person_unique_id = $2`, [TEACHER, STUDENT]);
    if (!ids) throw new Error("both demo accounts must have signed in");
    const suffix = Date.now().toString(36);
    const { rows: [role] } = await client.query<{ id: string }>(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
       SELECT $1, $2, 'teacher', now() WHERE NOT EXISTS (SELECT 1 FROM institution.institution_role
         WHERE institution_id = $1 AND user_id = $2 AND role = 'teacher' AND revoked_at IS NULL) RETURNING id`,
      [ids.institution, ids.teacher]);
    const { rows: [existing] } = await client.query<{ course: string; principal: string }>(
      `SELECT a.course_id AS course, d.principal_id AS principal FROM evidence.document d
         JOIN evidence.project p ON p.id = d.project_id JOIN institution.assignment a ON a.id = p.assignment_id
        WHERE d.id = $1`, [LOCAL_DEMO_DOCUMENT_ID]);
    if (existing && existing.principal !== ids.student) throw new Error("the demo document belongs to someone else");
    let course = existing?.course;
    if (!course) {
      const { rows: [created] } = await client.query<{ id: string }>(
        `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
         VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [ids.institution, `Izmišljeni kolegij ${suffix}`, ids.teacher]);
      course = created!.id;
      const { rows: [assignment] } = await client.query<{ id: string }>(
        `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
         VALUES ($1, $2, 1, $3) RETURNING id`, [course, ids.institution, ids.teacher]);
      await client.query(
        `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
           due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Izmišljeni zadatak', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
           'prohibited', '{}', 'basic', false, $2)`, [assignment!.id, ids.teacher]);
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [`e2e-f9-${suffix}`, ids.institution, assignment!.id, ids.student]);
      // The document and its revision 0 refer to each other; the check waits for the commit.
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
         VALUES ($1, $2, $3, $4, repeat('0', 64))`, [LOCAL_DEMO_DOCUMENT_ID, ids.institution, `e2e-f9-${suffix}`, ids.student]);
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
         VALUES ($1, $2, 0, $3, repeat('0', 64))`, [LOCAL_DEMO_DOCUMENT_ID, ids.institution, ids.student]);
    }
    await client.query(
      `INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
       VALUES ($1, $2, $3, 'teacher'), ($1, $2, $4, 'student')
       ON CONFLICT (course_id, user_id) WHERE member_to IS NULL DO NOTHING`, [course, ids.institution, ids.teacher, ids.student]);
    await client.query("COMMIT");
    seeded.course = course;
    seeded.role = role?.id ?? null;
  });
}

/** Leaves no comment, membership or teacher role behind for the other specs. */
async function cleanUp(): Promise<void> {
  await admin(async (client) => {
    await removeComments(client);
    await client.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]);
    await client.query("UPDATE institution.institution_role SET revoked_at = now() WHERE id = $1", [seeded.role]);
  });
  seeded.course = null;
  seeded.role = null;
}

const post = (page: Page, action: string, data: object) =>
  page.request.post(`/api/comments/${action}`, { headers: { origin: ORIGIN }, data });

test.afterEach(cleanUp);

test("a teacher's comment next to a paragraph reaches the student, who answers", async ({ browser }) => {
  const teacher = await (await browser.newContext()).newPage();
  const student = await (await browser.newContext()).newPage();
  await signIn(teacher, "/", "Demo nastavnik");
  await signIn(student, "/rad");

  const editor = student.getByRole("textbox", { name: messagesHr.workspace.documentLabel });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await student.keyboard.type(TEXT);
  await expect(student.locator(".workspace__status .sync-chip")).toHaveAttribute("data-state", "LOCAL_DURABLE");
  const nodeId = (await editor.locator("p[data-node-id]").first().getAttribute("data-node-id")) as NodeId;

  await seed();
  // The student may not open a comment: an anchor would carry text the teacher has not seen.
  const start = TEXT.indexOf(QUOTE);
  const anchor = createTextAnchor({ nodeId, nodeText: TEXT, start, end: start + QUOTE.length });
  expect((await post(student, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: "Ne.", anchor })).status()).toBe(403);
  const created = await post(teacher, "create", { documentId: LOCAL_DEMO_DOCUMENT_ID, body: BODY, anchor });
  expect(created.status()).toBe(200);

  await student.getByRole("button", { name: t.refresh }).click();
  const card = student.getByRole("article", { name: t.number.replace("{n}", "1") });
  await expect(card).toContainText(t.teacher);
  await expect(card).toContainText(`„${QUOTE}”`);
  // Shown as text, never as markup (BACKEND 4.11, attack 10).
  await expect(card.getByText(BODY, { exact: true })).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await expect(editor.locator(".comment-mark")).toHaveText(QUOTE);
  await test.info().attach("f9-komentar-kod-studenta", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });

  await card.getByRole("button", { name: t.showInText }).click();
  expect(await student.evaluate(() => window.getSelection()?.toString())).toBe(QUOTE);

  // Text written before the quote moves the mark with it; the document keeps no trace of the comment.
  await editor.press("Control+Home");
  await student.keyboard.type("Uvod. ");
  await expect(editor.locator(".comment-mark")).toHaveText(QUOTE);
  await expect(editor.locator("p").first()).toHaveText(`Uvod. ${TEXT}`);

  await card.getByRole("textbox", { name: t.replyLabel }).fill("Hvala, dodat ću izvor.");
  await card.getByRole("button", { name: t.reply }).click();
  await expect(card).toContainText("Hvala, dodat ću izvor.");
  await expect(card).toContainText(t.own);
  await expect(card).toContainText(t.state.answered);
  await test.info().attach("f9-odgovor-studenta", { body: await student.screenshot({ fullPage: true }), contentType: "image/png" });

  // The teacher reads the same list through the same function (PRODUCT §5 rule 5).
  const listed = await (await post(teacher, "list", { documentId: LOCAL_DEMO_DOCUMENT_ID })).json();
  expect(listed.comments.map((c: { authorRole: string; isOwn: boolean; state: string }) => [c.authorRole, c.isOwn, c.state]))
    .toEqual([["teacher", true, "answered"], ["student", false, "answered"]]);
});
