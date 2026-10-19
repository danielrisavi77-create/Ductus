import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

// B-12 step 2 / DAN-87 (plan #385 B6): pgTAP runs in one transaction and
// cannot race two requests. Here two app connections request a submission for
// the same student and assignment through two different documents, which the
// schema allows: the lookup in app.request_submission cannot see the other's
// uncommitted row, so only the unique key decides. The loser must answer
// "existing" with the winner's row, never a unique-violation error. Runs
// against the compose stack the Local stack CI job migrates; loopback only;
// one random login and random synthetic rows, removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The submission race test runs only against a loopback database (DATABASE_URL).");
}
const suffix = randomBytes(5).toString("hex");
const login = `it_submission_${suffix}`;
const applicationName = `it_submission_${suffix}`;
const password = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("base64url");
const institutionId = randomUUID();
const teacherId = randomUUID();
const studentId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documents = [`doc-${suffix}-a`, `doc-${suffix}-b`];

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

type RequestRow = { outcome: string; submission_request_id: string | null; revision: string | null };
const requestSql =
  "SELECT outcome, submission_request_id, revision FROM app.request_submission($1, 1)";

function applicationUrl() {
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  url.searchParams.set("application_name", applicationName);
  return url.href;
}

async function waitForBlockedRequest(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.usename = $1 AND a.application_name = $2 AND a.state = 'active'
            AND a.query ILIKE '%request_submission%'
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [login, applicationName],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The second request did not reach PostgreSQL and wait on the first transaction.");
}

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-${suffix}`]);
    for (const [id, name] of [[teacherId, "teacher"], [studentId, "student"]] as const) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`],
      );
    }
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [token, studentId, institutionId],
    );
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Race ${suffix}`, teacherId],
    );
    await client.query(
      `INSERT INTO institution.course_member (course_id, institution_id, user_id, role)
       VALUES ($1, $2, $3, 'student')`,
      [courseId, institutionId, studentId],
    );
    await client.query(
      `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, $3, 1, $4)`,
      [assignmentId, courseId, institutionId, teacherId],
    );
    await client.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Synthetic race', 'Synthetic concurrency fixture.', 'essay',
               now() - interval '1 day', now() + interval '1 day', 'partially_allowed',
               ARRAY[]::text[], 'extended', false, $2)`,
      [assignmentId, teacherId],
    );
    await client.query(
      `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
       VALUES ($1, 1, $2, $3)`,
      [assignmentId, studentId, institutionId],
    );
    // One work per student and assignment (evidence_project_one_per_student),
    // so both documents belong to the same project.
    await client.query(
      `INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)`,
      [projectId, institutionId, assignmentId, studentId],
    );
    for (const documentId of documents) {
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 1, $5)`,
        [documentId, institutionId, projectId, studentId, "d".repeat(64)],
      );
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`,
        [documentId, institutionId, studentId, "a".repeat(64), "d".repeat(64)],
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
  await admin.query("BEGIN");
  try {
    // Disposable synthetic rows only; the append-only triggers stay active in
    // normal operation (same teardown as the evidence race test).
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query("DELETE FROM evidence.submission_request WHERE assignment_id = $1", [assignmentId]);
    await admin.query("DELETE FROM evidence.document_revision WHERE document_id = ANY($1)", [documents]);
    await admin.query("DELETE FROM evidence.document WHERE id = ANY($1)", [documents]);
    await admin.query("DELETE FROM evidence.project WHERE id = $1", [projectId]);
    await admin.query("DELETE FROM institution.notice_acknowledgment WHERE assignment_id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.assignment WHERE id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.course_member WHERE course_id = $1", [courseId]);
    await admin.query("DELETE FROM institution.course WHERE id = $1", [courseId]);
    await admin.query("DELETE FROM identity.session WHERE user_id = $1", [studentId]);
    await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await insertFixture();
  appPool = new pg.Pool({ connectionString: applicationUrl(), max: 2 });
  withActor = createWithActor(appPool);
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

describe("submission request concurrency", () => {
  it("records one request per student and assignment; the second click returns it", async () => {
    let firstResult!: (row: RequestRow) => void;
    let rejectFirst!: (error: unknown) => void;
    let releaseFirst!: () => void;
    const firstQuery = new Promise<RequestRow>((resolve, reject) => {
      firstResult = resolve;
      rejectFirst = reject;
    });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstRun = withActor(token, async (tx) => {
      const row = (await tx.query<RequestRow>(requestSql, [documents[0]])).rows[0];
      firstResult(row);
      await holdFirst; // Keep the uncommitted request until the second one waits on it.
      return row;
    });
    void firstRun.catch(rejectFirst);
    let firstRow: RequestRow;
    let secondRun: Promise<RequestRow> | undefined;
    let secondAnsweredBeforeRelease: boolean;
    try {
      firstRow = await firstQuery;
      secondRun = withActor(token, async (tx) => (await tx.query<RequestRow>(requestSql, [documents[1]])).rows[0]);
      secondAnsweredBeforeRelease = await Promise.race([
        secondRun.then(() => true, () => true),
        waitForBlockedRequest().then(() => false),
      ]);
    } finally {
      releaseFirst();
      await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]);
    }
    const secondRow = await secondRun!;

    expect(secondAnsweredBeforeRelease).toBe(false);
    expect(firstRow.outcome).toBe("requested");
    expect(secondRow.outcome).toBe("existing");
    expect(secondRow.submission_request_id).toBe(firstRow.submission_request_id);
    expect(
      await admin.query("SELECT count(*)::int AS n, min(document_id) AS doc FROM evidence.submission_request WHERE assignment_id = $1", [
        assignmentId,
      ]),
    ).toMatchObject({ rows: [{ n: 1, doc: documents[0] }] });
  });
});
