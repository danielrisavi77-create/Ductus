import { createHash, randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "../../app/api/live/[documentId]/route";
import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { createWithActor } from "@/server/db/with-actor";

// DAN-332 PR 2 (contract on #826, c.6420660650, N14-N22): one submitted work,
// read only, through the real GET /api/live/[documentId], session and
// database. Every person, course, text and hash is invented; random ids,
// removed afterwards.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2, application_name: `submitted-read-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://submitted-read.example";
const suffix = randomBytes(5).toString("hex");
const faculties = [randomUUID(), randomUUID()];
const names = ["vesna", "marko", "petra", "ana", "boris", "dora"] as const;
type Name = typeof names[number];
const teachers: readonly Name[] = ["vesna", "marko", "petra"];
const people = Object.fromEntries(names.map((name) => [name, {
  id: randomUUID(), token: randomBytes(32).toString("base64url"), faculty: faculties[name === "petra" ? 1 : 0],
}])) as Record<Name, { id: string; token: string; faculty: string }>;
const [k1, k2, k3] = [randomUUID(), randomUUID(), randomUUID()];
const z1 = randomUUID();
const expired = randomBytes(32).toString("base64url");
// The submitted text: invented JCS bytes; revision 0 is a stand-in hash.
const SUBMITTED = `{"nodes":[{"children":[{"text":"Izmisljeni predani tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const HASH = sha256(SUBMITTED);
// Ana submits doc-a; Boris's work stays unsubmitted; Dora submits and then leaves the course.
const docA: string = `doc-a-${suffix}`, docB: string = `doc-b-${suffix}`, docD: string = `doc-d-${suffix}`;
const works = [["ana", docA, true], ["boris", docB, false], ["dora", docD, true]] as const;

const read = (session: string | null, document = docA, headers: Record<string, string> = { "ductus-protocol": DUCTUS_PROTOCOL_VERSION }) => GET(
  new NextRequest(`${ORIGIN}/api/live/${encodeURIComponent(document)}`, {
    method: "GET", headers: { ...(session === null ? {} : { cookie: `${SESSION_COOKIE_NAME}=${session}` }), ...headers },
  }),
  { params: Promise.resolve({ documentId: document }) },
);
const refusal = async (response: Response, status: number, error: string) => {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("ductus-live-state")).toBeNull();
  expect(await response.json()).toEqual({ error });
};
const submittedRead = async (session: string, document = docA) => {
  const response = await read(session, document);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("ductus-live-state")).toBe("submitted");
  expect(response.headers.get("etag")).toBe(`"${HASH}"`);
  return Buffer.from(await response.arrayBuffer());
};
const closeMembership = (course: string, name: Name) => admin.query(
  "UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2 AND member_to IS NULL", [course, people[name].id],
);

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    for (const [index, faculty] of faculties.entries()) {
      await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `submitted-read-${index}-${suffix}`]);
    }
    for (const name of names) {
      const { id, token, faculty } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [id, faculty, `${suffix}-${name}`, `${suffix}-${name}@submitted-read.example`],
      );
      await client.query(
        "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')",
        [token, id, faculty],
      );
      if (teachers.includes(name)) await client.query(
        "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())", [faculty, id],
      );
    }
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [expired, people.vesna.id, faculties[0]],
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
    for (const name of ["ana", "boris", "dora"] as const) await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')", [k1, faculties[0], people[name].id],
    );
    await client.query(
      "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [z1, k1, faculties[0], people.vesna.id],
    );
    await client.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmisljeni zadatak', 'Sinteticki zadatak.', 'essay', now() - interval '1 day', now() + interval '1 day',
               'partially_allowed', ARRAY[]::text[], 'extended', false, $2)`, [z1, people.vesna.id],
    );
    for (const [student, document] of works) {
      const { id } = people[student];
      await client.query(
        "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
        [z1, id, faculties[0]],
      );
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)", [`project-${document}`, faculties[0], z1, id],
      );
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 1, $5)`, [document, faculties[0], `project-${document}`, id, HASH],
      );
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, faculties[0], id, "a".repeat(64), HASH],
      );
      // The text of revision 1; the database computes its hash from these bytes.
      await client.query(
        "INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES ($1, $2, 1, $3)",
        [document, faculties[0], SUBMITTED],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  for (const [student, document, submit] of works) {
    if (!submit) continue;
    await withActor(people[student].token, async (tx) => {
      const request = (await tx.query<{ outcome: string; submission_request_id: string }>(
        "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [document],
      )).rows[0];
      expect(request.outcome).toBe("requested");
      const recorded = (await tx.query<{ outcome: string }>(
        "SELECT outcome FROM app.record_submission($1, $2)", [request.submission_request_id, HASH],
      )).rows[0];
      expect(recorded.outcome).toBe("recorded");
    });
  }
  // Dora submitted and then left the course.
  await closeMembership(k1, "dora");
});

afterAll(async () => {
  await app.end();
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Disposable synthetic rows only; the append-only triggers stay active in normal operation.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["audit.access_log", "evidence.submission", "evidence.submission_request", "evidence.document_checkpoint",
      "evidence.document_revision", "evidence.document", "evidence.project", "institution.notice_acknowledgment"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [faculties]);
    }
    await client.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [z1]);
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

describe("GET /api/live/[documentId] on a submitted work, over the real database", () => {
  it("gives the student and the assignment's teacher the same submitted bytes, marked submitted (N20)", async () => {
    const student = await submittedRead(people.ana.token);
    const teacher = await submittedRead(people.vesna.token);
    expect(student.equals(teacher)).toBe(true);
    expect(student.toString("utf8")).toBe(SUBMITTED);
    const again = await read(people.vesna.token, docA, { "ductus-protocol": DUCTUS_PROTOCOL_VERSION, "if-none-match": `"${HASH}"` });
    expect(again.status).toBe(304);
    expect(again.headers.get("ductus-live-state")).toBe("submitted");
  });

  it("never marks a work that is not submitted as submitted (N19)", async () => {
    for (const session of [people.boris.token, people.vesna.token]) {
      const response = await read(session, docB);
      expect([200, 204]).toContain(response.status);
      expect(response.headers.get("ductus-live-state")).toBeNull();
    }
  });

  it("refuses the teacher of another course and of another institution, and a classmate, with 404 (N17)", async () => {
    for (const name of ["marko", "petra", "boris"] as const) await refusal(await read(people[name].token), 404, "not_found");
  });

  it("answers a document that does not exist like a refused one (N18)", async () => {
    await refusal(await read(people.vesna.token, `doc-nema-${suffix}`), 404, "not_found");
  });

  it("refuses a missing, malformed, expired or unknown session with 401 (N16)", async () => {
    for (const session of [null, "kratko", expired, randomBytes(32).toString("base64url")]) await refusal(await read(session), 401, "unauthorized");
  });

  it("refuses a read without the protocol header, or a cross-site one, with 403 before the database (N21)", async () => {
    const accessLog = async () => Number((await admin.query("SELECT count(*) FROM audit.access_log WHERE institution_id = $1", [faculties[0]])).rows[0].count);
    const before = await accessLog();
    await refusal(await read(people.vesna.token, docA, {}), 403, "forbidden");
    await refusal(await read(people.vesna.token, docA, { "ductus-protocol": DUCTUS_PROTOCOL_VERSION, "sec-fetch-site": "cross-site" }), 403, "forbidden");
    expect(await accessLog()).toBe(before);
  });

  it("refuses the student who left; the teacher still reads that work (N14, N22: owner P1)", async () => {
    await refusal(await read(people.dora.token, docD), 404, "not_found");
    expect((await submittedRead(people.vesna.token, docD)).toString("utf8")).toBe(SUBMITTED);
  });

  it("refuses the teacher once her membership ended (N15)", async () => {
    await closeMembership(k1, "vesna");
    await refusal(await read(people.vesna.token), 404, "not_found");
  });
});
