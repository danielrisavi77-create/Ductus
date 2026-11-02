import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-442 (D-199, plan of attack #1432, D1 and D2): a child keyed to the
// institution of its parent and a concurrent move of that parent to another
// institution, from two connections and in both orders. Whichever side holds
// the parent's row first, the other waits for it, and no child is ever
// committed with a key other than its parent's. A database of its own, with
// every migration, as dbmate runs them; fak-a, fak-b and every person, course
// and code are random or invented. Loopback only.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The race test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_race_${randomBytes(6).toString("hex")}`;
const ids = {
  facultyA: randomUUID(),
  facultyB: randomUUID(),
  teacherA: randomUUID(),
  teacherB: randomUUID(),
  courseB: randomUUID(),
};
let pool: pg.Pool | undefined;

function db() {
  if (!pool) throw new Error("the race database is not ready");
  return pool;
}

beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const migrator = new pg.Client({ connectionString: url.href, options: "-c role=ductus_migrator" });
  await migrator.connect();
  try {
    const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) await migrator.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
  } finally {
    await migrator.end();
  }
  pool = new pg.Pool({ connectionString: url.href, max: 4 });
  await db().query("INSERT INTO identity.institution (id, slug) VALUES ($1, 'fak-a'), ($2, 'fak-b')", [
    ids.facultyA,
    ids.facultyB,
  ]);
  for (const [id, institution, person] of [
    [ids.teacherA, ids.facultyA, "nastavnik-a"],
    [ids.teacherB, ids.facultyB, "nastavnik-b"],
  ]) {
    await db().query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@test.example')`,
      [id, institution, `sub-${person}`],
    );
  }
  await db().query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, 'K3', '2026/2027', 'prohibited', $3)`,
    [ids.courseB, ids.facultyB, ids.teacherB],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  // pool.end() resolves before its sockets are closed; a forced drop that
  // reaches a connection still closing ends it with 57P01, an error nobody
  // listens for any more. So the drop waits until no backend is left.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1",
      [name],
    );
    if (rows[0]?.n === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

/** A course of fak-a by its teacher, with nothing under it yet. */
async function courseOfA() {
  const id = randomUUID();
  await db().query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1::uuid, $2, 'K-' || $1::text, '2026/2027', 'prohibited', $3)`,
    [id, ids.facultyA, ids.teacherA],
  );
  return id;
}

/** An assignment of fak-a with its first version, keyed from the assignment. */
async function assignmentOfA() {
  const course = await courseOfA();
  const id = randomUUID();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO institution.assignment (id, course_id, institution_id, created_by) VALUES ($1, $2, $3, $4)",
      [id, course, ids.facultyA, ids.teacherA],
    );
    await insertVersion(client, id, 1);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return id;
}

function insertCode(client: pg.PoolClient, course: string) {
  return client.query(
    `INSERT INTO institution.course_enrollment_code (course_id, code_hash, valid_until, created_by)
     VALUES ($1, sha256(convert_to(gen_random_uuid()::text, 'UTF8')), now() + interval '7 days', $2)`,
    [course, ids.teacherA],
  );
}

function insertVersion(client: pg.PoolClient, assignment: string, versionNo: number) {
  return client.query(
    `INSERT INTO institution.assignment_version (
       assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
       evidence_profile, import_allowed, created_by)
     VALUES ($1, $2, 'Zadatak', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
             'prohibited', '{}', 'basic', false, $3)`,
    [assignment, versionNo, ids.teacherA],
  );
}

function moveCourse(client: pg.PoolClient, course: string) {
  return client.query("UPDATE institution.course SET institution_id = $2, created_by = $3 WHERE id = $1", [
    course,
    ids.facultyB,
    ids.teacherB,
  ]);
}

function moveAssignment(client: pg.PoolClient, assignment: string) {
  return client.query(
    "UPDATE institution.assignment SET institution_id = $2, course_id = $3, created_by = $4 WHERE id = $1",
    [assignment, ids.facultyB, ids.courseB, ids.teacherB],
  );
}

/** Resolves once the backend of `client` waits for a lock held by another transaction. */
async function waitsForLock(client: pg.PoolClient) {
  const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
  return async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { rows } = await db().query(
        "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
        [pid],
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`backend ${pid} never waited for a lock`);
  };
}

/** A promise settled to its outcome, so a rejection is awaited rather than left unhandled. */
function settle<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/** Two connections, A and B, each in its own open transaction. */
async function twoTransactions<T>(run: (a: pg.PoolClient, b: pg.PoolClient) => Promise<T>) {
  const a = await db().connect();
  const b = await db().connect();
  try {
    await a.query("BEGIN");
    await b.query("BEGIN");
    return await run(a, b);
  } finally {
    await a.query("ROLLBACK").catch(() => undefined);
    await b.query("ROLLBACK").catch(() => undefined);
    a.release();
    b.release();
  }
}

