import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { handleRevisionRequest, type RevisionAction } from "@/server/collaboration/revision-requests";
import { createWithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-314 step 2f (contract on #1091, c.6696530499; plan of attack #1506):
// the route handler over the real createWithActor and the real RPCs, end to
// end. A foreign and a missing request give the same 403; a stale counter
// gives 409 conflict with the current row_seq; two concurrent transitions with
// the same counter over two connections give one 200 applied and one 409
// conflict and write once (C2 on the wire). Every person, course, text and
// hash is invented; random ids of one random institution, removed afterwards.
// Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The revision request route test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 4, application_name: `it_revision_route_${suffix}` });
const withActor = createWithActor(app);
const ORIGIN = "http://localhost:3000";

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const names = ["vesna", "ana", "dora", "boris"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;
const documents = { ana: `doc-ana-${suffix}`, dora: `doc-dora-${suffix}`, boris: `doc-boris-${suffix}` } as const;
const TEXT = `{"nodes":[{"children":[{"text":"Izmisljeni tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");
const RANGE_HASH = createHash("sha256").update(`raspon ${suffix}`, "utf8").digest("hex");
const ANCHOR = { endHint: 12, nodeId: "0f0e0d0c-0b0a-4000-8000-000000000001", prefix: "", quote: "prvi odlomak", startHint: 0, suffix: " teksta" };

type Json = Record<string, unknown>;
async function call(action: RevisionAction, who: Name, input: Json) {
  const request = new Request(`${ORIGIN}/api/revision-requests/${action}`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: canonicalizeJcs(input),
  });
  const res = await handleRevisionRequest(action, request, { withActor, expectedOrigin: ORIGIN, sessionToken: people[who].token });
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { status: res.status, json: await res.json() as Json };
}
const create = (document: string) => call("create", "vesna", {
  anchor: ANCHOR, documentId: document, instruction: "Dodaj izvor za ovu tvrdnju.", requestedRevision: 1,
});
const respond = (who: Name, requestId: string, expectedSeq: number) => call("respond", who, {
  expectedSeq, explanation: "Dodao sam izvor.", kind: "done", requestId, responseRevision: 1,
});
const withdraw = (requestId: string, expectedSeq: number) => call("withdraw", "vesna", { expectedSeq, requestId });

async function stored(requestId: string) {
  const result = await admin.query<{ state: string; row_seq: string; responses: string }>(
    `SELECT r.state, r.row_seq::text AS row_seq,
            (SELECT count(*) FROM collaboration.revision_response s WHERE s.request_id = r.id) AS responses
       FROM collaboration.revision_request r WHERE r.id = $1`, [requestId]);
  const row = result.rows[0];
  return { state: row.state, rowSeq: Number(row.row_seq), responses: Number(row.responses) };
}

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-revision-route-${suffix}`]);
    for (const name of names) {
      const { id, token } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`, [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`]);
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`, [token, id, institutionId]);
    }
    await client.query("INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())",
      [institutionId, people.vesna.id]);
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`, [courseId, institutionId, `Izmisljeni kolegij ${suffix}`, people.vesna.id]);
    for (const name of names) await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
      [courseId, institutionId, people[name].id, name === "vesna" ? "teacher" : "student"]);
    await client.query(
      "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [assignmentId, courseId, institutionId, people.vesna.id]);
    await client.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmisljeni zadatak', 'Sinteticki zadatak.', 'essay', now() - interval '1 day', now() + interval '1 day',
               'partially_allowed', ARRAY[]::text[], 'extended', false, $2)`, [assignmentId, people.vesna.id]);
    for (const [student, document] of Object.entries(documents) as [Name, string][]) {
      const { id } = people[student];
      await client.query("INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
        [assignmentId, id, institutionId]);
      await client.query("INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [`project-${document}`, institutionId, assignmentId, id]);
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 1, $5)`, [document, institutionId, `project-${document}`, id, HASH]);
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, institutionId, id, "a".repeat(64), HASH]);
      await client.query("INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES ($1, $2, 1, $3)",
        [document, institutionId, TEXT]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  try {
    await app.end();
  } finally {
    await cleanUp();
  }
});

