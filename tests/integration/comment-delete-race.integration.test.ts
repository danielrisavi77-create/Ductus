import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-215 (M6.1-P03, contract on #1836, attack plan #1886, items N8 and N9):
// pgTAP runs in one transaction and cannot race two calls. Here two real
// connections race a student's deletion against a second deletion of the same
// comment and against the teacher's reply. delete_comment and reply_comment
// both lock the thread row first, so the second call waits and then sees the
// first one's commit. Every person, course and text is invented; random ids of
// one random institution, removed afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The comment deletion race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_comment_delete_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 4, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const courseId = randomUUID();
const assignmentId = randomUUID();
const names = ["vesna", "ana"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;
const document = `doc-ana-${suffix}`;
const TEXT = `{"nodes":[{"children":[{"text":"Izmisljeni tekst ${suffix}.","type":"text"}],"id":"00000000-0000-4000-8000-000000000001","type":"paragraph"}],"schemaVersion":1}`;
const HASH = createHash("sha256").update(TEXT, "utf8").digest("hex");
const ANCHOR = { nodeId: "0f0e0d0c-0b0a-4000-8000-000000000001", quote: "prvi odlomak", prefix: "", suffix: " teksta", startHint: 0, endHint: 12 };

const open = (body: string) => async (tx: ActorTransaction) => (await tx.query<{ id: string }>(
  "SELECT collaboration.create_comment($1, $2, $3::jsonb) AS id", [document, body, JSON.stringify(ANCHOR)])).rows[0].id;
const reply = (thread: string, body: string) => async (tx: ActorTransaction) => (await tx.query<{ id: string }>(
  "SELECT collaboration.reply_comment($1::uuid, $2) AS id", [thread, body])).rows[0].id;
const remove = (comment: string) => async (tx: ActorTransaction) => {
  await tx.query("SELECT collaboration.delete_comment($1::uuid)", [comment]);
  return "deleted";
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

type Stored = { position: number; author_role: string; body: string | null; deleted: boolean };
/** The thread's state and its comments in order, read as the table holds them. */
async function stored(thread: string) {
  const state = (await admin.query<{ state: string }>("SELECT state FROM collaboration.comment_thread WHERE id = $1", [thread])).rows[0].state;
  const comments = (await admin.query<Stored>(
    `SELECT position, author_role, body, deleted_at IS NOT NULL AS deleted
       FROM collaboration.comment WHERE thread_id = $1 ORDER BY position`, [thread])).rows;
  return { state, comments };
}
const firstComment = async (thread: string) => (await admin.query<{ id: string }>(
  "SELECT id FROM collaboration.comment WHERE thread_id = $1 AND position = 1", [thread])).rows[0].id;

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-comment-delete-${suffix}`]);
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
    await client.query("INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignmentId, people.ana.id, institutionId]);
    await client.query("INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
      [`project-${document}`, institutionId, assignmentId, people.ana.id]);
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
       VALUES ($1, $2, $3, $4, 1, $5)`, [document, institutionId, `project-${document}`, people.ana.id, HASH]);
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
       VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, institutionId, people.ana.id, "a".repeat(64), HASH]);
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
    for (const table of ["collaboration.comment", "collaboration.comment_thread", "audit.access_log",
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

describe("a student's comment deletion, over two real connections", () => {
  it("two deletions of one comment: the second waits on the thread, then is a conflict; exactly one deletes", async () => {
    const thread = await withActor(people.ana.token, open("Ovdje nisam siguran u izvor."));
    const comment = await firstComment(thread);
    const first = hold(people.ana.token, remove(comment));
    let second: ReturnType<typeof settle<string>>;
    try {
      expect(await first.answered).toBe("deleted");
      second = settle(withActor(people.ana.token, remove(comment)));
      await waitForBlocked("delete_comment");
    } finally {
      first.release();
    }
    expect(await first.done).toBe("deleted");
    // The second call must see the deletion it waited for, not its older snapshot.
    expect(await second).toEqual({ value: null, code: "ZD409" });
    expect(await stored(thread)).toEqual({
      state: "answered",
      comments: [{ position: 1, author_role: "student", body: null, deleted: true }],
    });
  });

  it("deletion first: the teacher's reply waits, then follows at the next position and opens the thread", async () => {
    const thread = await withActor(people.ana.token, open("Je li ovaj odlomak predug?"));
    const comment = await firstComment(thread);
    const deletion = hold(people.ana.token, remove(comment));
    let answering: ReturnType<typeof settle<string>>;
    try {
      await deletion.answered;
      answering = settle(withActor(people.vesna.token, reply(thread, "Skrati ga za trecinu.")));
      await waitForBlocked("reply_comment");
    } finally {
      deletion.release();
    }
    await deletion.done;
    expect((await answering).code).toBeNull();
    expect(await stored(thread)).toEqual({
      state: "open",
      comments: [
        { position: 1, author_role: "student", body: null, deleted: true },
        { position: 2, author_role: "teacher", body: "Skrati ga za trecinu.", deleted: false },
      ],
    });
  });

  it("reply first: the deletion waits, then removes only the student's text and leaves the state", async () => {
    const thread = await withActor(people.ana.token, open("Trebam li ovdje navesti autora?"));
    const comment = await firstComment(thread);
    const answering = hold(people.vesna.token, reply(thread, "Da, prezime i godinu."));
    let deletion: ReturnType<typeof settle<string>>;
    try {
      await answering.answered;
      deletion = settle(withActor(people.ana.token, remove(comment)));
      await waitForBlocked("delete_comment");
    } finally {
      answering.release();
    }
    await answering.done;
    expect(await deletion).toEqual({ value: "deleted", code: null });
    expect(await stored(thread)).toEqual({
      state: "open",
      comments: [
        { position: 1, author_role: "student", body: null, deleted: true },
        { position: 2, author_role: "teacher", body: "Da, prezime i godinu.", deleted: false },
      ],
    });
  });

  it("the student's reply and its deletion against a teacher's reply keep the positions contiguous", async () => {
    const thread = await withActor(people.vesna.token, open("Dodaj izvor za ovu tvrdnju."));
    const own = await withActor(people.ana.token, reply(thread, "Dodala sam izvor."));
    const deletion = hold(people.ana.token, remove(own));
    let answering: ReturnType<typeof settle<string>>;
    try {
      await deletion.answered;
      answering = settle(withActor(people.vesna.token, reply(thread, "Gdje je izvor?")));
      await waitForBlocked("reply_comment");
    } finally {
      deletion.release();
    }
    await deletion.done;
    expect((await answering).code).toBeNull();
    expect(await stored(thread)).toEqual({
      state: "open",
      comments: [
        { position: 1, author_role: "teacher", body: "Dodaj izvor za ovu tvrdnju.", deleted: false },
        { position: 2, author_role: "student", body: null, deleted: true },
        { position: 3, author_role: "teacher", body: "Gdje je izvor?", deleted: false },
      ],
    });
  });
});
