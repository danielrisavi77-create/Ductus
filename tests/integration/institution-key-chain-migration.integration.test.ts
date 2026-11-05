import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// The institution key chain migration (DAN-442, D-199) over rows that predate
// it, against the compose stack (pnpm stack:up, pnpm db:migrate). As in
// institution-key-migration.integration.test.ts, each case gets a database of
// its own, migrated up to the one before the chain, filled with rows written
// without the key on versions and enrollment codes, and only then given the
// migration as dbmate runs it: the up section in one transaction, as
// ductus_migrator. Every institution, person, course and code is random or
// invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261103100000_institution_key_chain.sql";

/** The up section of a dbmate migration file. */
function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const created: { name: string; clients: pg.Client[] }[] = [];
// The connection dbmate would use: role=ductus_migrator in the URL, so that a
// RESET ROLE inside a migration returns to the migrator, which
// 20261101201000_roles_check.sql requires.
const migrators = new WeakMap<pg.Client, pg.Client>();

afterEach(async () => {
  for (const { name, clients } of created.splice(0)) {
    for (const client of clients) await client.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  }
});
afterAll(() => admin.end());

/**
 * A database of its own, migrated up to the one before the chain. The client
 * returned is the compose superuser, which writes the old rows.
 */
async function beforeTheChain() {
  const name = `ductus_chain_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  const migrator = new pg.Client({ connectionString: url.href, options: "-c role=ductus_migrator" });
  created.push({ name, clients: [client, migrator] });
  await client.connect();
  await migrator.connect();
  migrators.set(client, migrator);
  const earlier = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql") && file < TARGET)
    .sort();
  for (const file of earlier) await migrator.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
  return client;
}

/** Runs the chain migration the way dbmate does; on failure nothing of it stays. */
async function migrate(client: pg.Client) {
  const migrator = migrators.get(client);
  if (!migrator) throw new Error("no migrator connection for this database");
  await migrator.query("BEGIN");
  try {
    await migrator.query(upSection(TARGET));
    await migrator.query("COMMIT");
  } catch (error) {
    await migrator.query("ROLLBACK");
    throw error;
  }
}

type Ids = Awaited<ReturnType<typeof oldRows>>;

/**
 * Old rows, written as the compose superuser past every function, as the
 * schema before the chain allowed them: fak-a has K1 with Z1 (two versions)
 * and a revoked and an active code, fak-b has K3 with Z3 and one code; the
 * revocation left an audit event of fak-a. Z1 points at version 2, as the
 * RPC that adds a version leaves it. Of the students of fak-a, A1 acknowledged
 * the notice of version 1 of Z1 (an earlier one) and A2 that of version 2 (the
 * current one); student B of fak-b acknowledged that of Z3.
 */
async function oldRows(client: pg.Client) {
  const ids = {
    facultyA: randomUUID(),
    facultyB: randomUUID(),
    teacherA: randomUUID(),
    teacherB: randomUUID(),
    studentA: randomUUID(),
    studentA2: randomUUID(),
    studentB: randomUUID(),
    courseA: randomUUID(),
    courseB: randomUUID(),
    assignmentA: randomUUID(),
    assignmentB: randomUUID(),
    oldCodeA: randomUUID(),
    codeA: randomUUID(),
    codeB: randomUUID(),
  };
  await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, 'fak-a'), ($2, 'fak-b')", [
    ids.facultyA,
    ids.facultyB,
  ]);
  for (const [id, institution, name] of [
    [ids.teacherA, ids.facultyA, "nastavnik-a"],
    [ids.teacherB, ids.facultyB, "nastavnik-b"],
    [ids.studentA, ids.facultyA, "student-a"],
    [ids.studentA2, ids.facultyA, "student-a2"],
    [ids.studentB, ids.facultyB, "student-b"],
  ]) {
    await client.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@test.example')`,
      [id, institution, `sub-${name}`],
    );
  }
  await client.query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, 'K1', '2026/2027', 'prohibited', $3), ($4, $5, 'K3', '2026/2027', 'prohibited', $6)`,
    [ids.courseA, ids.facultyA, ids.teacherA, ids.courseB, ids.facultyB, ids.teacherB],
  );
  await assignment(client, ids.assignmentA, ids.courseA, ids.facultyA, ids.teacherA);
  await version(client, ids.assignmentA, 2, ids.teacherA);
  await client.query("UPDATE institution.assignment SET current_version = 2 WHERE id = $1", [ids.assignmentA]);
  await assignment(client, ids.assignmentB, ids.courseB, ids.facultyB, ids.teacherB);
  await code(client, ids.oldCodeA, ids.courseA, ids.teacherA, false);
  await code(client, ids.codeA, ids.courseA, ids.teacherA, true);
  await code(client, ids.codeB, ids.courseB, ids.teacherB, true);
  await codeEvent(client, ids.facultyA, ids.courseA, ids.oldCodeA, ids.teacherA);
  await acknowledgment(client, ids.assignmentA, 1, ids.studentA, ids.facultyA);
  await acknowledgment(client, ids.assignmentA, 2, ids.studentA2, ids.facultyA);
  await acknowledgment(client, ids.assignmentB, 1, ids.studentB, ids.facultyB);
  return ids;
}

/** An assignment with its first version, which its pointer needs by the end of the transaction. */
async function assignment(client: pg.Client, id: string, course: string, institution: string, author: string) {
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO institution.assignment (id, course_id, institution_id, created_by) VALUES ($1, $2, $3, $4)",
    [id, course, institution, author],
  );
  await version(client, id, 1, author);
  await client.query("COMMIT");
}

async function version(client: pg.Client, assignmentId: string, versionNo: number, author: string) {
  await client.query(
    `INSERT INTO institution.assignment_version (
       assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
       evidence_profile, import_allowed, created_by)
     VALUES ($1, $2, 'Zadatak', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
             'prohibited', '{}', 'basic', false, $3)`,
    [assignmentId, versionNo, author],
  );
}

async function code(client: pg.Client, id: string, course: string, author: string, active: boolean) {
  await client.query(
    `INSERT INTO institution.course_enrollment_code (id, course_id, code_hash, valid_until, active, created_by)
     VALUES ($1::uuid, $2, sha256(convert_to($1::text, 'UTF8')), now() + interval '7 days', $3, $4)`,
    [id, course, active, author],
  );
}

async function codeEvent(client: pg.Client, institution: string, course: string, codeId: string, actor: string) {
  await client.query(
    `INSERT INTO audit.enrollment_code_event (institution_id, course_id, code_id, kind, actor_id, occurred_at)
     VALUES ($1, $2, $3, 'revoked', $4, now())`,
    [institution, course, codeId, actor],
  );
}

async function acknowledgment(
  client: pg.Client,
  assignmentId: string,
  versionNo: number,
  student: string,
  institution: string,
) {
  await client.query(
    `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id, acknowledged_at)
     VALUES ($1, $2, $3, $4, now() - interval '1 day')`,
    [assignmentId, versionNo, student, institution],
  );
}

const VERSIONS = "SELECT * FROM institution.assignment_version ORDER BY assignment_id, version_no";
const CODES = "SELECT * FROM institution.course_enrollment_code ORDER BY id";
const EVENTS = "SELECT * FROM audit.enrollment_code_event ORDER BY id";
const ACKS = "SELECT * FROM institution.notice_acknowledgment ORDER BY assignment_id, version_no, student_id";
// Acknowledgments whose key differs from that of the version they acknowledge.
const ACKS_OFF_KEY = `
  SELECT n.* FROM institution.notice_acknowledgment n
  JOIN institution.assignment_version v USING (assignment_id, version_no)
  WHERE n.institution_id IS DISTINCT FROM v.institution_id`;
// Acknowledgments that still reach their version under the full key the chain
// adds, and whose key is also that of their assignment.
const ACKS_ON_KEY = `
  SELECT n.* FROM institution.notice_acknowledgment n
  JOIN institution.assignment_version v USING (assignment_id, version_no, institution_id)
  JOIN institution.assignment a ON a.id = n.assignment_id AND a.institution_id = n.institution_id
  ORDER BY assignment_id, version_no, student_id`;

/** Every old acknowledgment is kept as it was and reaches its version under the full key. */
async function expectAcksKept(client: pg.Client, acksBefore: unknown[]) {
  expect((await client.query(ACKS)).rows).toEqual(acksBefore);
  expect((await client.query(ACKS_OFF_KEY)).rows).toEqual([]);
  expect((await client.query(ACKS_ON_KEY)).rows).toEqual(acksBefore);
}

// Each acknowledgment with the version its assignment points at.
const ACKS_BY_CURRENT = `
  SELECT n.student_id, n.version_no, a.current_version FROM institution.notice_acknowledgment n
  JOIN institution.assignment a ON a.id = n.assignment_id
  ORDER BY n.assignment_id, n.version_no, n.student_id`;

const KEY_COLUMNS = `
  SELECT table_name FROM information_schema.columns
  WHERE table_schema = 'institution' AND table_name IN ('assignment_version', 'course_enrollment_code')
    AND column_name = 'institution_id'`;

describe("the institution key chain migration over old rows", () => {
  it("gives every old version and code the institution of its parent and keeps the rest of it", async () => {
    const client = await beforeTheChain();
    const ids = await oldRows(client);
    const versionsBefore = (await client.query(VERSIONS)).rows;
    const codesBefore = (await client.query(CODES)).rows;
    const eventsBefore = (await client.query(EVENTS)).rows;
    const acksBefore = (await client.query(ACKS)).rows;
    const acksByCurrentBefore = (await client.query(ACKS_BY_CURRENT)).rows;

    await migrate(client);

    const versions = (await client.query(VERSIONS)).rows;
    expect(versions).toEqual(
      versionsBefore.map((row) => ({
        ...row,
        institution_id: row.assignment_id === ids.assignmentA ? ids.facultyA : ids.facultyB,
      })),
    );
    const codes = (await client.query(CODES)).rows;
    expect(codes).toEqual(
      codesBefore.map((row) => ({
        ...row,
        institution_id: row.course_id === ids.courseA ? ids.facultyA : ids.facultyB,
      })),
    );
    expect((await client.query(EVENTS)).rows).toEqual(eventsBefore);
    await expectAcksKept(client, acksBefore);
    expect(versions).toHaveLength(3);
    expect(codes).toHaveLength(3);
    expect(eventsBefore).toHaveLength(1);
    expect(acksBefore.map((row) => [row.student_id, row.institution_id])).toEqual(
      expect.arrayContaining([
        [ids.studentA, ids.facultyA],
        [ids.studentA2, ids.facultyA],
        [ids.studentB, ids.facultyB],
      ]),
    );
    expect(acksBefore.map((row) => [row.student_id, row.version_no])).toEqual(
      expect.arrayContaining([
        [ids.studentA, 1],
        [ids.studentA2, 2],
      ]),
    );
    expect(acksBefore).toHaveLength(3);
    // A1 acknowledged an earlier version than the one Z1 points at and A2 the
    // current one, before the migration and after it.
    expect(acksByCurrentBefore).toEqual(
      expect.arrayContaining([
        { student_id: ids.studentA, version_no: 1, current_version: 2 },
        { student_id: ids.studentA2, version_no: 2, current_version: 2 },
      ]),
    );
    expect((await client.query(ACKS_BY_CURRENT)).rows).toEqual(acksByCurrentBefore);
  });

  it.each([
    {
      what: "an old acknowledgment is lost",
      change: (client: pg.Client, ids: Ids) =>
        client.query("DELETE FROM institution.notice_acknowledgment WHERE student_id = $1", [ids.studentB]),
    },
    {
      what: "the acknowledgment of a version earlier than the current one is lost",
      change: (client: pg.Client) =>
        client.query(
          `DELETE FROM institution.notice_acknowledgment n USING institution.assignment a
           WHERE a.id = n.assignment_id AND n.version_no < a.current_version`,
        ),
    },
    {
      what: "an old acknowledgment changes its time",
      change: (client: pg.Client, ids: Ids) =>
        client.query(
          `UPDATE institution.notice_acknowledgment SET acknowledged_at = acknowledged_at + interval '1 second'
           WHERE assignment_id = $1 AND version_no = 1`,
          [ids.assignmentA],
        ),
    },
    {
      what: "an old acknowledgment moves to another version of the same institution",
      change: (client: pg.Client, ids: Ids) =>
        client.query(
          `UPDATE institution.notice_acknowledgment SET version_no = 1
           WHERE assignment_id = $1 AND student_id = $2 AND version_no = 2`,
          [ids.assignmentA, ids.studentA2],
        ),
    },
  ])("the acknowledgment check fails when $what after the migration", async ({ change }) => {
    const client = await beforeTheChain();
    const ids = await oldRows(client);
    const acksBefore = (await client.query(ACKS)).rows;
    await migrate(client);
    await expectAcksKept(client, acksBefore);

    expect((await change(client, ids)).rowCount).toBe(1);

    await expect(expectAcksKept(client, acksBefore)).rejects.toThrow();
  });

  it.each([
    {
      what: "a version of an assignment of fak-a whose author belongs to fak-b",
      constraint: "assignment_version_created_by_institution_fkey",
      write: (client: pg.Client, ids: Ids) => version(client, ids.assignmentA, 3, ids.teacherB),
    },
    {
      what: "an enrollment code of a course of fak-a made by a teacher of fak-b",
      constraint: "course_enrollment_code_created_by_institution_fkey",
      write: (client: pg.Client, ids: Ids) => code(client, randomUUID(), ids.courseA, ids.teacherB, false),
    },
    {
      what: "an audit event of fak-b about a code of a course of fak-a",
      constraint: "enrollment_code_event_code_institution_fkey",
      write: (client: pg.Client, ids: Ids) => codeEvent(client, ids.facultyB, ids.courseB, ids.codeA, ids.teacherB),
    },
  ])("refuses $what as a whole and leaves the old schema", async ({ constraint, write }) => {
    const client = await beforeTheChain();
    const ids = await oldRows(client);
    await write(client, ids);
    const versionsBefore = (await client.query(VERSIONS)).rows;
    const codesBefore = (await client.query(CODES)).rows;
    const eventsBefore = (await client.query(EVENTS)).rows;
    const acksBefore = (await client.query(ACKS)).rows;

    await expect(migrate(client)).rejects.toMatchObject({ code: "23503", constraint });

    expect((await client.query(KEY_COLUMNS)).rows).toEqual([]);
    expect((await client.query(VERSIONS)).rows).toEqual(versionsBefore);
    expect((await client.query(CODES)).rows).toEqual(codesBefore);
    expect((await client.query(EVENTS)).rows).toEqual(eventsBefore);
    expect((await client.query(ACKS)).rows).toEqual(acksBefore);
  });
});
