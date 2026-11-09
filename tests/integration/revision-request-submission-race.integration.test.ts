import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-314 step 2a (contract on #1091, c.6684460326; plan of attack #1506):
// pgTAP runs in one transaction and cannot race two calls. Here two real
// connections race a revision request against a submission in both orders,
// and two creates against each other. The create holds the document FOR
// SHARE and then asks whether a submission is recorded; request_submission
// holds it FOR UPDATE. Every person, course, text and hash is invented;
// random ids of one random institution, removed afterwards. Loopback only.
// Step 2b adds two transitions with the same expected counter: the second
// waits on the request row, then sees the new counter and writes nothing.
// M6.5-P02 (contract c.6752687836) adds the rereview: two at once, and one
// against the acceptance it follows. Boris's document is at revision 2.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The revision request race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_revision_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 4, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const names = ["vesna", "ana", "dora", "boris"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;
// Ana's work is submitted first, Dora's is requested first, Boris's gets two creates.
const documents = { ana: `doc-ana-${suffix}`, dora: `doc-dora-${suffix}`, boris: `doc-boris-${suffix}` } as const;
const TEXT = `{"nodes":[{"children":[{"text":"Izmisljeni tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");
const ANCHOR = { nodeId: "0f0e0d0c-0b0a-4000-8000-000000000001", quote: "prvi odlomak", prefix: "", suffix: " teksta", startHint: 0, endHint: 12 };

type Created = { request_id: string; row_seq: string; version: number; state: string };
const createSql = "SELECT request_id, row_seq, version, state FROM collaboration.create_revision_request($1, $2::jsonb, $3, $4)";
const create = (document: string) => async (tx: ActorTransaction) =>
  (await tx.query<Created>(createSql, [document, JSON.stringify(ANCHOR), "Dodaj izvor za ovu tvrdnju.", 1])).rows[0];
type Moved = { outcome: string; row_seq: string; version: number; state: string };
const respond = (id: string, seq: string) => async (tx: ActorTransaction) => (await tx.query<Moved>(
  "SELECT outcome, row_seq, version, state FROM collaboration.respond_revision_request($1, $2, 'done', 'Dodao sam izvor.', 1)",
  [id, seq])).rows[0];
const withdraw = (id: string, seq: string) => async (tx: ActorTransaction) => (await tx.query<Moved>(
  "SELECT outcome, row_seq, version, state FROM collaboration.withdraw_revision_request($1, $2)", [id, seq])).rows[0];
const submit = (document: string) => async (tx: ActorTransaction) => {
  const requested = (await tx.query<{ outcome: string; submission_request_id: string }>(
    "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [document])).rows[0];
  const recorded = (await tx.query<{ outcome: string }>(
    "SELECT outcome FROM app.record_submission($1, $2)", [requested.submission_request_id, HASH])).rows[0];
  return [requested.outcome, recorded.outcome];
};

/** Waits until a call matching `pattern` is in PostgreSQL and blocked by another transaction. */
async function waitForBlocked(pattern: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE $2
            AND a.wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`, [applicationName, `%${pattern}%`]);
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`The call ${pattern} did not reach PostgreSQL and wait on another transaction.`);
}

