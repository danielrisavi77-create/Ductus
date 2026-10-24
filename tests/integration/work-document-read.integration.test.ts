import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";
import { readWorkDocument } from "@/server/evidence/work-document-read";

// #711 step B1 (attack plan items A2, A3, A4, A6, A7, A8, A10, A20): the
// document /rad?zadatak=<id> writes into, read under the web role's RLS
// against the compose stack the Local stack CI job migrates. Loopback only;
// one random login and random synthetic rows, removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The work-document read test runs only against a loopback database (DATABASE_URL).");
}
const suffix = randomBytes(5).toString("hex");
const login = `it_work_doc_${suffix}`;
const password = randomBytes(24).toString("hex");
const [home, other] = [randomUUID(), randomUUID()];
const people = { teacher: randomUUID(), student: randomUUID(), classmate: randomUUID(), leaver: randomUUID() };
// The teacher of the other institution's course: no session, never a reader here.
const foreignTeacher = randomUUID();
const tokens = Object.fromEntries(Object.keys(people).map((name) => [name, randomBytes(32).toString("base64url")])) as
  Record<keyof typeof people, string>;
const [course, otherCourse, foreignCourse] = [randomUUID(), randomUUID(), randomUUID()];
const a = { open: randomUUID(), second: randomUUID(), unacknowledged: randomUUID(), tomorrow: randomUUID(),
  otherCourse: randomUUID(), foreign: randomUUID() };

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let ready = false;

const read = (who: keyof typeof people, assignment: string) => readWorkDocument(tokens[who], assignment, withActor);
const open = (who: keyof typeof people, assignment: string) => withActor(tokens[who], async (tx) =>
  (await tx.query<{ outcome: string; document_id: string }>(
    "SELECT outcome, document_id FROM app.open_student_work($1)", [assignment])).rows[0]!);
const evidenceRows = async () => (await admin.query<{ n: number }>(
  `SELECT (SELECT count(*) FROM evidence.project WHERE institution_id = $1)
        + (SELECT count(*) FROM evidence.document WHERE institution_id = $1)
        + (SELECT count(*) FROM evidence.package WHERE institution_id = $1) AS n`, [home])).rows[0]!.n;

