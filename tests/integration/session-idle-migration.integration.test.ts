import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-296 B4 (Codex CLI review on #1253): the backfill of last_seen_at runs in
// the migration's transaction, whose now() is the moment that transaction
// began. A login committed after that moment and before the ALTER has a later
// created_at, and the backfill must not put its last_seen_at below it. pgTAP
// sees only the finished schema; here a database of its own is migrated up to
// the one before, given sessions from before the migration, and then the up
// section runs in one transaction, as dbmate runs it, while a second
// connection commits a login inside that transaction's window. Rows are
// written as the compose superuser in replica mode, which skips the foreign
// keys: only identity.session matters. Every identifier is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261101200000_session_idle.sql";

function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_idle_${randomBytes(6).toString("hex")}`;
const clients: pg.Client[] = [];

async function connect(): Promise<pg.Client> {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  clients.push(client);
  return client;
}

afterAll(async () => {
  for (const client of clients) await client.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe("the idle-session migration over sessions from before it", () => {
  it("never puts last_seen_at before created_at, even for a login inside its transaction", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const migrator = await connect();
    const login = await connect();
    await migrator.query("SET ROLE ductus_migrator");
    const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
    for (const file of earlier) await migrator.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
    await migrator.query("RESET ROLE");

    const institution = randomUUID();
    const user = randomUUID();
    const insert = async (db: pg.Client, created: string, expires: string) => {
      const id = randomUUID();
      await db.query("BEGIN");
      await db.query("SET LOCAL session_replication_role = replica");
      await db.query(
        `INSERT INTO identity.session (id, token_hash, user_id, institution_id, created_at, expires_at)
         VALUES ($1::uuid, sha256(convert_to($1::text, 'UTF8')), $2, $3, ${created}, ${expires})`,
        [id, user, institution],
      );
      await db.query("COMMIT");
      return id;
    };
    const open = await insert(migrator, "now() - interval '3 hours'", "now() + interval '9 hours'");
    const expired = await insert(migrator, "now() - interval '13 hours'", "now() - interval '1 hour'");

    // The migration's transaction begins; its now() is fixed from here on.
    await migrator.query("BEGIN");
    await migrator.query("SET LOCAL ROLE ductus_migrator");
    const start = (await migrator.query<{ t: Date }>("SELECT now() AS t")).rows[0]!.t;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const late = await insert(login, "now()", "now() + interval '12 hours'");
    try {
      await migrator.query(upSection(TARGET));
      await migrator.query("COMMIT");
    } catch (error) {
      await migrator.query("ROLLBACK");
      throw error;
    }

    const rows = new Map(
      (await migrator.query<{ id: string; created_at: Date; expires_at: Date; last_seen_at: Date }>(
        "SELECT id, created_at, expires_at, last_seen_at FROM identity.session",
      )).rows.map((row) => [row.id, row]),
    );
    const lateRow = rows.get(late)!;
    expect(lateRow.created_at.getTime()).toBeGreaterThan(start.getTime());
    expect(lateRow.last_seen_at).toEqual(lateRow.created_at);
    expect(rows.get(open)!.last_seen_at).toEqual(start);
    expect(rows.get(expired)!.last_seen_at).toEqual(rows.get(expired)!.expires_at);
  });

  // QA on #1253: a touch that finds the row locked by another touch must wait
  // for it, not skip it. If the holder rolls back, the waiting call is the one
  // that records the activity; if the holder commits, the waiting call sees the
  // fresh write and writes nothing. Runs on the database migrated above.
  it("never drops activity when a concurrent touch on the same session rolls back", async () => {
    const [setup] = clients;
    const holder = await connect();
    const waiter = await connect();
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const lastSeen = async () =>
      (await setup!.query<{ t: Date }>("SELECT last_seen_at AS t FROM identity.session WHERE id = $1", [id])).rows[0]!.t;
    await setup!.query("BEGIN");
    await setup!.query("SET LOCAL session_replication_role = replica");
    await setup!.query(
      `INSERT INTO identity.session (id, token_hash, user_id, institution_id, created_at, expires_at, last_seen_at)
       VALUES ($1::uuid, sha256(convert_to($2::text, 'UTF8')), $3, $4,
               now() - interval '3 hours', now() + interval '9 hours', now() - interval '90 minutes')`,
      [id, token, randomUUID(), randomUUID()],
    );
    await setup!.query("COMMIT");
    const before = await lastSeen();

    await waiter.query("SET ROLE ductus_app");
    await waiter.query("SELECT set_config('app.session_token', $1, false)", [token]);
    const waiterPid = (await waiter.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;

    // Holds the row lock in an open transaction and returns that transaction's now().
    const hold = async () => {
      await holder.query("BEGIN");
      await holder.query("SET LOCAL ROLE ductus_app");
      await holder.query("SELECT set_config('app.session_token', $1, true)", [token]);
      const row = (await holder.query<{ wrote: boolean; t: Date }>(
        "SELECT identity.touch_current_session() AS wrote, now() AS t",
      )).rows[0]!;
      expect(row.wrote).toBe(true);
      return row.t;
    };
    // Starts the second touch and returns once it is waiting on the lock, or has
    // already answered without waiting.
    const touchWhileHeld = async () => {
      let done = false;
      const result = waiter
        .query<{ wrote: boolean }>("SELECT identity.touch_current_session() AS wrote")
        .then((r) => r.rows[0]!.wrote)
        .finally(() => {
          done = true;
        });
      for (let i = 0; i < 250 && !done; i += 1) {
        const waiting = await admin.query(
          "SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'",
          [waiterPid],
        );
        if (waiting.rowCount) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return result;
    };

    await hold();
    const afterRollback = touchWhileHeld();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await holder.query("ROLLBACK");
    expect(await afterRollback).toBe(true);
    const recorded = await lastSeen();
    expect(recorded.getTime()).toBeGreaterThan(before.getTime());

    await setup!.query("UPDATE identity.session SET last_seen_at = now() - interval '90 minutes' WHERE id = $1", [id]);
    const committed = await hold();
    const afterCommit = touchWhileHeld();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await holder.query("COMMIT");
    expect(await afterCommit).toBe(false);
    expect(await lastSeen()).toEqual(committed);
  });
});
