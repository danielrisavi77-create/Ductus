import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-380 (contract on #1091, c.6722796115): pgTAP runs in one transaction and
// cannot race two calls. Here two real connections race the student's mark of
// an approved accommodation (D-50) against their own submission in both orders.
// set_work_accommodation takes the assignment FOR UPDATE; request_submission
// holds it FOR SHARE, so whichever commits first decides: a mark after the
// submission request is a conflict, and a submission after the mark sees it.
// Two more cases race the mark against the removal of the student: after the
// assignment FOR UPDATE the mark checks again, and locks FOR SHARE, the
// student's active membership, so a removal that committed while the mark
// waited refuses it, and a later one waits for it. The mark carries no reason
// and none is written here. Every person, course, text and hash is invented;
// random ids of one random institution, removed afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The work accommodation race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_work_accommodation_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 4, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
// Vesna teaches the course; Ana, Dora, Mara and Tea study in it.
const names = ["vesna", "ana", "dora", "mara", "tea"] as const;
const teachers: readonly Name[] = ["vesna"];
const students: readonly Name[] = ["ana", "dora", "mara", "tea"];
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;
// Ana's work is submitted before the mark, Dora's after it.
const documents = { ana: `doc-ana-${suffix}`, dora: `doc-dora-${suffix}` } as const;
const TEXT = `{"nodes":[{"children":[{"text":"Izmisljeni tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");

const mark = (marked: boolean) => async (tx: ActorTransaction) =>
  (await tx.query<{ marked: boolean }>("SELECT institution.set_work_accommodation($1, $2) AS marked",
    [assignmentId, marked])).rows[0].marked;
const removeStudent = (student: Name) => async (tx: ActorTransaction) =>
  (await tx.query<{ removed: boolean }>("SELECT institution.remove_student($1, $2) AS removed",
    [courseId, people[student].id])).rows[0].removed;
const readMark = (student: Name) => async (tx: ActorTransaction) =>
  (await tx.query<{ marked: boolean | null }>("SELECT institution.work_accommodation($1, $2) AS marked",
    [assignmentId, people[student].id])).rows[0].marked;
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
// The marked students as the admin sees them, by id.
const stored = async () => (await admin.query<{ student_id: string }>(
  "SELECT student_id FROM institution.work_accommodation WHERE assignment_id = $1 ORDER BY student_id",
  [assignmentId])).rows.map((row) => row.student_id);
const submitted = async (document: string) => (await admin.query<{ yes: boolean }>(
  `SELECT EXISTS (SELECT 1 FROM evidence.submission_request r
     JOIN evidence.submission s ON s.submission_request_id = r.id AND s.institution_id = r.institution_id
    WHERE r.document_id = $1) AS yes`, [document])).rows[0].yes;

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-work-accommodation-${suffix}`]);
    for (const name of names) {
      const { id, token } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`, [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`]);
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`, [token, id, institutionId]);
    }
    for (const name of teachers) await client.query(
      "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())",
      [institutionId, people[name].id]);
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`, [courseId, institutionId, `Izmisljeni kolegij ${suffix}`, people.vesna.id]);
    for (const name of [...teachers, ...students]) await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
      [courseId, institutionId, people[name].id, teachers.includes(name) ? "teacher" : "student"]);
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
    for (const table of ["institution.work_accommodation", "audit.access_log", "audit.course_member_event", "evidence.submission", "evidence.submission_request",
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

describe("accommodation mark against the student's own submission, over two real connections", () => {
  it("submission first: the mark waits on the assignment, then is a conflict and writes nothing", async () => {
    const submission = hold(people.ana.token, submit(documents.ana));
    let marking: ReturnType<typeof settle<boolean>>;
    try {
      expect(await submission.answered).toEqual(["requested", "recorded"]);
      marking = settle(withActor(people.ana.token, mark(true)));
      await waitForBlocked("set_work_accommodation");
    } finally {
      submission.release();
    }
    await submission.done;
    // The mark must see the commit it waited for, not its older snapshot.
    expect(await marking).toEqual({ value: null, code: "ZD409" });
    expect(await submitted(documents.ana)).toBe(true);
    expect(await stored()).toEqual([]);
    expect(await withActor(people.ana.token, readMark("ana"))).toBe(false);
    expect(await withActor(people.vesna.token, readMark("ana"))).toBe(false);
  });

  it("mark first: the submission waits on the assignment, then follows with the mark, which is then fixed", async () => {
    const marking = hold(people.dora.token, mark(true));
    let submission: ReturnType<typeof settle<string[]>>;
    try {
      expect(await marking.answered).toBe(true);
      submission = settle(withActor(people.dora.token, submit(documents.dora)));
      await waitForBlocked("request_submission");
      expect(await submitted(documents.dora)).toBe(false);
    } finally {
      marking.release();
    }
    await marking.done;
    expect(await submission).toEqual({ value: ["requested", "recorded"], code: null });
    expect(await submitted(documents.dora)).toBe(true);
    expect(await withActor(people.vesna.token, readMark("dora"))).toBe(true);
    // After the submission request the student may neither unmark nor mark again.
    expect(await settle(withActor(people.dora.token, mark(false)))).toEqual({ value: null, code: "ZD409" });
    expect(await settle(withActor(people.dora.token, mark(true)))).toEqual({ value: null, code: "ZD409" });
    expect(await stored()).toEqual([people.dora.id]);
  });
});

describe("accommodation mark against the removal of the student, over two real connections", () => {
  const marked = (student: Name) => stored().then((ids) => ids.filter((id) => id === people[student].id));

  it("removal while the mark waits on the assignment: the mark sees it and writes nothing", async () => {
    // Another transaction holds the assignment, so the mark waits after its first check.
    const blocker = await admin.connect();
    let marking: ReturnType<typeof settle<boolean>>;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM institution.assignment WHERE id = $1 FOR UPDATE", [assignmentId]);
      marking = settle(withActor(people.mara.token, mark(true)));
      await waitForBlocked("set_work_accommodation");
      // The removal does not wait for the mark and commits first.
      expect(await settle(withActor(people.vesna.token, removeStudent("mara")))).toEqual({ value: true, code: null });
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }
    expect(await marking).toEqual({ value: null, code: "ZD403" });
    expect(await marked("mara")).toEqual([]);
  });

  it("mark first: the removal waits for the mark in progress, after which the student may not change it", async () => {
    const marking = hold(people.tea.token, mark(true));
    let removal: ReturnType<typeof settle<boolean>>;
    try {
      expect(await marking.answered).toBe(true);
      removal = settle(withActor(people.vesna.token, removeStudent("tea")));
      await waitForBlocked("remove_student");
    } finally {
      marking.release();
    }
    await marking.done;
    expect(await removal).toEqual({ value: true, code: null });
    expect(await settle(withActor(people.tea.token, mark(false)))).toEqual({ value: null, code: "ZD403" });
    expect(await marked("tea")).toEqual([people.tea.id]);
    // The removed student's work is no longer the teacher's to see.
    expect(await withActor(people.vesna.token, readMark("tea"))).toBeNull();
  });
});
