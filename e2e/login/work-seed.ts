import { expect, type Page } from "@playwright/test";
import pg from "pg";

import { DUCTUS_PROTOCOL_VERSION } from "../../src/domain/evidence/commit-envelope";

// #711 F1: `/rad?zadatak=` writes into the student's own work of the
// assignment, made by the real open route (`open_student_work`), never into a
// fixed document id. These helpers seed an invented course and assignment
// through the admin login of the compose database (as assignment-notice.spec.ts
// does), open the work as the student, and read its document id back.

export const ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
export const ORIGIN = "http://localhost:3000";
export const STUDENT = "demo-student@demo.ductus.test";
export const TEACHER = "demo-teacher@demo.ductus.test";

/** The seed writes as the database owner, so it never runs against a database off this machine. */
function localAdminUrl(url: string): string {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("the e2e seed runs only against a local database");
  return url;
}

export async function admin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: localAdminUrl(ADMIN_DATABASE_URL) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export type WorkSeed = {
  /** Interval from now, as SQL reads it. */
  opens?: string;
  due?: string;
  /** The student's acknowledgment of version 1. */
  acknowledged?: boolean;
  /** Who joins the course as a student; null: nobody (a foreign assignment). */
  student?: string | null;
  /** The demo teacher teaches the course, with a confirmed teacher role. */
  teacher?: boolean;
};

const opened = { courses: [] as string[], roles: [] as string[] };

/** An invented course and assignment; returns the assignment id. */
export async function seedWork(seed: WorkSeed = {}): Promise<string> {
  const { opens = "-1 hour", due = "30 days", acknowledged = true, student = STUDENT, teacher = false } = seed;
  return admin(async (client) => {
    await client.query("BEGIN");
    const { rows: [owner] } = await client.query<{ id: string; institution: string }>(
      "SELECT id, institution_id AS institution FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [STUDENT]);
    if (!owner) throw new Error("the demo student must have signed in");
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { rows: [course] } = await client.query<{ id: string }>(
      `INSERT INTO institution.course (institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, '2026/2027', 'prohibited', $3) RETURNING id`, [owner.institution, `Izmišljeni kolegij F1 ${suffix}`, owner.id]);
    const { rows: [assignment] } = await client.query<{ id: string }>(
      `INSERT INTO institution.assignment (course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, 1, $3) RETURNING id`, [course!.id, owner.institution, owner.id]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
         due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, $2, 'Upute za izmišljeni zadatak.', 'essay', now() + $3::interval,
         now() + $4::interval, 'prohibited', '{}', 'basic', false, $5)`,
      [assignment!.id, `Izmišljeni zadatak F1 ${suffix}`, opens, due, owner.id]);
    if (student !== null) {
      const { rows: [who] } = await client.query<{ id: string }>(
        "SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [student]);
      if (!who) throw new Error(`${student} must have signed in`);
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
        [course!.id, owner.institution, who.id]);
      if (acknowledged) {
        await client.query(
          `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
           VALUES ($1, 1, $2, $3)`, [assignment!.id, who.id, owner.institution]);
      }
    }
    if (teacher) {
      const { rows: [who] } = await client.query<{ id: string }>(
        "SELECT id FROM identity.user_account WHERE hr_edu_person_unique_id = $1", [TEACHER]);
      if (!who) throw new Error("the demo teacher must have signed in");
      const { rows: [role] } = await client.query<{ id: string }>(
        `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
         SELECT $1, $2, 'teacher', now() WHERE NOT EXISTS (SELECT 1 FROM institution.institution_role
           WHERE institution_id = $1 AND user_id = $2 AND role = 'teacher' AND revoked_at IS NULL) RETURNING id`,
        [owner.institution, who.id]);
      if (role) opened.roles.push(role.id);
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'teacher')",
        [course!.id, owner.institution, who.id]);
    }
    await client.query("COMMIT");
    opened.courses.push(course!.id);
    return assignment!.id;
  });
}

/** Closes the memberships and revokes the teacher roles seedWork opened, so no later spec inherits them. */
export async function closeWork(): Promise<void> {
  const courses = opened.courses.splice(0);
  const roles = opened.roles.splice(0);
  if (courses.length === 0 && roles.length === 0) return;
  await admin(async (client) => {
    await client.query(
      "UPDATE institution.course_member SET member_to = now() WHERE course_id = ANY($1::uuid[]) AND member_to IS NULL", [courses]);
    await client.query(
      "UPDATE institution.institution_role SET revoked_at = now() WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL", [roles]);
  });
}

/** The document ids of (person, assignment), by the admin login, oldest first. */
export async function documentsOf(person: string, assignment: string): Promise<{ projects: number; documents: string[] }> {
  return admin(async (client) => {
    const { rows } = await client.query<{ project: string; document: string | null }>(
      `SELECT p.id AS project, d.id AS document FROM evidence.project p
         JOIN identity.user_account u ON u.id = p.principal_id
         LEFT JOIN evidence.document d ON d.project_id = p.id
        WHERE u.hr_edu_person_unique_id = $1 AND p.assignment_id = $2
        ORDER BY d.created_at, d.id`, [person, assignment]);
    return {
      projects: new Set(rows.map((r) => r.project)).size,
      documents: rows.flatMap((r) => (r.document ? [r.document] : [])),
    };
  });
}

/** The one document of the student's work; fails if there is none or more than one. */
export async function workDocument(assignment: string, person = STUDENT): Promise<string> {
  const { documents } = await documentsOf(person, assignment);
  expect(documents).toHaveLength(1);
  return documents[0]!;
}

/**
 * Opens the work through the same POST the page sends (`openWork`), with the
 * signed-in page's own cookie, for a test whose subject is not the opening.
 */
export async function openWorkOf(page: Page, assignment: string): Promise<string> {
  const response = await page.request.post("/api/evidence/open", {
    headers: { origin: ORIGIN, "content-type": "application/json", "ductus-protocol": DUCTUS_PROTOCOL_VERSION },
    data: { assignmentId: assignment, start: true },
  });
  expect(response.status()).toBe(200);
  const body = await response.json() as { status: string; documentId: string };
  expect(body.status).toBe("opened");
  return body.documentId;
}