async function insertFixture(client: pg.PoolClient) {
  for (const [id, slug] of [[home, `it-wd-${suffix}`], [other, `it-wd-other-${suffix}`]]) {
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [id, slug]);
  }
  for (const [name, id] of Object.entries(people)) {
    await client.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`, [id, home, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`]);
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`, [tokens[name as keyof typeof people], id, home]);
  }
  await client.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, $3, 'sub-foreign', $4)`, [foreignTeacher, other, `https://issuer-${suffix}.test`, `foreign@${suffix}.example`]);
  await client.query(
    "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())",
    [home, people.teacher]);
  const creatorOf = (institution: string) => (institution === home ? people.teacher : foreignTeacher);
  for (const [id, institution] of [[course, home], [otherCourse, home], [foreignCourse, other]]) {
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`, [id, institution, `Izmišljeni ${id}`, creatorOf(institution)]);
  }
  for (const [user, role] of [[people.teacher, "teacher"], [people.student, "student"], [people.classmate, "student"],
    [people.leaver, "student"]]) {
    await client.query("INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
      [course, home, user, role]);
  }
  const assignments: [string, string, string, string][] = [
    [a.open, course, home, "now() - interval '1 day'"], [a.second, course, home, "now() - interval '1 day'"],
    [a.unacknowledged, course, home, "now() - interval '1 day'"], [a.tomorrow, course, home, "now() + interval '1 day'"],
    [a.otherCourse, otherCourse, home, "now() - interval '1 day'"], [a.foreign, foreignCourse, other, "now() - interval '1 day'"],
  ];
  for (const [id, courseId, institution, opens] of assignments) {
    await client.query("INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [id, courseId, institution, creatorOf(institution)]);
    await client.query(
      `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at, due_at,
         ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmišljeni zadatak', 'Izmišljene upute.', 'essay', ${opens}, now() + interval '30 days',
         'partially_allowed', ARRAY[]::text[], 'basic', false, $2)`, [id, creatorOf(institution)]);
  }
  const acknowledged: [string, string][] = [[a.open, people.student], [a.second, people.student], [a.tomorrow, people.student],
    [a.open, people.classmate], [a.open, people.leaver]];
  for (const [assignment, student] of acknowledged) {
    await client.query("INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignment, student, home]);
  }
  await client.query("INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'eu-central-1')", [randomUUID(), home]);
}

async function removeFixture() {
  await admin.query("BEGIN");
  try {
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of ["evidence.package", "evidence.document_checkpoint", "evidence.document_revision", "evidence.document",
      "evidence.project", "evidence.domain", "institution.notice_acknowledgment", "institution.assignment_version"]) {
      const column = table.endsWith("assignment_version") ? "assignment_id IN (SELECT id FROM institution.assignment WHERE institution_id = ANY($1))"
        : "institution_id = ANY($1)";
      await admin.query(`DELETE FROM ${table} WHERE ${column}`, [[home, other]]);
    }
    for (const table of ["institution.assignment", "institution.course_member", "institution.course", "institution.institution_role",
      "identity.session", "identity.user_account", "identity.institution"]) {
      await admin.query(`DELETE FROM ${table} WHERE ${table === "identity.institution" ? "id" : "institution_id"} = ANY($1)`, [[home, other]]);
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password]);
  await admin.query(ddl.rows[0]!.ddl);
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await insertFixture(client);
    await client.query("COMMIT");
    ready = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  appPool = new pg.Pool({ connectionString: url.href, max: 2 });
  withActor = createWithActor(appPool);
});

afterAll(async () => {
  await appPool?.end();
  try {
    if (ready) await removeFixture();
  } finally {
    const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
    await admin.query(drop.rows[0]!.ddl);
    await admin.end();
  }
});

describe("document of an assignment for the session, on the database (#711 B1)", () => {
  it("reads without writing, then names exactly the work open_student_work made (A10)", async () => {
    expect(await read("student", a.open)).toEqual({ kind: "notOpened" });
    expect(await read("teacher", a.open)).toEqual({ kind: "none" });
    expect(await evidenceRows()).toBe(0);

    const opened = await open("student", a.open);
    expect(opened.outcome).toBe("opened");
    expect(await read("student", a.open)).toEqual({ kind: "document", documentId: opened.document_id });
  });

  it("gives each assignment its own document (A8) and a classmate never the student's (A20)", async () => {
    const first = await read("student", a.open);
    const second = await open("student", a.second);
    expect(await read("student", a.second)).toEqual({ kind: "document", documentId: second.document_id });
    expect(first).toMatchObject({ kind: "document" });
    expect(second.document_id).not.toBe((first as { documentId: string }).documentId);
    expect(await read("classmate", a.open)).toEqual({ kind: "notOpened" });
  });

  it("names no document before acknowledgment or opening (A3, A4)", async () => {
    expect(await read("student", a.unacknowledged)).toEqual({ kind: "notAccepting" });
    expect(await read("student", a.tomorrow)).toEqual({ kind: "notAccepting" });
  });

  it("answers the same none for another course, another institution and no assignment (A2), and to the teacher (A7)", async () => {
    const answers = await Promise.all([a.otherCourse, a.foreign, randomUUID()].map((id) => read("student", id)));
    expect(answers).toEqual([{ kind: "none" }, { kind: "none" }, { kind: "none" }]);
    expect(await read("teacher", a.open)).toEqual({ kind: "none" });
  });

  it("stops naming the work once the membership is closed (A6)", async () => {
    const opened = await open("leaver", a.open);
    expect(await read("leaver", a.open)).toEqual({ kind: "document", documentId: opened.document_id });
    await admin.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2",
      [course, people.leaver]);
    expect(await read("leaver", a.open)).toEqual({ kind: "none" });
  });
});
