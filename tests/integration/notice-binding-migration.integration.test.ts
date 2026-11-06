import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-306, M2.13-P03 (contract on #1091, c.6685108734): the binding migration
// runs over acknowledgments from before it, then down and up again; no
// acknowledgment is lost or changed but for the new column, and each gets the
// binding its fingerprint gives. Istodobnost: an acknowledgment written while
// the migration runs, before or after its lock, ends with the binding its
// fingerprint gives, whatever binding it names. pgTAP sees only the finished
// schema (db/tests/111); here a database of its own is migrated up to the one
// before. Every identifier is random.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261106170000_notice_acknowledgment_binding.sql";
const FINGERPRINT = "a".repeat(64);

function section(file: string, direction: "up" | "down"): string {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down <= up) throw new Error(`${file} is not a dbmate migration`);
  return direction === "up" ? text.slice(up, down) : text.slice(down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const clients: pg.Client[] = [];
const databases: string[] = [];

async function connect(name: string): Promise<pg.Client> {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  clients.push(client);
  return client;
}

/** A database of its own, migrated up to the one before TARGET. */
async function databaseBefore(): Promise<string> {
  const name = `ductus_binding_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  databases.push(name);
  const db = await connect(name);
  const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
  for (const file of earlier) await migrate(db, section(file, "up"));
  return name;
}

async function migrate(db: pg.Client, sql: string): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE ductus_migrator");
    await db.query(sql);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

/** Waits until the backend `pid` waits on a lock; the test fails if it never does. Take the pid before the
 * client is busy: a client runs one query at a time. */
async function waitsOnLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await admin.query<{ waiting: boolean }>(
      "SELECT coalesce(bool_or(wait_event_type = 'Lock'), false) AS waiting FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (rows[0]!.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

const pidOf = async (db: pg.Client) => (await db.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;

/** An assignment version and a student to acknowledge it, written in replica mode (no foreign keys). */
async function parents(db: pg.Client): Promise<{ institution: string; assignment: string; students: string[] }> {
  const institution = randomUUID();
  const assignment = randomUUID();
  const teacher = randomUUID();
  const students = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.query("BEGIN");
  await db.query("SET LOCAL session_replication_role = replica");
  for (const user of [teacher, ...students]) {
    await db.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@fak.example')`,
      [user, institution, user],
    );
  }
  await db.query(
    "INSERT INTO institution.assignment (id, course_id, institution_id, created_by) VALUES ($1, $2, $3, $4)",
    [assignment, randomUUID(), institution, teacher],
  );
  await db.query(
    `INSERT INTO institution.assignment_version (assignment_id, version_no, title, instructions, work_type, opens_at,
       due_at, ai_policy, ai_purposes, evidence_profile, import_allowed, created_by, institution_id)
     VALUES ($1, 1, 'Z', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days', 'prohibited',
       '{}', 'basic', false, $2, $3)`,
    [assignment, teacher, institution],
  );
  await db.query("COMMIT");
  return { institution, assignment, students };
}

/** Writes one acknowledgment of version 1; `binding` names the column only when given. */
function acknowledge(
  db: pg.Client,
  ids: { institution: string; assignment: string },
  student: string,
  fingerprinted: boolean,
  binding?: string,
) {
  const column = binding === undefined ? "" : ", notice_binding";
  const value = binding === undefined ? "" : ", $6";
  const params: unknown[] = [ids.assignment, student, ids.institution, fingerprinted ? 1 : null, fingerprinted ? FINGERPRINT : null];
  if (binding !== undefined) params.push(binding);
  return db.query(
    `INSERT INTO institution.notice_acknowledgment
       (assignment_id, version_no, student_id, institution_id, notice_template_version, notice_fingerprint${column})
     VALUES ($1, 1, $2, $3, $4, $5${value})`,
    params,
  );
}

const bindings = async (db: pg.Client) =>
  (await db.query<{ row: string }>(
    `SELECT concat_ws('|', student_id, coalesce(notice_fingerprint, '-'), notice_binding) AS row
       FROM institution.notice_acknowledgment ORDER BY student_id`,
  )).rows.map((r) => r.row);
const expected = (rows: Array<[string, boolean]>) =>
  rows
    .map(([student, fingerprinted]) => `${student}|${fingerprinted ? FINGERPRINT : "-"}|${fingerprinted ? "bound" : "legacy_unverified"}`)
    .sort();

