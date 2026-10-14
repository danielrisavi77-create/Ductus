import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

// DAN-189 / attack plan #356 item 5: pgTAP can establish CAS semantics but
// cannot prove a real lock race inside one transaction. This uses two app
// connections and synthetic rows to race separate requests against one doc.
// Never fall back to the shared local app stack. This destructive fixture
// creates and drops roles and synthetic rows, so it requires a disposable DB.
const ADMIN_URL = process.env.DAN189_RACE_DATABASE_URL;
if (!ADMIN_URL) {
  throw new Error("Set DAN189_RACE_DATABASE_URL to a disposable local DAN-189 race-test database.");
}
const adminUrl = new URL(ADMIN_URL);
if (
  adminUrl.hostname !== "127.0.0.1" ||
  !adminUrl.port ||
  adminUrl.port === "54329" ||
  adminUrl.pathname !== "/ductus_dan189_race"
) {
  throw new Error("DAN189_RACE_DATABASE_URL must target 127.0.0.1:<isolated-port>/ductus_dan189_race, never port 54329.");
}
const SAFE_ADMIN_URL: string = ADMIN_URL;
const suffix = randomBytes(5).toString("hex");
const login = `it_evidence_${suffix}`;
const applicationName = `it_evidence_${suffix}`;
const password = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("base64url");
const institutionId = randomUUID();
const teacherId = randomUUID();
const studentId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const evidenceDomainId = randomUUID();
const issuer = `https://issuer-${suffix}.test`;
const packageId = `pkg-${suffix}`;
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;
const initialHash = "a".repeat(64);

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

function applicationUrl() {
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  url.searchParams.set("application_name", applicationName);
  return url.href;
}

async function waitForBlockedReserve(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity a
          WHERE a.usename = $1
            AND a.application_name = $2
            AND a.state = 'active'
            AND a.query ILIKE '%commit_evidence_segment%'
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [login, applicationName],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Second evidence reserve did not reach PostgreSQL and wait on the first transaction.");
}

type ReserveRow = {
  outcome: string;
  committed_revision: string | null;
  receipt_payload: string | null;
  receipt_id: string | null;
};

function command(segmentId: string, segmentHash: string) {
  const clientRequestId = `request-${suffix}-${segmentId.slice(-1)}`;
  const descriptor = {
    evidencePackageId: packageId,
    documentId,
    sessionId: `capture-${suffix}`,
    segmentId,
    evidenceSchema: "ductus-evidence-segment-v2",
    canonicalization: "RFC8785-JCS",
    hashAlgorithm: "sha256",
    evidenceProfileId: "standard-v1",
    sequenceFrom: 1,
    sequenceTo: 1,
    eventCount: 1,
    observedStartedAt: "2026-10-14T10:00:00.000Z",
    observedEndedAt: "2026-10-14T10:00:00.000Z",
    segmentHash,
    predecessorSegmentHash: null,
    payloadBytes: 123,
  };
  return {
    clientRequestId,
    values: [
      packageId,
      clientRequestId,
      0,
      initialHash,
      "d".repeat(64),
      descriptor,
      segmentHash,
      `synthetic://${packageId}/${segmentId}`,
    ],
  };
}

const reserveSql = `
  SELECT outcome, committed_revision, receipt_payload, receipt_id
    FROM app.commit_evidence_segment($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
`;

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-${suffix}`]);
    for (const [id, name] of [[teacherId, "teacher"], [studentId, "student"]] as const) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, institutionId, issuer, `sub-${name}`, `${name}@${suffix}.example`],
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
      "INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, $3)",
      [evidenceDomainId, institutionId, `test-${suffix}`],
    );
    await client.query(
      `INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id)
       VALUES ($1, $2, $3, $4)`,
      [projectId, institutionId, assignmentId, studentId],
    );
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [documentId, institutionId, projectId, studentId, initialHash],
    );
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
       VALUES ($1, $2, 0, NULL, $3, $4)`,
      [documentId, institutionId, studentId, initialHash],
    );
    await client.query(
      `INSERT INTO evidence.package
         (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
          evidence_profile_id, max_payload_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, 'standard-v1', 2097152)`,
      [packageId, institutionId, evidenceDomainId, documentId, projectId, studentId],
    );
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
  if (fixtureReady) {
    await admin.query("BEGIN");
    try {
      // These rows are disposable test fixtures. Match the institution
      // integration cleanup: immutable triggers must remain active in normal
      // operation, while teardown removes only this test's synthetic rows.
      await admin.query("SET LOCAL session_replication_role = replica");
      await admin.query("DELETE FROM evidence.receipt WHERE evidence_package_id = $1", [packageId]);
      await admin.query("DELETE FROM evidence.segment WHERE evidence_package_id = $1", [packageId]);
      await admin.query("DELETE FROM evidence.package WHERE id = $1", [packageId]);
      await admin.query("DELETE FROM evidence.document_revision WHERE document_id = $1", [documentId]);
      await admin.query("DELETE FROM evidence.document WHERE id = $1", [documentId]);
      await admin.query("DELETE FROM evidence.project WHERE id = $1", [projectId]);
      await admin.query("DELETE FROM evidence.domain WHERE id = $1", [evidenceDomainId]);
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

describe("atomic evidence reserve concurrency", () => {
  it("allows only one CAS+reserve for the same document revision", async () => {
    const first = command(`segment-${suffix}-a`, "b".repeat(64));
    const second = command(`segment-${suffix}-b`, "c".repeat(64));
    let firstResult!: (row: ReserveRow) => void;
    let rejectFirst!: (error: unknown) => void;
    let releaseFirst!: () => void;
    const firstQuery = new Promise<ReserveRow>((resolve, reject) => {
      firstResult = resolve;
      rejectFirst = reject;
    });
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstRun = withActor(token, async (tx) => {
      const row = (await tx.query<ReserveRow>(reserveSql, first.values)).rows[0];
      firstResult(row);
      await holdFirst; // Keep package/document row locks until request two is waiting.
      return row;
    });
    void firstRun.catch(rejectFirst);
    let firstRow: ReserveRow;
    let secondRun: Promise<ReserveRow> | undefined;
    let secondAnsweredBeforeRelease: boolean;
    try {
      firstRow = await firstQuery;
      secondRun = withActor(token, async (tx) => (await tx.query<ReserveRow>(reserveSql, second.values)).rows[0]);
      secondAnsweredBeforeRelease = await Promise.race([
        secondRun.then(() => true, () => true),
        waitForBlockedReserve().then(() => false),
      ]);
    } finally {
      releaseFirst();
      await Promise.allSettled([firstRun, ...(secondRun ? [secondRun] : [])]);
    }
    const secondRow = await secondRun!;
    const outcomes = [firstRow, secondRow];

    expect(secondAnsweredBeforeRelease).toBe(false);
    expect(outcomes.map((row) => row.outcome).sort()).toEqual(["concurrent_conflict", "reserved"]);
    expect(outcomes.filter((row) => row.outcome === "reserved")[0]?.committed_revision).toBe("1");
    expect(await admin.query("SELECT count(*)::int AS n FROM evidence.segment WHERE evidence_package_id = $1", [packageId]))
      .toMatchObject({ rows: [{ n: 1 }] });
    expect(await admin.query("SELECT count(*)::int AS n FROM evidence.receipt WHERE evidence_package_id = $1", [packageId]))
      .toMatchObject({ rows: [{ n: 1 }] });
    expect(await admin.query("SELECT current_revision::int AS n FROM evidence.document WHERE id = $1", [documentId]))
      .toMatchObject({ rows: [{ n: 1 }] });
  });
});
