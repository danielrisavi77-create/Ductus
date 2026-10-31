import type { Page } from "@playwright/test";
import pg from "pg";

import { EVIDENCE_PROFILE_ID } from "../../src/domain/forensics/evidence-profile";
import { LOCAL_DEMO_DOCUMENT_ID } from "../../src/lib/journal/local-scope";
import { localAdminUrl } from "./local-db-url";

type Owner = { institution: string; student: string };

/**
 * The demo document of a seeded project in the shape open_student_work gives
 * a new work (db/migrations/20261019150000_evidence_open_work.sql): revision 0
 * is the editor's empty document with its hash and checkpoint, and the work
 * has a package in the institution's one evidence domain, so the evidence
 * routes open and commit it like any other work (3d-2c2, #476 c.6393716541).
 * Call it inside the caller's transaction: the document and its revision 0
 * refer to each other, and the check waits for the commit.
 */
export async function insertDemoDocument(client: pg.Client, owner: Owner, projectId: string): Promise<void> {
  await client.query(
    `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
     VALUES ($1, $2, $3, $4, 0,
             encode(sha256(convert_to(evidence.revision_zero_document(), 'UTF8')), 'hex'))`,
    [LOCAL_DEMO_DOCUMENT_ID, owner.institution, projectId, owner.student]);
  await client.query(
    `INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
     SELECT id, institution_id, 0, principal_id, current_content_hash FROM evidence.document WHERE id = $1`,
    [LOCAL_DEMO_DOCUMENT_ID]);
  await client.query(
    `INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body)
     VALUES ($1, $2, 0, evidence.revision_zero_document())`, [LOCAL_DEMO_DOCUMENT_ID, owner.institution]);
  await ensureDemoPackage(client);
}

/**
 * The package of the demo document, made once, when the institution has
 * exactly one evidence domain (`pnpm demo:prepare` registers it; CI does it
 * before the login E2E). Without one the work stays not configured, as
 * open_student_work answers then. A document from before revision 0 had its
 * shape (hash 0…0, no checkpoint) can take no commit, and its revisions never
 * change, so the run stops and says how to get a fresh one.
 */
export async function ensureDemoPackage(client: pg.Client): Promise<void> {
  const { rows: [document] } = await client.query<{ zero: boolean }>(
    `SELECT d.current_content_hash = repeat('0', 64) AS zero FROM evidence.document d WHERE d.id = $1`,
    [LOCAL_DEMO_DOCUMENT_ID]);
  if (document?.zero) {
    throw new Error("the local database holds the demo document from before revision 0; start the local stack from an empty volume (docker compose down -v, then pnpm demo:up)");
  }
  // Same profile and payload limit (D-96) as open_student_work.
  await client.query(
    `INSERT INTO evidence.package (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
                                   evidence_profile_id, max_payload_bytes)
     SELECT gen_random_uuid()::text, d.institution_id, (array_agg(m.id))[1], d.id, d.project_id, d.principal_id, $2, 2097152
       FROM evidence.document d JOIN evidence.domain m ON m.institution_id = d.institution_id
      WHERE d.id = $1 AND NOT EXISTS (SELECT 1 FROM evidence.package k WHERE k.document_id = d.id)
      GROUP BY d.institution_id, d.id, d.project_id, d.principal_id
     HAVING count(*) = 1`, [LOCAL_DEMO_DOCUMENT_ID, EVIDENCE_PROFILE_ID]);
}

// Shared by comments.spec.ts, demo-flow.spec.ts (F-9) and teacher-live.spec.ts
// (DAN-86 step 2c): the invented course, assignment and evidence document behind
// the demo student's /rad document and the demo teacher who teaches it, written
// through the admin login of the compose database as no route creates them yet
// (K-3a #313, F-3 drain), and the same POST the comment panel will send.
// Revisions and assignment versions are immutable, so the document and its
// course stay; cleanUp() removes the comments and closes the memberships and the
// teacher role seed() opened, so no other spec can read it.
export const ORIGIN = "http://localhost:3000";
export const TEACHER = "demo-teacher@demo.ductus.test";
export const STUDENT = "demo-student@demo.ductus.test";

export async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl() });
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
export async function seed(): Promise<void> {
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
      await insertDemoDocument(client, ids, `e2e-f9-${suffix}`);
    } else {
      await ensureDemoPackage(client);
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
export async function cleanUp(): Promise<void> {
  await admin(async (client) => {
    await removeComments(client);
    await client.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND member_to IS NULL", [seeded.course]);
    await client.query("UPDATE institution.institution_role SET revoked_at = now() WHERE id = $1", [seeded.role]);
  });
  seeded.course = null;
  seeded.role = null;
}

export const post = (page: Page, action: string, data: object) =>
  page.request.post(`/api/comments/${action}`, { headers: { origin: ORIGIN }, data });
