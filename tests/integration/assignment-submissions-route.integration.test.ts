import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "../../app/api/teacher/assignments/[assignmentId]/submissions/route";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { createWithActor } from "@/server/db/with-actor";

// DAN-332 R1 (contract on #826, c.6420660650, N1-N13): the real GET route,
// session and database. Every person, course, work and hash is invented;
// random ids, removed afterwards.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2, application_name: `submissions-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://submissions.example";
const suffix = randomBytes(5).toString("hex");
const faculties = [randomUUID(), randomUUID()];
const names = ["vesna", "marko", "lea", "petra", "ana", "boris", "cvita", "ema"] as const;
type Name = typeof names[number];
const teachers: readonly Name[] = ["vesna", "marko", "lea", "petra"];
const people = Object.fromEntries(names.map((name) => [name, {
  id: randomUUID(), token: randomBytes(32).toString("base64url"), faculty: faculties[name === "petra" ? 1 : 0],
}])) as Record<Name, { id: string; token: string; faculty: string }>;
const [k1, k2, k3] = [randomUUID(), randomUUID(), randomUUID()];
const [z1, z2, z3] = [randomUUID(), randomUUID(), randomUUID()];
const expired = randomBytes(32).toString("base64url"), closed = randomBytes(32).toString("base64url");
const hash = (n: string) => n.repeat(64);
// [student, assignment, document]; cvita has no work.
const works = [["ana", z1, `doc-a1-${suffix}`], ["ana", z2, `doc-a2-${suffix}`], ["boris", z1, `doc-b1-${suffix}`], ["ema", z1, `doc-e1-${suffix}`]] as const;

const get = (session: string | null, assignment: string = z1, headers: Record<string, string> = {}) => GET(new NextRequest(
  `${ORIGIN}/api/teacher/assignments/${assignment}/submissions`,
  { method: "GET", headers: { ...(session === null ? {} : { cookie: `${SESSION_COOKIE_NAME}=${session}` }), ...headers } },
), { params: Promise.resolve({ assignmentId: assignment }) });
const list = async (session: string, assignment: string = z1) => {
  const response = await get(session, assignment);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { submissions: { studentId: string }[] }).submissions;
};
const count = async (table: string) => Number((await admin.query(
  `SELECT count(*) FROM ${table} WHERE institution_id = ANY($1)`, [faculties],
)).rows[0].count);
const minuteOf = async (student: Name, assignment: string) => ((await admin.query(
  "SELECT date_trunc('minute', requested_at, 'UTC') AS m FROM evidence.submission WHERE principal_id = $1 AND assignment_id = $2",
  [people[student].id, assignment],
)).rows[0].m as Date).toISOString();

async function submit(student: Name, document: string, record: boolean) {
  await withActor(people[student].token, async (tx) => {
    const request = (await tx.query<{ outcome: string; submission_request_id: string }>(
      "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [document],
    )).rows[0];
    expect(request.outcome).toBe("requested");
    if (!record) return;
    const recorded = (await tx.query<{ outcome: string }>(
      "SELECT outcome FROM app.record_submission($1, $2)", [request.submission_request_id, hash("d")],
    )).rows[0];
    expect(recorded.outcome).toBe("recorded");
  });
}

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    for (const [index, faculty] of faculties.entries()) {
      await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `submissions-${index}-${suffix}`]);
    }
    for (const name of names) {
      const { id, token, faculty } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [id, faculty, `${suffix}-${name}`, `${suffix}-${name}@submissions.example`],
      );
      await client.query(
        "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')",
        [token, id, faculty],
      );
      if (teachers.includes(name)) await client.query(
        "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())", [faculty, id],
      );
    }
    for (const [session, isClosed] of [[expired, false], [closed, true]] as const) await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours',
               now() + CASE WHEN $4 THEN interval '1 hour' ELSE interval '-1 hour' END,
               CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN 'logout' ELSE NULL END)`,
      [session, people.vesna.id, faculties[0], isClosed],
    );
    for (const [course, teacher] of [[k1, "vesna"], [k2, "marko"], [k3, "petra"]] as const) {
      await client.query(
        `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
         VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`, [course, people[teacher].faculty, `Izmisljeni kolegij ${suffix}`, people[teacher].id],
      );
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'teacher')",
        [course, people[teacher].faculty, people[teacher].id],
      );
    }
    // Lea teaches K1 no longer; the students take K1.
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role, member_to) VALUES ($1, $2, $3, 'teacher', now())",
      [k1, faculties[0], people.lea.id],
    );
    for (const name of ["ana", "boris", "cvita", "ema"] as const) await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')", [k1, faculties[0], people[name].id],
    );
    // Z1 is due tomorrow, Z2 was due an hour ago; Z3 is the other institution's.
    for (const [assignment, course, teacher, due] of [[z1, k1, "vesna", "1 day"], [z2, k1, "vesna", "-1 hour"], [z3, k3, "petra", "1 day"]] as const) {
      await client.query(
        "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
        [assignment, course, people[teacher].faculty, people[teacher].id],
      );
      await client.query(
        `INSERT INTO institution.assignment_version
           (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
            ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Izmisljeni zadatak', 'Sinteticki zadatak.', 'essay', now() - interval '1 day', now() + $2::interval,
                 'partially_allowed', ARRAY[]::text[], 'extended', false, $3)`, [assignment, due, people[teacher].id],
      );
    }
    for (const [student, assignment, document] of works) {
      const project = `project-${document}`;
      await client.query(
        "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
        [assignment, people[student].id, faculties[0]],
      );
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [project, faculties[0], assignment, people[student].id],
      );
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 1, $5)`, [document, faculties[0], project, people[student].id, hash("d")],
      );
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, faculties[0], people[student].id, hash("a"), hash("d")],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await submit("ana", works[0][2], true);
  await submit("ana", works[1][2], true);
  // Boris only requested: a request alone is not a submission.
  await submit("boris", works[2][2], false);
  await submit("ema", works[3][2], true);
  // Ema submitted and then left the course.
  await admin.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2", [k1, people.ema.id]);
});

