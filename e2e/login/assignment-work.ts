import { expect, type Page } from "@playwright/test";
import pg from "pg";

import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { createWithActor } from "../../src/server/db/with-actor";
import { appCookie, SESSION_COOKIE } from "./support";

// #711 step E (decision B): the specs that reach a work through the API use
// the student's own document of an assignment, the one the open route makes
// (`app.open_student_work`), never the fixed `local-demo-document`. The
// course, assignment, teacher role and memberships are invented and written
// through the admin login of the compose database; the student confirms the
// notice under her own session and the real route opens the work.

const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ?? "postgres://ductus_app_local:ductus-app-local-only@127.0.0.1:54329/ductus";
const ORIGIN = "http://localhost:3000";
const TEACHER = "demo-teacher@demo.ductus.test";
const STUDENT = "demo-student@demo.ductus.test";

export interface AssignmentWork {
  assignmentId: string;
  documentId: string;
}

/** The seed writes as the database owner, so it never runs against a database off this machine. */
async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  if (!["127.0.0.1", "localhost"].includes(new URL(ADMIN_DATABASE_URL).hostname)) {
    throw new Error("the e2e seed runs only against a local database");
  }
  const client = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** What openAssignmentWork() opened that a later spec must not inherit. */
const opened: { course: string | null; role: string | null; document: string | null } =
  { course: null, role: null, document: null };

/**
 * The demo teacher teaches a new invented course, the demo student is its
 * student and has confirmed the notice of its one assignment, and her work on
 * it is opened by `POST /api/evidence/open` from her own page. Both demo
 * accounts must have signed in; `student` is the student's signed-in page.
 */
export async function openAssignmentWork(student: Page): Promise<AssignmentWork> {
  const { assignmentId, studentId } = await admin(async (client) => {
    await client.query("BEGIN");
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
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [ids.institution, `Izmišljeni kolegij E ${suffix}`, ids.teacher]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, ids.institution, ids.teacher]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak E', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
         'prohibited', '{}', 'basic', false, $2)`, [assignment!.id, ids.teacher]);
    await client.query(
      `INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
       VALUES ($1, $2, $3, 'teacher'), ($1, $2, $4, 'student')`, [course!.id, ids.institution, ids.teacher, ids.student]);
    await client.query("COMMIT");
    opened.course = course!.id;
    opened.role = role?.id ?? null;
    return { assignmentId: assignment!.id, studentId: ids.student };
  });

  // The student confirms the notice under her own session, as the notice screen does.
  const token = (await appCookie(student.context(), SESSION_COOKIE))?.value;
  if (!token) throw new Error("the student page must be signed in");
  const pool = new pg.Pool({ connectionString: APP_DATABASE_URL, max: 1 });
  try {
    await createWithActor(pool)(token, (tx) =>
      tx.query("SELECT institution.acknowledge_notice($1, $2)", [assignmentId, 1]));
  } finally {
    await pool.end();
  }

  // The real open route makes the work, as Predaja and /rad?zadatak= do.
  const response = await student.request.post("/api/evidence/open", {
    headers: { origin: ORIGIN, "ductus-protocol": DUCTUS_PROTOCOL_VERSION }, data: { assignmentId, start: true },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { status?: unknown; documentId?: unknown };
  expect(body.status).toBe("opened");
  const documentId = body.documentId;
  if (typeof documentId !== "string") throw new Error("the open route named no document");
  opened.document = documentId;
  expect(documentId).not.toBe(LOCAL_DEMO_DOCUMENT_ID);

  // Exactly one work and one document for (student, assignment), and it is this one.
  const documents = await admin(async (client) => (await client.query<{ id: string }>(
    `SELECT d.id FROM evidence.project p JOIN evidence.document d ON d.project_id = p.id
      WHERE p.assignment_id = $1 AND p.principal_id = $2`, [assignmentId, studentId])).rows.map((row) => row.id));
  expect(documents).toEqual([documentId]);
  return { assignmentId, documentId };
}

/** Leaves no comment, live text, membership or teacher role behind for the other specs. */
export async function cleanUpAssignmentWork(): Promise<void> {
  const { course, role, document } = opened;
  opened.course = opened.role = opened.document = null;
  if (course === null && document === null) return;
  await admin(async (client) => {
    if (document !== null) {
      await client.query(
        "DELETE FROM collaboration.comment WHERE thread_id IN (SELECT id FROM collaboration.comment_thread WHERE document_id = $1)",
        [document]);
      await client.query("DELETE FROM collaboration.comment_thread WHERE document_id = $1", [document]);
      await client.query("DELETE FROM collaboration.live_state WHERE document_id = $1", [document]);
    }
    await client.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [course]);
    await client.query("UPDATE institution.institution_role SET revoked_at = now() WHERE id = $1", [role]);
  });
}
