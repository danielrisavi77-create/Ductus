import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-215, QA N22 on #1899: the down section of the student thread and delete
// migration. With no deleted comment it runs, keeps every thread (a student's
// too) and every comment, and puts back the functions, grants and table rules
// from before; with a deleted comment it refuses and changes nothing, also when
// the deletion commits while the down section is already running. pgTAP sees
// only the finished schema; here a database of its own is migrated up to the
// one before, and each section runs in one transaction as ductus_migrator, as
// dbmate runs it. Rows are written as the compose superuser in replica mode,
// which skips the foreign keys: only the two comment tables matter. Every
// identifier is random and every text invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261111120000_comment_student_thread_delete.sql";
const ANCHOR = JSON.stringify({
  nodeId: "0f0e0d0c-0b0a-4000-8000-000000000001", quote: "prvi odlomak", prefix: "", suffix: " teksta",
  startHint: 0, endHint: 12,
});

function section(file: string, direction: "up" | "down"): string {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down <= up) throw new Error(`${file} is not a dbmate migration`);
  return direction === "up" ? text.slice(up, down) : text.slice(down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_comment_${randomBytes(6).toString("hex")}`;
const clients: pg.Client[] = [];

async function connect(): Promise<pg.Client> {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  clients.push(client);
  return client;
}

async function migrate(db: pg.Client, file: string, direction: "up" | "down"): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL ROLE ductus_migrator");
    await db.query(section(file, direction));
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

// Everything the migration touches: the rows, the collaboration functions with
// their bodies and grants, the comment table's columns and rules, and who may
// create in the schema.
async function snapshot(db: pg.Client) {
  const all = async (sql: string) => (await db.query<{ v: string }>(sql)).rows.map((r) => r.v);
  return {
    threads: await all(
      `SELECT concat_ws('|', id, institution_id, document_id, assignment_id, owner_id, anchor, state, created_by,
                        created_at, updated_at) AS v
         FROM collaboration.comment_thread ORDER BY id`,
    ),
    comments: await all(
      `SELECT concat_ws('|', id, thread_id, institution_id, position, author_id, author_role,
                        coalesce(body, '<null>'), created_at, to_jsonb(c) -> 'deleted_at') AS v
         FROM collaboration.comment c ORDER BY id`,
    ),
    functions: await all(
      `SELECT p.oid::regprocedure::text || E'\\n' || coalesce(p.proacl::text, '<default>') || E'\\n'
              || pg_get_functiondef(p.oid) AS v
         FROM pg_proc p WHERE p.pronamespace = 'collaboration'::regnamespace ORDER BY 1`,
    ),
    columns: await all(
      `SELECT attname || ' ' || format_type(atttypid, atttypmod) || ' ' || attnotnull AS v
         FROM pg_attribute WHERE attrelid = 'collaboration.comment'::regclass AND attnum > 0 AND NOT attisdropped
         ORDER BY attname`,
    ),
    constraints: await all(
      `SELECT conname || ' ' || pg_get_constraintdef(oid) AS v
         FROM pg_constraint WHERE conrelid = 'collaboration.comment'::regclass ORDER BY conname`,
    ),
    schemaAcl: await all("SELECT nspacl::text AS v FROM pg_namespace WHERE nspname = 'collaboration'"),
  };
}

const exists = async (db: pg.Client, regprocedure: string) =>
  (await db.query<{ ok: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS ok", [regprocedure])).rows[0]!.ok;

afterAll(async () => {
  for (const client of clients) await client.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe("the student thread and delete migration, rolled back", () => {
  const institution = randomUUID();
  const assignment = randomUUID();
  const teacher = randomUUID();
  const student = randomUUID();
  const teacherThread = randomUUID();
  const studentThread = randomUUID();
  const studentReply = randomUUID();
  const studentOpening = randomUUID();
  let beforeUp: Awaited<ReturnType<typeof snapshot>>;
  let afterUp: Awaited<ReturnType<typeof snapshot>>;

  it("with no deleted comment runs and keeps every thread, a student's too", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const db = await connect();
    const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
    for (const file of earlier) await migrate(db, file, "up");
    beforeUp = await snapshot(db);

    await migrate(db, TARGET, "up");
    // A teacher's thread with the student's reply, and a thread the student
    // opened, as create_comment and reply_comment write them after this migration.
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query(
      `INSERT INTO collaboration.comment_thread
         (id, institution_id, document_id, assignment_id, owner_id, anchor, state, created_by, created_at)
       VALUES ($1, $3, 'dokument-izmisljen', $4, $6, $7, 'open', $5, now() - interval '2 hours'),
              ($2, $3, 'dokument-izmisljen', $4, $6, $7, 'answered', $6, now() - interval '1 hour')`,
      [teacherThread, studentThread, institution, assignment, teacher, student, ANCHOR],
    );
    await db.query(
      `INSERT INTO collaboration.comment (id, thread_id, institution_id, position, author_id, author_role, body, created_at)
       VALUES (gen_random_uuid(), $1, $3, 1, $4, 'teacher', 'Izmišljena primjedba nastavnika.', now() - interval '2 hours'),
              ($6, $1, $3, 2, $5, 'student', 'Izmišljeni odgovor studenta.', now() - interval '90 minutes'),
              ($7, $2, $3, 1, $5, 'student', 'Izmišljeno pitanje studenta.', now() - interval '1 hour')`,
      [teacherThread, studentThread, institution, teacher, student, studentReply, studentOpening],
    );
    await db.query("COMMIT");
    afterUp = await snapshot(db);
    expect(afterUp.threads).toHaveLength(2);
    expect(afterUp.comments).toHaveLength(3);
    expect(await exists(db, "collaboration.delete_comment(uuid)")).toBe(true);

    await migrate(db, TARGET, "down");
    const afterDown = await snapshot(db);
    // Every row stays as it was; only the deleted_at column, null on each, goes.
    expect(afterDown.threads).toEqual(afterUp.threads);
    expect(afterDown.comments).toEqual(afterUp.comments.map((row) => row.replace(/\|null$/, "")));
    expect(afterDown.comments.filter((row) => row.includes("|student|"))).toHaveLength(2);
    // Functions, grants, columns, rules and the schema's grants are those from before up.
    expect(afterDown.functions).toEqual(beforeUp.functions);
    expect(afterDown.columns).toEqual(beforeUp.columns);
    expect(afterDown.constraints).toEqual(beforeUp.constraints);
    expect(afterDown.schemaAcl).toEqual(beforeUp.schemaAcl);
    expect(await exists(db, "collaboration.delete_comment(uuid)")).toBe(false);

    await migrate(db, TARGET, "up");
    expect(await snapshot(db)).toEqual(afterUp);
  });

  it("with a deleted comment refuses and changes nothing", async () => {
    const [db] = clients;
    await db!.query(
      `UPDATE collaboration.comment SET body = NULL, deleted_at = created_at + interval '1 minute' WHERE id = $1`,
      [studentReply],
    );
    const deleted = await snapshot(db!);
    expect(deleted.functions).toEqual(afterUp.functions);

    await expect(migrate(db!, TARGET, "down")).rejects.toThrow(/deleted comments exist/);
    expect(await snapshot(db!)).toEqual(deleted);
    expect(await exists(db!, "collaboration.delete_comment(uuid)")).toBe(true);

    await db!.query(
      `UPDATE collaboration.comment SET body = 'Izmišljeni odgovor studenta.', deleted_at = NULL WHERE id = $1`,
      [studentReply],
    );
    expect(await snapshot(db!)).toEqual(afterUp);
  });

  // The down section looks for deleted comments before its ALTER TABLE takes
  // the table's lock. A deletion that commits in between makes the ALTER wait
  // for it and then fail on the deleted row, so the whole section rolls back.
  it("refuses when a deletion commits after its check and before its ALTER TABLE", async () => {
    const [setup] = clients;
    const deleter = await connect();
    const migrator = await connect();
    const migratorPid = (await migrator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;

    await deleter.query("BEGIN");
    await deleter.query(
      `UPDATE collaboration.comment SET body = NULL, deleted_at = created_at + interval '1 minute' WHERE id = $1`,
      [studentOpening],
    );
    let settled = false;
    const down = migrate(migrator, TARGET, "down").finally(() => {
      settled = true;
    });
    down.catch(() => undefined);
    let waited = false;
    for (let i = 0; i < 250 && !settled; i += 1) {
      const waiting = await admin.query(
        "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
        [migratorPid],
      );
      if (waiting.rowCount) {
        waited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waited).toBe(true);
    await deleter.query("COMMIT");

    await expect(down).rejects.toThrow(/comment_body_check|null values/);
    const after = await snapshot(setup!);
    expect(after.functions).toEqual(afterUp.functions);
    expect(after.columns).toEqual(afterUp.columns);
    expect(after.constraints).toEqual(afterUp.constraints);
    expect(after.schemaAcl).toEqual(afterUp.schemaAcl);
    expect(after.threads).toEqual(afterUp.threads);
    expect(after.comments.filter((row) => row.includes("<null>"))).toHaveLength(1);
    expect(await exists(setup!, "collaboration.delete_comment(uuid)")).toBe(true);
  });
});