/** Runs `first` and keeps its transaction open until `release` is called. */
function hold<T>(token: string, first: (tx: ActorTransaction) => Promise<T>) {
  let started!: (value: T) => void;
  let failed!: (error: unknown) => void;
  let release!: () => void;
  const answered = new Promise<T>((resolve, reject) => { started = resolve; failed = reject; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const done = withActor(token, async (tx) => {
    const value = await first(tx);
    started(value);
    await held;
    return value;
  });
  void done.catch(failed);
  return { answered, release, done };
}

const settle = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ value, code: null as string | null }),
  (error: { code?: string }) => ({ value: null, code: error.code ?? "no code" }),
);
async function stored(document: string) {
  const result = await admin.query<{ requests: string; versions: string; row_seqs: string[] }>(
    `SELECT count(DISTINCT r.id) AS requests, count(v.version) AS versions, array_agg(DISTINCT r.row_seq::text) FILTER (WHERE r.id IS NOT NULL) AS row_seqs
       FROM collaboration.revision_request r
       LEFT JOIN collaboration.revision_request_version v ON v.request_id = r.id
      WHERE r.document_id = $1`, [document]);
  const row = result.rows[0];
  return { requests: Number(row.requests), versions: Number(row.versions), rowSeqs: row.row_seqs ?? [] };
}
// app.document_submitted reads the institution from the session, so the admin asks the tables.
const submitted = async (document: string) => (await admin.query<{ yes: boolean }>(
  `SELECT EXISTS (SELECT 1 FROM evidence.submission_request r
     JOIN evidence.submission s ON s.submission_request_id = r.id AND s.institution_id = r.institution_id
    WHERE r.document_id = $1) AS yes`, [document])).rows[0].yes;

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-revision-${suffix}`]);
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
         VALUES ($1, $2, $3, $4, $6, $5)`, [document, institutionId, `project-${document}`, id, HASH, student === "boris" ? 2 : 1]);
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, institutionId, id, "a".repeat(64), HASH]);
      if (student === "boris") await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 2, 1, $3, $4)`, [document, institutionId, id, HASH]);
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
      "audit.access_log", "evidence.submission", "evidence.submission_request", "evidence.document_checkpoint",
      "evidence.document_revision", "evidence.document", "evidence.project", "institution.notice_acknowledgment"]) {
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

describe("revision request against a submission, over two real connections", () => {
  it("submission first: the create waits on the document, then is forbidden and writes nothing", async () => {
    const submission = hold(people.ana.token, submit(documents.ana));
    let creating: ReturnType<typeof settle<Created>>;
    try {
      expect(await submission.answered).toEqual(["requested", "recorded"]);
      creating = settle(withActor(people.vesna.token, create(documents.ana)));
      await waitForBlocked("create_revision_request");
    } finally {
      submission.release();
    }
    await submission.done;
    // The create must see the commit it waited for, not its older snapshot.
    expect(await creating).toEqual({ value: null, code: "ZD403" });
    expect(await submitted(documents.ana)).toBe(true);
    expect(await stored(documents.ana)).toEqual({ requests: 0, versions: 0, rowSeqs: [] });
  });

  it("create first: the submission waits on the document, then the request stays and the submission follows", async () => {
    const creating = hold(people.vesna.token, create(documents.dora));
    let created: Created;
    let submission: ReturnType<typeof settle<string[]>>;
    try {
      created = await creating.answered;
      expect(created).toMatchObject({ state: "open", version: 1 });
      submission = settle(withActor(people.dora.token, submit(documents.dora)));
      await waitForBlocked("request_submission");
      expect(await submitted(documents.dora)).toBe(false);
    } finally {
      creating.release();
    }
    await creating.done;
    expect(await submission).toEqual({ value: ["requested", "recorded"], code: null });
    expect(await submitted(documents.dora)).toBe(true);
    expect(await stored(documents.dora)).toEqual({ requests: 1, versions: 1, rowSeqs: [created.row_seq] });
  });

  it("two creates at once do not wait on each other and get distinct row_seq values", async () => {
    const first = hold(people.vesna.token, create(documents.boris));
    let one: Created;
    let two: Created;
    try {
      one = await first.answered;
      // FOR SHARE does not block FOR SHARE: the second create finishes while the first is still open.
      two = await withActor(people.vesna.token, create(documents.boris));
    } finally {
      first.release();
    }
    await first.done;
    expect(one.request_id).not.toBe(two.request_id);
    expect(one.row_seq).not.toBe(two.row_seq);
    const after = await stored(documents.boris);
    expect(after.requests).toBe(2);
    expect(after.versions).toBe(2);
    expect([...after.rowSeqs].sort()).toEqual([one.row_seq, two.row_seq].sort());
  });
});

// Answers are counted on a request of their own, created on Boris's document after the creates above.
async function answers(id: string) {
  const result = await admin.query<{ state: string; row_seq: string; responses: string; closed: string | null }>(
    `SELECT r.state, r.row_seq::text, (SELECT count(*) FROM collaboration.revision_response s WHERE s.request_id = r.id) AS responses,
            (SELECT v.closed_as FROM collaboration.revision_request_version v WHERE v.request_id = r.id AND v.version = r.version) AS closed
       FROM collaboration.revision_request r WHERE r.id = $1`, [id]);
  const row = result.rows[0];
  return { state: row.state, rowSeq: row.row_seq, responses: Number(row.responses), closed: row.closed };
}

describe("two transitions with the same expected counter, over two real connections (C1, C2)", () => {
  it("two answers: the second waits on the request, then is a conflict and writes nothing", async () => {
    const created = await withActor(people.vesna.token, create(documents.boris));
    const first = hold(people.boris.token, respond(created.request_id, created.row_seq));
    let one: Moved;
    let second: ReturnType<typeof settle<Moved>>;
    try {
      one = await first.answered;
      expect(one).toMatchObject({ outcome: "applied", version: 1, state: "responded" });
      second = settle(withActor(people.boris.token, respond(created.request_id, created.row_seq)));
      await waitForBlocked("respond_revision_request");
    } finally {
      first.release();
    }
    await first.done;
    expect(await second).toEqual({ value: { outcome: "conflict", row_seq: one.row_seq, version: 1, state: "responded" }, code: null });
    expect(await answers(created.request_id)).toEqual({ state: "responded", rowSeq: one.row_seq, responses: 1, closed: null });
  });

  it("a withdrawal and an answer at once: the one that waited is a conflict", async () => {
    const created = await withActor(people.vesna.token, create(documents.boris));
    const first = hold(people.vesna.token, withdraw(created.request_id, created.row_seq));
    let one: Moved;
    let second: ReturnType<typeof settle<Moved>>;
    try {
      one = await first.answered;
      expect(one).toMatchObject({ outcome: "applied", version: 1, state: "withdrawn" });
      second = settle(withActor(people.boris.token, respond(created.request_id, created.row_seq)));
      await waitForBlocked("respond_revision_request");
    } finally {
      first.release();
    }
    await first.done;
    expect(await second).toEqual({ value: { outcome: "conflict", row_seq: one.row_seq, version: 1, state: "withdrawn" }, code: null });
    expect(await answers(created.request_id)).toEqual({ state: "withdrawn", rowSeq: one.row_seq, responses: 0, closed: "withdrawn" });
  });
});

const ACCEPTED_HASH = "e".repeat(64);
const SEEN_HASH = "f".repeat(64);
const accept = (id: string, seq: string) => async (tx: ActorTransaction) => (await tx.query<Moved>(
  "SELECT outcome, row_seq, version, state FROM collaboration.accept_revision_request($1, $2, 1, $3)", [id, seq, ACCEPTED_HASH])).rows[0];
const rereview = (id: string, seq: string, hash: string | null) => async (tx: ActorTransaction) => (await tx.query<Moved>(
  "SELECT outcome, row_seq, version, state FROM collaboration.rereview_revision_request($1, $2, 2, $3)", [id, seq, hash])).rows[0];
const versions = async (id: string) => (await admin.query<{ version: number; opened_as: string; instruction: string; observed: string | null; closed: string | null }>(
  `SELECT version, opened_as, instruction, observed_range_hash AS observed, closed_as AS closed
     FROM collaboration.revision_request_version WHERE request_id = $1 ORDER BY version`, [id])).rows;
const FIRST = { version: 1, opened_as: "instruction", instruction: "Dodaj izvor za ovu tvrdnju.", observed: null, closed: "accepted" };

describe("changed after acceptance, over two real connections (M6.5-P02)", () => {
  it("two rereviews at once: the second waits on the request, then is a conflict and opens no version", async () => {
    const created = await withActor(people.vesna.token, create(documents.boris));
    const answered = await withActor(people.boris.token, respond(created.request_id, created.row_seq));
    const accepted = await withActor(people.vesna.token, accept(created.request_id, answered.row_seq));
    expect(accepted).toMatchObject({ outcome: "applied", version: 1, state: "accepted" });
    const first = hold(people.boris.token, rereview(created.request_id, accepted.row_seq, SEEN_HASH));
    let one: Moved;
    let second: ReturnType<typeof settle<Moved>>;
    try {
      one = await first.answered;
      expect(one).toMatchObject({ outcome: "applied", version: 2, state: "reopened" });
      second = settle(withActor(people.vesna.token, rereview(created.request_id, accepted.row_seq, null)));
      await waitForBlocked("rereview_revision_request");
    } finally {
      first.release();
    }
    await first.done;
    expect(await second).toEqual({ value: { outcome: "conflict", row_seq: one.row_seq, version: 2, state: "reopened" }, code: null });
    // One new version, with the teacher's instruction and the hash of the call that was applied; the answer of version 1 stays.
    expect(await versions(created.request_id)).toEqual([FIRST, { ...FIRST, version: 2, opened_as: "rereview", observed: SEEN_HASH, closed: null }]);
    expect(await answers(created.request_id)).toEqual({ state: "reopened", rowSeq: one.row_seq, responses: 1, closed: null });
  });

  it("an acceptance and a rereview at once: the rereview that loaded the older counter is a conflict, the next one is applied", async () => {
    const created = await withActor(people.vesna.token, create(documents.boris));
    const answered = await withActor(people.boris.token, respond(created.request_id, created.row_seq));
    const first = hold(people.vesna.token, accept(created.request_id, answered.row_seq));
    let one: Moved;
    let second: ReturnType<typeof settle<Moved>>;
    try {
      one = await first.answered;
      expect(one).toMatchObject({ outcome: "applied", version: 1, state: "accepted" });
      second = settle(withActor(people.boris.token, rereview(created.request_id, answered.row_seq, SEEN_HASH)));
      await waitForBlocked("rereview_revision_request");
    } finally {
      first.release();
    }
    await first.done;
    expect(await second).toEqual({ value: { outcome: "conflict", row_seq: one.row_seq, version: 1, state: "accepted" }, code: null });
    expect(await versions(created.request_id)).toEqual([FIRST]);
    const next = await withActor(people.boris.token, rereview(created.request_id, one.row_seq, SEEN_HASH));
    expect(next).toMatchObject({ outcome: "applied", version: 2, state: "reopened" });
    expect(await versions(created.request_id)).toEqual([FIRST, { ...FIRST, version: 2, opened_as: "rereview", observed: SEEN_HASH, closed: null }]);
  });
});