afterAll(async () => {
  for (const client of clients) await client.end().catch(() => undefined);
  for (const name of databases) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe("the notice binding migration over acknowledgments from before it", () => {
  it("keeps every acknowledgment on up, down and up, and binds exactly those with a fingerprint", async () => {
    const db = await connect(await databaseBefore());
    const institution = randomUUID();
    const assignment = randomUUID();
    const rowsBefore: Array<[string, boolean]> = [[randomUUID(), false], [randomUUID(), false], [randomUUID(), false], [randomUUID(), true]];
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    for (const [index, [student, fingerprinted]] of rowsBefore.entries()) {
      await db.query(
        `INSERT INTO institution.notice_acknowledgment
           (assignment_id, version_no, student_id, institution_id, acknowledged_at, notice_template_version, notice_fingerprint)
         VALUES ($1, 1, $2, $3, now() - make_interval(days => $4), $5, $6)`,
        [assignment, student, institution, 9 - index, fingerprinted ? 1 : null, fingerprinted ? FINGERPRINT : null],
      );
    }
    await db.query("COMMIT");

    const rows = async () => (await db.query<{ row: string }>(
      `SELECT concat_ws('|', assignment_id, version_no, student_id, institution_id, acknowledged_at,
                        coalesce(notice_template_version::text, '-'), coalesce(notice_fingerprint, '-')) AS row
         FROM institution.notice_acknowledgment ORDER BY acknowledged_at`,
    )).rows.map((r) => r.row);
    const hasBinding = async () => (await db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'institution.notice_acknowledgment'::regclass
                        AND attname = 'notice_binding' AND NOT attisdropped) AS ok`,
    )).rows[0]!.ok;
    const before = await rows();
    expect(before).toHaveLength(4);
    expect(await hasBinding()).toBe(false);

    await migrate(db, section(TARGET, "up"));
    expect(await rows()).toEqual(before);
    expect(await bindings(db)).toEqual(expected(rowsBefore));

    await migrate(db, section(TARGET, "down"));
    expect(await rows()).toEqual(before);
    expect(await hasBinding()).toBe(false);

    await migrate(db, section(TARGET, "up"));
    expect(await rows()).toEqual(before);
    expect(await bindings(db)).toEqual(expected(rowsBefore));
  });

  it("refuses to finish when a fingerprinted row would stay legacy_unverified (the CHECK holds the UPDATE)", async () => {
    const db = await connect(await databaseBefore());
    const ids = await parents(db);
    await acknowledge(db, ids, ids.students[0]!, true);
    const up = section(TARGET, "up");
    const withoutUpdate = up.replace(/^UPDATE institution\.notice_acknowledgment SET notice_binding = 'bound'.*$/m, "");
    expect(withoutUpdate).not.toEqual(up);
    await expect(migrate(db, withoutUpdate)).rejects.toMatchObject({ code: "23514" });
    await migrate(db, up);
    expect(await bindings(db)).toEqual(expected([[ids.students[0]!, true]]));
  });
});

describe("Istodobnost: acknowledgments written while the migration runs", () => {
  it("binds a row committed while the migration waits for its lock", async () => {
    const name = await databaseBefore();
    const migrator = await connect(name);
    const writer = await connect(name);
    const ids = await parents(migrator);
    const pid = await pidOf(migrator);

    await writer.query("BEGIN");
    await acknowledge(writer, ids, ids.students[0]!, true);
    await acknowledge(writer, ids, ids.students[1]!, false);
    const migration = migrate(migrator, section(TARGET, "up"));
    await waitsOnLock(pid);
    await writer.query("COMMIT");
    await migration;

    expect(await bindings(migrator)).toEqual(expected([[ids.students[0]!, true], [ids.students[1]!, false]]));
  });

  it("derives the binding of a row that waited for the migration, whatever binding it names", async () => {
    const name = await databaseBefore();
    const migrator = await connect(name);
    const writers = [await connect(name), await connect(name)];
    const ids = await parents(migrator);
    const pids = [await pidOf(writers[0]!), await pidOf(writers[1]!)];

    await migrator.query("BEGIN");
    await migrator.query("SET LOCAL ROLE ductus_migrator");
    await migrator.query(section(TARGET, "up"));
    const named = [
      acknowledge(writers[0]!, ids, ids.students[2]!, true, "legacy_unverified"),
      acknowledge(writers[1]!, ids, ids.students[3]!, false, "bound"),
    ];
    for (const pid of pids) await waitsOnLock(pid);
    await migrator.query("COMMIT");
    await Promise.all(named);

    expect(await bindings(migrator)).toEqual(expected([[ids.students[2]!, true], [ids.students[3]!, false]]));
  });
});
