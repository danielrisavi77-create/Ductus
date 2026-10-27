import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";
import { readAssignmentStudentNames } from "@/server/evidence/assignment-names";
import { readCourseStudents } from "@/server/institution/course-students";

// DAN-344 R-2 (#923, contract c.6434766713 points 2 and 3): both readers over
// withActor and a real ductus_app login against the compose stack, so the
// statements the readers send are the ones the functions answer. Rows are
// written by the operator here; pgTAP (090) covers every refusal. Every
// person, institution, course and name is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(ADMIN_URL).hostname)) {
  throw new Error("The roster test runs only against a loopback database (DATABASE_URL).");
}
const suffix = randomBytes(4).toString("hex");
const LOGIN = `it_rosters_${suffix}`;
const password = randomBytes(24).toString("hex");
const newToken = () => randomBytes(32).toString("base64url");

const faculty = randomUUID();
const people = {
  admin: { id: randomUUID(), token: newToken() },
  teacher: { id: randomUUID(), token: newToken() },
  named: { id: randomUUID(), token: newToken() },
  unnamed: { id: randomUUID(), token: newToken() },
};
const userIds = Object.values(people).map((person) => person.id);
const course = randomUUID();
const assignment = randomUUID();

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
let app: pg.Pool | undefined;
let withActor: WithActor;

const accessRows = async () =>
  Number((await admin.query("SELECT count(*) FROM audit.access_log WHERE institution_id = $1", [faculty])).rows[0].count);

beforeAll(async () => {
  await admin.query(
    (await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
      [LOGIN, password],
    )).rows[0].ddl,
  );
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `it-rosters-${suffix}`]);
  for (const [name, person] of Object.entries(people)) {
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [person.id, faculty, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}-${suffix}@it-fak.example`],
    );
    await admin.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [person.token, person.id, faculty],
    );
  }
  await admin.query(
    `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
     VALUES ($1, $2, 'admin', NULL, now()), ($1, $3, 'teacher', $2, now())`,
    [faculty, people.admin.id, people.teacher.id],
  );
  await admin.query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, 'Izmišljeni kolegij', '2026/2027', 'partially_allowed', $3)`,
    [course, faculty, people.teacher.id],
  );
  await admin.query(
    `INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
     VALUES ($1, $2, $3, 'teacher'), ($1, $2, $4, 'student'), ($1, $2, $5, 'student')`,
    [course, faculty, people.teacher.id, people.named.id, people.unnamed.id],
  );
  await admin.query(
    `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
     VALUES ($1, $2, $3, 1, $4)`,
    [assignment, course, faculty, people.teacher.id],
  );
  await admin.query(
    `INSERT INTO institution.assignment_version (
       assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
       evidence_profile, import_allowed, created_by)
     VALUES ($1, 1, 'Esej', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
             'partially_allowed', '{proofreading}', 'basic', false, $2)`,
    [assignment, people.teacher.id],
  );
  await admin.query(
    "INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name) VALUES ($1, $2, 'Iskra', 'Izmišljenić')",
    [people.named.id, faculty],
  );
  const url = new URL(ADMIN_URL);
  url.username = LOGIN;
  url.password = password;
  app = new pg.Pool({ connectionString: url.href, max: 2 });
  withActor = createWithActor(app);
});

afterAll(async () => {
  await app?.end();
  // The assignment version is immutable and the access log append-only, for
  // the operator too: only this clean-up steps around the triggers, on its
  // own connection and for this run's rows.
  const cleaner = new pg.Client({ connectionString: ADMIN_URL });
  await cleaner.connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    await cleaner.query("DELETE FROM audit.access_log WHERE institution_id = $1", [faculty]);
    await cleaner.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [assignment]);
    await cleaner.query("DELETE FROM institution.assignment WHERE id = $1", [assignment]);
    await cleaner.query("DELETE FROM institution.course_member WHERE course_id = $1", [course]);
    await cleaner.query("DELETE FROM institution.course WHERE id = $1", [course]);
    await cleaner.query("DELETE FROM institution.institution_role WHERE institution_id = $1", [faculty]);
    await cleaner.query("DELETE FROM identity.person_name WHERE user_id = ANY ($1)", [userIds]);
    await cleaner.query("DELETE FROM identity.session WHERE user_id = ANY ($1)", [userIds]);
    await cleaner.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [userIds]);
    await cleaner.query("DELETE FROM identity.institution WHERE id = $1", [faculty]);
    await cleaner.query("COMMIT");
  } finally {
    await cleaner.end();
  }
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  await admin.end();
});

const byId = (a: { studentId: string }, b: { studentId: string }) => (a.studentId < b.studentId ? -1 : 1);

describe("R-2 rosters over the real functions", () => {
  it("the teacher reads both lists with each name beside its own student, and nothing is logged", async () => {
    const before = await accessRows();
    const expected = [
      { studentId: people.named.id, givenName: "Iskra", familyName: "Izmišljenić" },
      { studentId: people.unnamed.id, givenName: null, familyName: null },
    ].sort(byId);
    expect(await readCourseStudents(people.teacher.token, withActor, course)).toEqual({ kind: "ok", students: expected });
    expect(await readAssignmentStudentNames(people.teacher.token, withActor, assignment)).toEqual({ kind: "ok", students: expected });
    expect(await accessRows()).toBe(before);
  });

  it("a student and the administrator read the same empty lists as a course that does not exist", async () => {
    for (const token of [people.named.token, people.admin.token]) {
      expect(await readCourseStudents(token, withActor, course)).toEqual({ kind: "ok", students: [] });
      expect(await readAssignmentStudentNames(token, withActor, assignment)).toEqual({ kind: "ok", students: [] });
    }
    expect(await readCourseStudents(people.teacher.token, withActor, randomUUID())).toEqual({ kind: "ok", students: [] });
  });

  it("a session the database does not know is unauthorized", async () => {
    expect(await readCourseStudents(newToken(), withActor, course)).toEqual({ kind: "unauthorized" });
    expect(await readAssignmentStudentNames(newToken(), withActor, assignment)).toEqual({ kind: "unauthorized" });
  });
});
