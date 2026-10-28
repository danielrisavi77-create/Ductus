import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction, type WithActor } from "@/server/db/with-actor";

// DAN-289 A1 (contract #756 I3, plan of attack #755 A9 and A10): pgTAP runs in
// one transaction and cannot race two calls. The submission closes the
// package from a trigger, after record_submission's own locks (assignment and
// membership FOR SHARE), while an acceptance locks the package first and the
// assignment after. Here real connections race the two in both orders, and
// once with a third connection that wants the assignment for writing. Every
// call must finish without a deadlock, and an acceptance either lands before
// the closing or is not_accepting. Runs against the compose stack the Local
// stack CI job migrates; loopback only; one random login and random synthetic
// rows of one random institution, removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The submission closing race test runs only against a loopback database (DATABASE_URL).");
}
const suffix = randomBytes(5).toString("hex");
const login = `it_close_${suffix}`;
const applicationName = `it_close_${suffix}`;
const writerName = `it_close_w_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const teacherId = randomUUID();
const courseId = randomUUID();
const evidenceDomainId = randomUUID();
const initialHash = "a".repeat(64);

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

type Work = {
  name: string;
  studentId: string;
  token: string;
  assignmentId: string;
  projectId: string;
  documentId: string;
  packageId: string;
  requestId?: string;
};
type Row = { outcome: string };

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;
const works = new Map<string, Work>();

function urlFor(user: string | null, pass: string | null, name: string) {
  const url = new URL(SAFE_ADMIN_URL);
  if (user !== null && pass !== null) {
    url.username = user;
    url.password = pass;
  }
  url.searchParams.set("application_name", name);
  return url.href;
}

/** The arguments of app.commit_evidence_segment for segment `n` (revision n - 1 to n). */
function segment(work: Work, n: number) {
  const snapshot = (k: number) => `snapshot-${work.name}-${k}`;
  const hash = (k: number) => sha256Hex(`segment-${work.name}-${k}`);
  return [
    work.packageId,
    `request-${work.name}-${n}`,
    n - 1,
    n === 1 ? initialHash : sha256Hex(snapshot(n - 1)),
    sha256Hex(snapshot(n)),
    {
      evidencePackageId: work.packageId,
      documentId: work.documentId,
      sessionId: `capture-${suffix}`,
      segmentId: `segment-${work.name}-${n}`,
      evidenceSchema: "ductus-evidence-segment-v2",
      canonicalization: "RFC8785-JCS",
      hashAlgorithm: "sha256",
      evidenceProfileId: "standard-v1",
      sequenceFrom: n,
      sequenceTo: n,
      eventCount: 1,
      observedStartedAt: "2026-10-14T10:00:00.000Z",
      observedEndedAt: "2026-10-14T10:00:00.000Z",
      segmentHash: hash(n),
      predecessorSegmentHash: n === 1 ? null : hash(n - 1),
      payloadBytes: 123,
    },
    hash(n),
    `synthetic://${work.packageId}/${n}`,
    snapshot(n),
  ];
}
const commitSql = "SELECT outcome FROM app.commit_evidence_segment($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)";
const recordSql = "SELECT outcome FROM app.record_submission($1, $2)";

const commit = (work: Work, n: number) => async (tx: ActorTransaction) =>
  (await tx.query<Row>(commitSql, segment(work, n))).rows[0];
const record = (work: Work) => async (tx: ActorTransaction) =>
  (await tx.query<Row>(recordSql, [work.requestId, sha256Hex(`snapshot-${work.name}-1`)])).rows[0];

async function waitForBlocked(name: string, pattern: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE $2
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [name, `%${pattern}%`],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`The call ${pattern} did not reach PostgreSQL and wait on another transaction.`);
}

/** Runs `first` and keeps its transaction open until `release` is called. */
function hold(token: string, first: (tx: ActorTransaction) => Promise<Row>) {
  let started!: (row: Row) => void;
  let failed!: (error: unknown) => void;
  let release!: () => void;
  const answered = new Promise<Row>((resolve, reject) => {
    started = resolve;
    failed = reject;
  });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const done = withActor(token, async (tx) => {
    const row = await first(tx);
    started(row);
    await held;
    return row;
  });
  void done.catch(failed);
  return { answered, release, done };
}

