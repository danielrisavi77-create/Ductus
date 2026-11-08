import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-386 (contract on #1091, c.6720558678): pgTAP runs in one transaction and
// cannot race two calls. Here two real connections race a change of the work
// language against a submission in both orders. Both language writers take the
// assignment FOR UPDATE; request_submission holds it FOR SHARE through
// app.lock_student_assignment, so the submission that commits first fixes the
// language. Every person, course, text and hash is invented; random ids of one
// random institution, removed afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The work language race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_work_language_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 4, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const names = ["vesna", "ana", "dora"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;
// Ana's work is submitted before the change, Dora's after it.
const documents = { ana: `doc-ana-${suffix}`, dora: `doc-dora-${suffix}` } as const;
const TEXT = `{"nodes":[{"children":[{"text":"Izmisljeni tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");

const setWork = (student: Name, language: string | null) => async (tx: ActorTransaction) =>
  (await tx.query<{ language: string | null }>("SELECT institution.set_work_language($1, $2, $3) AS language",
    [assignmentId, people[student].id, language])).rows[0].language;
const setAssignment = (expectedVersion: number, language: string) => async (tx: ActorTransaction) =>
  (await tx.query<{ version: number }>("SELECT institution.set_assignment_work_language($1, $2, $3) AS version",
    [assignmentId, expectedVersion, language])).rows[0].version;
const readWork = (student: Name) => async (tx: ActorTransaction) =>
  (await tx.query<{ language: string | null }>("SELECT institution.work_language($1, $2) AS language",
    [assignmentId, people[student].id])).rows[0].language;
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
// The stored state as the admin sees it: the current version with its language and every override.
async function stored() {
  const version = (await admin.query<{ current_version: number; work_language: string; versions: string }>(
    `SELECT a.current_version, v.work_language,
            (SELECT count(*) FROM institution.assignment_version w WHERE w.assignment_id = a.id) AS versions
       FROM institution.assignment a
       JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
      WHERE a.id = $1`, [assignmentId])).rows[0];
  const overrides = (await admin.query<{ student_id: string; work_language: string }>(
    "SELECT student_id, work_language FROM institution.work_language_override WHERE assignment_id = $1 ORDER BY student_id",
    [assignmentId])).rows;
  return {
    version: version.current_version,
    versions: Number(version.versions),
    language: version.work_language,
    overrides: overrides.map((row) => ({ student: row.student_id, language: row.work_language })),
  };
}
const submitted = async (document: string) => (await admin.query<{ yes: boolean }>(
  `SELECT EXISTS (SELECT 1 FROM evidence.submission_request r
     JOIN evidence.submission s ON s.submission_request_id = r.id AND s.institution_id = r.institution_id
    WHERE r.document_id = $1) AS yes`, [document])).rows[0].yes;

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-work-language-${suffix}`]);
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
    // No work_language: the column default gives the first version 'hr'.
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
    for (const table of ["institution.work_language_override", "audit.access_log", "evidence.submission", "evidence.submission_request",
      "evidence.document_checkpoint", "evidence.document_revision", "evidence.document", "evidence.project",
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

describe("work language against a submission, over two real connections", () => {
  it("submission first: both changes wait on the assignment, then are a conflict and write nothing", async () => {
    const submission = hold(people.ana.token, submit(documents.ana));
    let work: ReturnType<typeof settle<string | null>>;
    let assignment: ReturnType<typeof settle<number>>;
    try {
      expect(await submission.answered).toEqual(["requested", "recorded"]);
      work = settle(withActor(people.vesna.token, setWork("ana", "en")));
      await waitForBlocked("set_work_language");
      assignment = settle(withActor(people.vesna.token, setAssignment(1, "en")));
      await waitForBlocked("set_assignment_work_language");
    } finally {
      submission.release();
    }
    await submission.done;
    // Each change must see the commit it waited for, not its older snapshot.
    expect(await work).toEqual({ value: null, code: "ZD409" });
    expect(await assignment).toEqual({ value: null, code: "ZD409" });
    expect(await submitted(documents.ana)).toBe(true);
    expect(await stored()).toEqual({ version: 1, versions: 1, language: "hr", overrides: [] });
    expect(await withActor(people.ana.token, readWork("ana"))).toBe("hr");
  });

  it("change first: the submission waits on the assignment, then follows in the new language, which is then fixed", async () => {
    const change = hold(people.vesna.token, setWork("dora", "en"));
    let submission: ReturnType<typeof settle<string[]>>;
    try {
      expect(await change.answered).toBe("en");
      submission = settle(withActor(people.dora.token, submit(documents.dora)));
      await waitForBlocked("request_submission");
      expect(await submitted(documents.dora)).toBe(false);
    } finally {
      change.release();
    }
    await change.done;
    expect(await submission).toEqual({ value: ["requested", "recorded"], code: null });
    expect(await submitted(documents.dora)).toBe(true);
    expect(await withActor(people.dora.token, readWork("dora"))).toBe("en");
    // After the submission neither the work nor the assignment may change the language.
    expect(await settle(withActor(people.vesna.token, setWork("dora", "hr")))).toEqual({ value: null, code: "ZD409" });
    expect(await settle(withActor(people.vesna.token, setWork("dora", null)))).toEqual({ value: null, code: "ZD409" });
    expect(await settle(withActor(people.vesna.token, setAssignment(1, "en")))).toEqual({ value: null, code: "ZD409" });
    expect(await stored()).toEqual({ version: 1, versions: 1, language: "hr", overrides: [{ student: people.dora.id, language: "en" }] });
  });
});