async function cleanUp() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Disposable synthetic rows only; the append-only triggers stay active in normal operation.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["collaboration.revision_response", "collaboration.revision_request_version", "collaboration.revision_request",
      "audit.access_log", "evidence.document_checkpoint", "evidence.document_revision", "evidence.document", "evidence.project",
      "institution.notice_acknowledgment"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    await client.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [assignmentId]);
    for (const table of ["institution.assignment", "institution.course_member", "institution.course", "institution.institution_role",
      "identity.session", "identity.user_account"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    await client.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await admin.end();
  }
}

describe("revision request route over the real RPCs", () => {
  it("create, respond, reopen, respond, accept and list end to end", async () => {
    const created = await create(documents.ana);
    expect(created.status).toBe(200);
    expect(Object.keys(created.json).sort()).toEqual(["request_id", "row_seq", "state", "version"]);
    expect(created.json).toMatchObject({ state: "open", version: 1 });
    const requestId = created.json.request_id as string;
    expect(typeof created.json.row_seq).toBe("number");

    const responded = await respond("ana", requestId, created.json.row_seq as number);
    expect(responded).toMatchObject({ status: 200, json: { outcome: "applied", state: "responded", version: 1 } });

    const reopened = await call("reopen", "vesna", {
      expectedSeq: responded.json.row_seq, instruction: "Izvor jos nedostaje u drugom odlomku.", requestId, requestedRevision: 1,
    });
    expect(reopened).toMatchObject({ status: 200, json: { outcome: "applied", state: "reopened", version: 2 } });

    const again = await respond("ana", requestId, reopened.json.row_seq as number);
    expect(again).toMatchObject({ status: 200, json: { outcome: "applied", state: "responded", version: 2 } });

    const accepted = await call("accept", "vesna", {
      acceptedRevision: 1, expectedSeq: again.json.row_seq, rangeHash: RANGE_HASH, requestId,
    });
    expect(accepted).toMatchObject({ status: 200, json: { outcome: "applied", state: "accepted", version: 2 } });

    // H4: both sides read the same columns; only the *_is_own values differ.
    const teacher = await call("list", "vesna", { documentId: documents.ana });
    const student = await call("list", "ana", { documentId: documents.ana });
    expect(teacher.status).toBe(200);
    expect(student.status).toBe(200);
    const rows = (json: Json) => (json.requests as Json[]).filter((row) => row.request_id === requestId);
    expect(rows(teacher.json).length).toBeGreaterThan(0);
    expect(rows(teacher.json).map((row) => Object.keys(row).sort())).toEqual(rows(student.json).map((row) => Object.keys(row).sort()));
    // The anchor comes back only in the row of version 1.
    expect(rows(teacher.json).map((row) => [row.version, row.anchor])).toEqual([[1, ANCHOR], [2, null]]);
    const latest = rows(teacher.json).find((row) => row.version === 2);
    expect(latest).toMatchObject({
      request_state: "accepted", request_row_seq: accepted.json.row_seq, closed_as: "accepted", accepted_revision: 1,
      accepted_range_hash: RANGE_HASH, response_kind: "done",
    });
    expect(typeof latest?.opened_window).toBe("string");
  });

  it("a foreign and a missing request give the same 403, and a stale counter 409 with the current row_seq", async () => {
    const created = await create(documents.ana);
    const requestId = created.json.request_id as string;
    const seq = created.json.row_seq as number;

    const foreign = await respond("boris", requestId, seq);
    const missing = await respond("ana", randomUUID(), seq);
    expect(foreign).toEqual({ status: 403, json: { error: "forbidden" } });
    expect(missing).toEqual(foreign);

    const first = await respond("ana", requestId, seq);
    expect(first.status).toBe(200);
    const stale = await respond("ana", requestId, seq);
    expect(stale).toEqual({
      status: 409, json: { outcome: "conflict", row_seq: first.json.row_seq, version: 1, state: "responded" },
    });
    const notAllowed = await respond("ana", requestId, first.json.row_seq as number);
    expect(notAllowed).toEqual({ status: 409, json: { error: "not_allowed" } });
    expect((await stored(requestId)).responses).toBe(1);
  });

  it("a revision above the document's current revision is 422 for create, respond, reopen and accept, and writes nothing", async () => {
    // Every document is at revision 1; 2 is one above it (#1091 c.6696580072, migration 20261106220000).
    const count = async () => Number((await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM collaboration.revision_request WHERE document_id = $1", [documents.boris])).rows[0].n);
    const before = await count();
    const refusedCreate = await call("create", "vesna", {
      anchor: ANCHOR, documentId: documents.boris, instruction: "Dodaj izvor za ovu tvrdnju.", requestedRevision: 2,
    });
    expect(refusedCreate).toEqual({ status: 422, json: { error: "invalid_input" } });
    expect(await count()).toBe(before);

    const created = await create(documents.boris);
    const requestId = created.json.request_id as string;
    const seq = created.json.row_seq as number;
    const refusedRespond = await call("respond", "boris", {
      expectedSeq: seq, explanation: "Dodao sam izvor.", kind: "done", requestId, responseRevision: 2,
    });
    expect(refusedRespond).toEqual({ status: 422, json: { error: "invalid_input" } });
    const refusedReopen = await call("reopen", "vesna", {
      expectedSeq: seq, instruction: "Izvor jos nedostaje.", requestId, requestedRevision: 2,
    });
    expect(refusedReopen).toEqual({ status: 422, json: { error: "invalid_input" } });
    expect(await stored(requestId)).toEqual({ state: "open", rowSeq: seq, responses: 0 });

    const responded = await respond("boris", requestId, seq);
    expect(responded.status).toBe(200);
    const refusedAccept = await call("accept", "vesna", {
      acceptedRevision: 2, expectedSeq: responded.json.row_seq, rangeHash: RANGE_HASH, requestId,
    });
    expect(refusedAccept).toEqual({ status: 422, json: { error: "invalid_input" } });
    expect(await stored(requestId)).toEqual({ state: "responded", rowSeq: responded.json.row_seq, responses: 1 });
  });

  it("withdraws an open request", async () => {
    const created = await create(documents.boris);
    const withdrawn = await withdraw(created.json.request_id as string, created.json.row_seq as number);
    expect(withdrawn).toMatchObject({ status: 200, json: { outcome: "applied", state: "withdrawn", version: 1 } });
  });

  it("two concurrent responds with the same counter: one applied, one conflict, one write", async () => {
    const created = await create(documents.dora);
    const requestId = created.json.request_id as string;
    const seq = created.json.row_seq as number;
    const results = await Promise.all([respond("dora", requestId, seq), respond("dora", requestId, seq)]);
    const applied = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);
    expect(applied).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(applied[0].json).toMatchObject({ outcome: "applied", state: "responded" });
    expect(conflicts[0].json).toEqual({ outcome: "conflict", row_seq: applied[0].json.row_seq, version: 1, state: "responded" });
    expect(await stored(requestId)).toEqual({ state: "responded", rowSeq: applied[0].json.row_seq, responses: 1 });
  });

  it("two concurrent withdraws with the same counter: one applied, one conflict", async () => {
    const created = await create(documents.boris);
    const requestId = created.json.request_id as string;
    const seq = created.json.row_seq as number;
    const results = await Promise.all([withdraw(requestId, seq), withdraw(requestId, seq)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const applied = results.find((r) => r.status === 200)!;
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.json).toEqual({ outcome: "conflict", row_seq: applied.json.row_seq, version: 1, state: "withdrawn" });
    expect(await stored(requestId)).toMatchObject({ state: "withdrawn", rowSeq: applied.json.row_seq });
  });
});