const MIXED = `
  SELECT 'code' AS child, c.id::text FROM institution.course_enrollment_code c
    JOIN institution.course k ON k.id = c.course_id WHERE c.institution_id <> k.institution_id
  UNION ALL
  SELECT 'version', v.assignment_id::text || '/' || v.version_no FROM institution.assignment_version v
    JOIN institution.assignment a ON a.id = v.assignment_id WHERE v.institution_id <> a.institution_id`;

describe("a child keyed to its parent and a concurrent move of the parent", () => {
  it("D2, A first: the move waits for the new code and fails once it is committed", async () => {
    const course = await courseOfA();
    await twoTransactions(async (a, b) => {
      await insertCode(a, course);
      const blocked = await waitsForLock(b);
      const move = settle(moveCourse(b, course));
      await blocked();
      await a.query("COMMIT");
      const outcome = await move;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error).toMatchObject({
        code: "23503",
        constraint: "course_enrollment_code_course_institution_fkey",
      });
    });
    const { rows } = await db().query(
      `SELECT k.institution_id AS course, c.institution_id AS code FROM institution.course k
       JOIN institution.course_enrollment_code c ON c.course_id = k.id WHERE k.id = $1`,
      [course],
    );
    expect(rows).toEqual([{ course: ids.facultyA, code: ids.facultyA }]);
  });

  it("D2, B first: the new code waits for the move and fails once it is committed", async () => {
    const course = await courseOfA();
    await twoTransactions(async (a, b) => {
      await moveCourse(b, course);
      const blocked = await waitsForLock(a);
      const code = settle(insertCode(a, course));
      await blocked();
      await b.query("COMMIT");
      const outcome = await code;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error).toMatchObject({
        code: "23503",
        constraint: "course_enrollment_code_course_institution_fkey",
      });
    });
    const { rows } = await db().query(
      `SELECT k.institution_id AS course, count(c.id)::int AS codes FROM institution.course k
       LEFT JOIN institution.course_enrollment_code c ON c.course_id = k.id WHERE k.id = $1 GROUP BY k.institution_id`,
      [course],
    );
    expect(rows).toEqual([{ course: ids.facultyB, codes: 0 }]);
  });

  it("D1, A first: the move waits for the new version and fails once it is committed", async () => {
    const assignment = await assignmentOfA();
    await twoTransactions(async (a, b) => {
      await insertVersion(a, assignment, 2);
      const blocked = await waitsForLock(b);
      const move = settle(moveAssignment(b, assignment));
      await blocked();
      await a.query("COMMIT");
      const outcome = await move;
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error).toMatchObject({
        code: "23503",
        constraint: "assignment_version_assignment_institution_fkey",
      });
    });
    const { rows } = await db().query(
      `SELECT a.institution_id AS assignment, v.version_no, v.institution_id AS version FROM institution.assignment a
       JOIN institution.assignment_version v ON v.assignment_id = a.id WHERE a.id = $1 ORDER BY v.version_no`,
      [assignment],
    );
    expect(rows).toEqual([
      { assignment: ids.facultyA, version_no: 1, version: ids.facultyA },
      { assignment: ids.facultyA, version_no: 2, version: ids.facultyA },
    ]);
  });

  it("D1, B first: the move fails on the version the assignment has, and the new version keeps fak-a", async () => {
    // An assignment always has its first version, keyed to it, so a move
    // fails at the end of its own statement and never holds the row for A;
    // the new version then takes the institution the assignment still has.
    const assignment = await assignmentOfA();
    await twoTransactions(async (a, b) => {
      const move = await settle(moveAssignment(b, assignment));
      expect(move.ok).toBe(false);
      expect(move.ok ? undefined : move.error).toMatchObject({
        code: "23503",
        constraint: "assignment_version_assignment_institution_fkey",
      });
      await insertVersion(a, assignment, 2);
      await a.query("COMMIT");
      await b.query("ROLLBACK");
    });
    const { rows } = await db().query(
      `SELECT a.institution_id AS assignment, v.version_no, v.institution_id AS version FROM institution.assignment a
       JOIN institution.assignment_version v ON v.assignment_id = a.id WHERE a.id = $1 ORDER BY v.version_no`,
      [assignment],
    );
    expect(rows).toEqual([
      { assignment: ids.facultyA, version_no: 1, version: ids.facultyA },
      { assignment: ids.facultyA, version_no: 2, version: ids.facultyA },
    ]);
  });

  it("after every race, no code and no version carries a key other than its parent's", async () => {
    expect((await db().query(MIXED)).rows).toEqual([]);
    const { rows } = await db().query<{ n: number }>(
      `SELECT (SELECT count(*) FROM institution.course_enrollment_code)::int
            + (SELECT count(*) FROM institution.assignment_version)::int AS n`,
    );
    expect(rows[0]?.n).toBeGreaterThan(0);
  });
});