async function accepts(work: Work) {
  const result = await admin.query<{ accepts_evidence: boolean }>(
    "SELECT accepts_evidence FROM evidence.package WHERE id = $1", [work.packageId]);
  return result.rows[0]?.accepts_evidence;
}
async function revision(work: Work) {
  const result = await admin.query<{ current_revision: string }>(
    "SELECT current_revision FROM evidence.document WHERE id = $1", [work.documentId]);
  return Number(result.rows[0]?.current_revision);
}

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-${suffix}`]);
    const account = (id: string, name: string) => client.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`],
    );
    await account(teacherId, "teacher");
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Race ${suffix}`, teacherId],
    );
    await client.query("INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, $3)",
      [evidenceDomainId, institutionId, `test-${suffix}`]);
    for (const work of works.values()) {
      await account(work.studentId, work.name);
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [work.token, work.studentId, institutionId],
      );
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
        [courseId, institutionId, work.studentId],
      );
      await client.query(
        `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
         VALUES ($1, $2, $3, 1, $4)`,
        [work.assignmentId, courseId, institutionId, teacherId],
      );
      await client.query(
        `INSERT INTO institution.assignment_version
           (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
            ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Synthetic race', 'Synthetic concurrency fixture.', 'essay',
                 now() - interval '1 day', now() + interval '1 day', 'partially_allowed',
                 ARRAY[]::text[], 'extended', false, $2)`,
        [work.assignmentId, teacherId],
      );
      await client.query(
        `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
         VALUES ($1, 1, $2, $3)`,
        [work.assignmentId, work.studentId, institutionId],
      );
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [work.projectId, institutionId, work.assignmentId, work.studentId],
      );
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [work.documentId, institutionId, work.projectId, work.studentId, initialHash],
      );
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4)`,
        [work.documentId, institutionId, work.studentId, initialHash],
      );
      await client.query(
        `INSERT INTO evidence.package (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
                                       evidence_profile_id, max_payload_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, 'standard-v1', 2097152)`,
        [work.packageId, institutionId, evidenceDomainId, work.documentId, work.projectId, work.studentId],
      );
    }
    await client.query("COMMIT");
    fixtureReady = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeFixture() {
  if (!fixtureReady) return;
  const assignments = [...works.values()].map((work) => work.assignmentId);
  await admin.query("BEGIN");
  try {
    // Disposable synthetic rows of this institution only; the append-only
    // triggers stay active in normal operation (as the other race tests).
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "evidence.submission", "evidence.submission_request", "evidence.receipt", "evidence.segment",
      "evidence.document_checkpoint", "evidence.package", "evidence.document_revision", "evidence.document",
      "evidence.project", "evidence.domain", "institution.notice_acknowledgment", "institution.notification",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    await admin.query("DELETE FROM institution.assignment_version WHERE assignment_id = ANY($1::uuid[])", [assignments]);
    for (const table of ["institution.assignment", "institution.course_member", "institution.course",
      "identity.session", "identity.user_account"]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

beforeAll(async () => {
  for (const name of ["commitfirst", "recordfirst", "thirdlock"]) {
    works.set(name, {
      name,
      studentId: randomUUID(),
      token: randomBytes(32).toString("base64url"),
      assignmentId: randomUUID(),
      projectId: `project-${name}-${suffix}`,
      documentId: `doc-${name}-${suffix}`,
      packageId: `pkg-${name}-${suffix}`,
    });
  }
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await insertFixture();
  appPool = new pg.Pool({ connectionString: urlFor(login, password, applicationName), max: 2 });
  withActor = createWithActor(appPool);
  // Every work has revision 1 committed and requested.
  for (const work of works.values()) {
    expect((await withActor(work.token, commit(work, 1))).outcome).toBe("reserved");
    const request = await withActor(work.token, async (tx) =>
      (await tx.query<{ outcome: string; submission_request_id: string }>(
        "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [work.documentId],
      )).rows[0]);
    expect(request.outcome).toBe("requested");
    work.requestId = request.submission_request_id;
  }
});

afterAll(async () => {
  await appPool?.end();
  let cleanupError: unknown;
  try {
    await removeFixture();
  } catch (error) {
    cleanupError = error;
  }
  try {
    const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
    await admin.query(drop.rows[0].ddl);
  } finally {
    await admin.end();
  }
  if (cleanupError) throw cleanupError;
});

describe("a submission closes the package without a lock cycle", () => {
  it("an acceptance that holds the package first lands, then the submission closes", async () => {
    const work = works.get("commitfirst")!;
    const first = hold(work.token, commit(work, 2));
    let second: Promise<Row> | undefined;
    try {
      expect((await first.answered).outcome).toBe("reserved");
      second = withActor(work.token, record(work));
      await waitForBlocked(applicationName, "record_submission");
    } finally {
      first.release();
      await Promise.allSettled([first.done, ...(second ? [second] : [])]);
    }
    expect((await first.done).outcome).toBe("reserved");
    expect((await second!).outcome).toBe("recorded");
    expect(await accepts(work)).toBe(false);
    expect(await revision(work)).toBe(2);
    expect((await withActor(work.token, commit(work, 3))).outcome).toBe("not_accepting");
    expect(await revision(work)).toBe(2);
  });

  it("an acceptance that waits on the submission sees the package closed", async () => {
    const work = works.get("recordfirst")!;
    const first = hold(work.token, record(work));
    let second: Promise<Row> | undefined;
    try {
      expect((await first.answered).outcome).toBe("recorded");
      second = withActor(work.token, commit(work, 2));
      await waitForBlocked(applicationName, "commit_evidence_segment");
    } finally {
      first.release();
      await Promise.allSettled([first.done, ...(second ? [second] : [])]);
    }
    expect((await first.done).outcome).toBe("recorded");
    expect((await second!).outcome).toBe("not_accepting");
    expect(await accepts(work)).toBe(false);
    expect(await revision(work)).toBe(1);
  });

  it("a third transaction that wants the assignment for writing adds no cycle", async () => {
    const work = works.get("thirdlock")!;
    const writer = new pg.Client({ connectionString: urlFor(null, null, writerName) });
    await writer.connect();
    const first = hold(work.token, commit(work, 2));
    let third: Promise<void> | undefined;
    let second: Promise<Row> | undefined;
    try {
      expect((await first.answered).outcome).toBe("reserved");
      // The teacher's side: the assignment row for writing, queued behind the acceptance's share lock.
      third = (async () => {
        await writer.query("BEGIN");
        await writer.query("SELECT 1 FROM institution.assignment WHERE id = $1 FOR UPDATE", [work.assignmentId]);
        await writer.query("COMMIT");
      })();
      await waitForBlocked(writerName, "FOR UPDATE");
      second = withActor(work.token, record(work));
      await waitForBlocked(applicationName, "record_submission");
    } finally {
      first.release();
      await Promise.allSettled([first.done, ...(second ? [second] : []), ...(third ? [third] : [])]);
      await writer.end();
    }
    // A deadlock would reject one of these with 40P01.
    await expect(third!).resolves.toBeUndefined();
    expect((await first.done).outcome).toBe("reserved");
    expect((await second!).outcome).toBe("recorded");
    expect(await accepts(work)).toBe(false);
  });
});