afterAll(async () => {
  await app.end();
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Disposable synthetic rows only; the append-only triggers stay active in normal operation.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["evidence.submission", "evidence.submission_request", "evidence.document_revision", "evidence.document",
      "evidence.project", "institution.notice_acknowledgment"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [faculties]);
    }
    await client.query("DELETE FROM institution.assignment_version WHERE assignment_id = ANY($1)", [[z1, z2, z3]]);
    for (const table of ["institution.assignment", "institution.course_member", "institution.course", "institution.institution_role",
      "identity.session", "identity.user_account"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [faculties]);
    }
    await client.query("DELETE FROM identity.institution WHERE id = ANY($1)", [faculties]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await admin.end();
  }
});

describe("GET /api/teacher/assignments/[assignmentId]/submissions over the real database", () => {
  it("gives the assignment's teacher one row per open student, with the work and the submission state (N3, N6, N13)", async () => {
    const accessLog = await count("audit.access_log");
    const submissions = await count("evidence.submission");
    const expected = [
      { studentId: people.ana.id, documentId: works[0][2], submitted: true, revision: 1, requestedMinute: await minuteOf("ana", z1), afterDeadline: false },
      { studentId: people.boris.id, documentId: works[2][2], submitted: false, revision: null, requestedMinute: null, afterDeadline: null },
      { studentId: people.cvita.id, documentId: null, submitted: false, revision: null, requestedMinute: null, afterDeadline: null },
    ].sort((a, b) => (a.studentId < b.studentId ? -1 : 1));
    expect(await list(people.vesna.token)).toEqual(expected);
    // Ema submitted, then left: she is not on the list (#745 P2, owner #87 c.6420796310).
    expect((await list(people.vesna.token)).map((s) => s.studentId)).not.toContain(people.ema.id);
    // The same work the teacher's works list names.
    const linked = await withActor(people.vesna.token, async (tx) =>
      (await tx.query<{ student_id: string; document_id: string }>("SELECT student_id::text, document_id FROM app.assignment_works($1)", [z1])).rows);
    expect(Object.fromEntries(linked.map((w) => [w.student_id, w.document_id]))).toEqual({
      [people.ana.id]: works[0][2], [people.boris.id]: works[2][2],
    });
    // A late submission is marked from the exact time (N13); reading writes nothing (N12).
    expect(await list(people.vesna.token, z2)).toEqual(expect.arrayContaining([
      { studentId: people.ana.id, documentId: works[1][2], submitted: true, revision: 1, requestedMinute: await minuteOf("ana", z2), afterDeadline: true },
    ]));
    expect(await count("audit.access_log")).toBe(accessLog);
    expect(await count("evidence.submission")).toBe(submissions);
  });

  it("gives every other caller the same empty list (N1-N5, N7)", async () => {
    for (const name of ["marko", "lea", "ana", "boris", "cvita", "ema", "petra"] as const) {
      expect(await list(people[name].token)).toEqual([]);
    }
    expect(await list(people.vesna.token, z3)).toEqual([]);
    expect(await list(people.vesna.token, randomUUID())).toEqual([]);
    expect(await list(people.vesna.token, "nije-uuid")).toEqual([]);
    expect((await list(people.vesna.token, z1.toUpperCase())).map((s) => s.studentId)).toEqual((await list(people.vesna.token)).map((s) => s.studentId));
  });

  it("refuses a missing, malformed, expired, closed or unknown session with 401 (N8)", async () => {
    for (const session of [null, "kratko", expired, closed, randomBytes(32).toString("base64url")]) {
      const response = await get(session);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("refuses a cross-site read with 403 (N9)", async () => {
    const response = await get(people.vesna.token, z1, { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});
