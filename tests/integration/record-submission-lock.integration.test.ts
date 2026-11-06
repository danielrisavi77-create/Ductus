import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-314 step 2c (docs/backend/suradnja.md 4.14, contract on #1091, plan of
// attack #1506 B8): app.record_submission locks the packages of the document
// FOR UPDATE (by id) and then the document FOR UPDATE, before it writes the
// submission. pgTAP runs in one transaction and its fixture is invisible to a
// second connection, so the NOWAIT proof (55P03) is here too. Real connections
// race the submission against each collaboration write in both orders, and
// against a segment commit in both orders, without 40P01. Every person, course,
// text and hash is invented; random ids of one random institution, removed
// afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The record_submission lock test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_record_lock_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 8, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const evidenceDomainId = randomUUID();
const teacher = { id: randomUUID(), token: randomBytes(32).toString("base64url") };
const initialHash = "a".repeat(64);
const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ANCHOR = JSON.stringify({ nodeId: "0f0e0d0c-0b0a-4000-8000-000000000001", quote: "prvi odlomak", prefix: "", suffix: " teksta", startHint: 0, endHint: 12 });

// One work per test: its own student, document and package, with revision 1
// committed and requested, so only record_submission is left.
const writes = ["create", "respond", "accept", "reopen", "withdraw"] as const;
type Write = typeof writes[number];
const workNames = [...writes.map((write) => `first_${write}`), "frozen", "nowait", "commitfirst", "recordfirst"];
type Work = { name: string; studentId: string; token: string; projectId: string; documentId: string; packageId: string; requestId?: string };
const works = new Map<string, Work>(workNames.map((name) => [name, {
  name,
  studentId: randomUUID(),
  token: randomBytes(32).toString("base64url"),
  projectId: `project-${name}-${suffix}`,
  documentId: `doc-${name}-${suffix}`,
  packageId: `pkg-${name}-${suffix}`,
}]));
const work = (name: string) => works.get(name)!;

/** The arguments of app.commit_evidence_segment for segment `n` (revision n - 1 to n). */
function segment(w: Work, n: number) {
  const snapshot = (k: number) => `snapshot-${w.name}-${k}`;
  const hash = (k: number) => sha256Hex(`segment-${w.name}-${k}`);
  return [
    w.packageId, `request-${w.name}-${n}`, n - 1, n === 1 ? initialHash : sha256Hex(snapshot(n - 1)), sha256Hex(snapshot(n)),
    {
      evidencePackageId: w.packageId, documentId: w.documentId, sessionId: `capture-${suffix}`, segmentId: `segment-${w.name}-${n}`,
      evidenceSchema: "ductus-evidence-segment-v2", canonicalization: "RFC8785-JCS", hashAlgorithm: "sha256",
      evidenceProfileId: "standard-v1", sequenceFrom: n, sequenceTo: n, eventCount: 1,
      observedStartedAt: "2026-10-14T10:00:00.000Z", observedEndedAt: "2026-10-14T10:00:00.000Z",
      segmentHash: hash(n), predecessorSegmentHash: n === 1 ? null : hash(n - 1), payloadBytes: 123,
    },
    hash(n), `synthetic://${w.packageId}/${n}`, snapshot(n),
  ];
}
type Outcome = { outcome: string };
const commit = (w: Work, n: number) => async (tx: ActorTransaction) => (await tx.query<Outcome>(
  "SELECT outcome FROM app.commit_evidence_segment($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)", segment(w, n))).rows[0];
const record = (w: Work) => async (tx: ActorTransaction) => (await tx.query<Outcome>(
  "SELECT outcome FROM app.record_submission($1, $2)", [w.requestId, sha256Hex(`snapshot-${w.name}-1`)])).rows[0];

type Moved = { outcome?: string; request_id?: string; row_seq: string; version: number; state: string };
const call = (sql: string, args: unknown[]) => async (tx: ActorTransaction) => (await tx.query<Moved>(sql, args)).rows[0];
const create = (w: Work) => call(
  "SELECT request_id, row_seq, version, state FROM collaboration.create_revision_request($1, $2::jsonb, 'Dodaj izvor za ovu tvrdnju.', 1)",
  [w.documentId, ANCHOR]);
const respond = (id: string, seq: string) => call(
  "SELECT outcome, row_seq, version, state FROM collaboration.respond_revision_request($1, $2, 'done', 'Dodao sam izvor.', 1)", [id, seq]);
const accept = (id: string, seq: string) => call(
  "SELECT outcome, row_seq, version, state FROM collaboration.accept_revision_request($1, $2, 1, $3)", [id, seq, "e".repeat(64)]);
const reopen = (id: string, seq: string) => call(
  "SELECT outcome, row_seq, version, state FROM collaboration.reopen_revision_request($1, $2, 'Nova uputa.', 1)", [id, seq]);
const withdraw = (id: string, seq: string) => call(
  "SELECT outcome, row_seq, version, state FROM collaboration.withdraw_revision_request($1, $2)", [id, seq]);

/**
 * Prepares the request a write acts on (open, or responded for an acceptance)
 * and returns who makes the write and the call itself.
 */
async function prepare(write: Write, w: Work): Promise<{ token: string; run: (tx: ActorTransaction) => Promise<Moved> }> {
  if (write === "create") return { token: teacher.token, run: create(w) };
  const opened = await withActor(teacher.token, create(w));
  const id = opened.request_id!;
  if (write === "respond") return { token: w.token, run: respond(id, opened.row_seq) };
  if (write === "reopen") return { token: teacher.token, run: reopen(id, opened.row_seq) };
  if (write === "withdraw") return { token: teacher.token, run: withdraw(id, opened.row_seq) };
  const responded = await withActor(w.token, respond(id, opened.row_seq));
  expect(responded).toMatchObject({ outcome: "applied", state: "responded" });
  return { token: teacher.token, run: accept(id, responded.row_seq) };
}
const writeName = (write: Write) => `${write}_revision_request`;

/** Waits until a call matching `pattern` is in PostgreSQL and waits on a lock of another transaction. */
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

/** Every collaboration row of a document, as one comparable value. */
async function collaborationRows(w: Work) {
  const result = await admin.query<{ rows: string | null }>(
    `SELECT concat_ws('#',
       (SELECT string_agg(concat_ws('|', r.id, r.state, r.version, r.row_seq), ';' ORDER BY r.row_seq)
          FROM collaboration.revision_request r WHERE r.document_id = $1),
       (SELECT string_agg(concat_ws('|', v.request_id, v.version, v.closed_as), ';' ORDER BY v.request_id, v.version)
          FROM collaboration.revision_request_version v JOIN collaboration.revision_request r ON r.id = v.request_id
         WHERE r.document_id = $1),
       (SELECT string_agg(concat_ws('|', s.request_id, s.version), ';' ORDER BY s.request_id, s.version)
          FROM collaboration.revision_response s JOIN collaboration.revision_request r ON r.id = s.request_id
         WHERE r.document_id = $1)) AS rows`, [w.documentId]);
  return result.rows[0].rows;
}
const recordedAt = async (w: Work) => (await admin.query<{ recorded_at: Date | null }>(
  `SELECT s.recorded_at FROM evidence.submission s
     JOIN evidence.submission_request r ON r.id = s.submission_request_id AND r.institution_id = s.institution_id
    WHERE r.document_id = $1`, [w.documentId])).rows[0]?.recorded_at ?? null;
const revision = async (w: Work) => Number((await admin.query<{ current_revision: string }>(
  "SELECT current_revision FROM evidence.document WHERE id = $1", [w.documentId])).rows[0].current_revision);

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-record-lock-${suffix}`]);
    const person = async (id: string, token: string, name: string) => {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`, [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`]);
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`, [token, id, institutionId]);
    };
    await person(teacher.id, teacher.token, "teacher");
    await client.query("INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())",
      [institutionId, teacher.id]);
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`, [courseId, institutionId, `Izmisljeni kolegij ${suffix}`, teacher.id]);
    await client.query("INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'teacher')",
      [courseId, institutionId, teacher.id]);
    await client.query(
      "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [assignmentId, courseId, institutionId, teacher.id]);
    await client.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Izmisljeni zadatak', 'Sinteticki zadatak.', 'essay', now() - interval '1 day', now() + interval '1 day',
               'partially_allowed', ARRAY[]::text[], 'extended', false, $2)`, [assignmentId, teacher.id]);
    await client.query("INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, $3)",
      [evidenceDomainId, institutionId, `test-${suffix}`]);
    for (const w of works.values()) {
      await person(w.studentId, w.token, w.name);
      await client.query("INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
        [courseId, institutionId, w.studentId]);
      await client.query("INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
        [assignmentId, w.studentId, institutionId]);
      await client.query("INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [w.projectId, institutionId, assignmentId, w.studentId]);
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 0, $5)`, [w.documentId, institutionId, w.projectId, w.studentId, initialHash]);
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4)`, [w.documentId, institutionId, w.studentId, initialHash]);
      await client.query(
        `INSERT INTO evidence.package (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
                                       evidence_profile_id, max_payload_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard-v1', 2097152)`,
        [w.packageId, institutionId, evidenceDomainId, w.documentId, w.projectId, w.studentId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanUp() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Disposable synthetic rows only; the append-only triggers stay active in normal operation.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["collaboration.revision_response", "collaboration.revision_request_version", "collaboration.revision_request",
      "audit.access_log", "evidence.submission", "evidence.submission_request", "evidence.receipt", "evidence.segment",
      "evidence.document_checkpoint", "evidence.package", "evidence.document_revision", "evidence.document", "evidence.project",
      "evidence.domain", "institution.notice_acknowledgment"]) {
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

beforeAll(async () => {
  await insertFixture();
  for (const w of works.values()) {
    expect(await withActor(w.token, commit(w, 1))).toEqual({ outcome: "reserved" });
    const requested = await withActor(w.token, async (tx) => (await tx.query<{ outcome: string; submission_request_id: string }>(
      "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [w.documentId])).rows[0]);
    expect(requested.outcome).toBe("requested");
    w.requestId = requested.submission_request_id;
  }
});

afterAll(async () => {
  try {
    await app.end();
  } finally {
    await cleanUp();
  }
});

describe("record_submission holds the document and its packages", () => {
  it("a second connection cannot lock the document or the package while the submission is open (55P03)", async () => {
    const w = work("nowait");
    const submission = hold(w.token, record(w));
    const tries: { code: string | null }[] = [];
    try {
      expect(await submission.answered).toEqual({ outcome: "recorded" });
      for (const sql of [
        "SELECT 1 FROM evidence.document WHERE id = $1 FOR UPDATE NOWAIT",
        "SELECT 1 FROM evidence.document WHERE id = $1 FOR SHARE NOWAIT",
        "SELECT 1 FROM evidence.package WHERE document_id = $1 FOR UPDATE NOWAIT",
      ]) {
        tries.push(await settle(admin.query(sql, [w.documentId])));
      }
    } finally {
      submission.release();
    }
    await submission.done;
    expect(tries.map((t) => t.code)).toEqual(["55P03", "55P03", "55P03"]);
  });
});

describe("a collaboration write that holds the document first finishes before the submission", () => {
  for (const write of writes) {
    it(`${write}: the submission waits on the document, then the write stays and the submission follows`, async () => {
      const w = work(`first_${write}`);
      const { token, run } = await prepare(write, w);
      const writing = hold(token, run);
      let submission: ReturnType<typeof settle<Outcome>>;
      let moved: Moved;
      try {
        moved = await writing.answered;
        submission = settle(withActor(w.token, record(w)));
        // Without the lock before the INSERT the submission does not wait here.
        await waitForBlocked("record_submission");
        expect(await recordedAt(w)).toBeNull();
      } finally {
        writing.release();
      }
      await writing.done;
      if (write === "create") expect(moved).toMatchObject({ state: "open", version: 1 });
      else expect(moved.outcome).toBe("applied");
      const rows = await collaborationRows(w);
      expect(await submission).toEqual({ value: { outcome: "recorded" }, code: null });
      expect(await collaborationRows(w)).toBe(rows);
    });
  }
});

describe("a submission that holds the document first freezes the requests", () => {
  it("every write waits on the document, then is forbidden (ZD403) and writes nothing", async () => {
    const w = work("frozen");
    const prepared = new Map<Write, Awaited<ReturnType<typeof prepare>>>();
    for (const write of writes) prepared.set(write, await prepare(write, w));
    const before = await collaborationRows(w);
    const submission = hold(w.token, record(w));
    const attempts: ReturnType<typeof settle<Moved>>[] = [];
    try {
      expect(await submission.answered).toEqual({ outcome: "recorded" });
      for (const write of writes) {
        const { token, run } = prepared.get(write)!;
        attempts.push(settle(withActor(token, run)));
        await waitForBlocked(writeName(write));
      }
    } finally {
      submission.release();
    }
    await submission.done;
    expect(await Promise.all(attempts)).toEqual(writes.map(() => ({ value: null, code: "ZD403" })));
    expect(await collaborationRows(w)).toBe(before);
  });
});

describe("submission and segment commit of one document, in both orders, without 40P01", () => {
  it("commit first: the segment is accepted, then the submission is recorded after it", async () => {
    const w = work("commitfirst");
    const committing = hold(w.token, commit(w, 2));
    let submission: ReturnType<typeof settle<Outcome>>;
    try {
      expect(await committing.answered).toEqual({ outcome: "reserved" });
      submission = settle(withActor(w.token, record(w)));
      await waitForBlocked("record_submission");
    } finally {
      committing.release();
    }
    expect(await settle(committing.done)).toEqual({ value: { outcome: "reserved" }, code: null });
    expect(await submission).toEqual({ value: { outcome: "recorded" }, code: null });
    expect(await revision(w)).toBe(2);
    const accepted = (await admin.query<{ accepted_at: Date }>(
      "SELECT max(accepted_at) AS accepted_at FROM evidence.segment WHERE evidence_package_id = $1", [w.packageId])).rows[0].accepted_at;
    expect((await recordedAt(w))!.getTime()).toBeGreaterThanOrEqual(accepted.getTime());
    expect(await withActor(w.token, commit(w, 3))).toEqual({ outcome: "not_accepting" });
  });

  it("submission first: the commit waits, then is not_accepting and adds nothing", async () => {
    const w = work("recordfirst");
    const submission = hold(w.token, record(w));
    let committing: ReturnType<typeof settle<Outcome>>;
    try {
      expect(await submission.answered).toEqual({ outcome: "recorded" });
      committing = settle(withActor(w.token, commit(w, 2)));
      await waitForBlocked("commit_evidence_segment");
    } finally {
      submission.release();
    }
    expect(await settle(submission.done)).toEqual({ value: { outcome: "recorded" }, code: null });
    expect(await committing).toEqual({ value: { outcome: "not_accepting" }, code: null });
    expect(await revision(w)).toBe(1);
  });
});
