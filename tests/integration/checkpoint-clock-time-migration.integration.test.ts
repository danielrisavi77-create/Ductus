import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-302 L5 (contract #1091 c.6561682282, Codex finding on #1236): the old
// checkpoint trigger took now(), so a checkpoint it wrote can be older than
// its revision. Evidence times are never rewritten: the clock-time migration
// refuses to run over such a checkpoint and changes nothing, and runs once
// none is left. pgTAP sees the schema only after every migration; here a
// database of its own is migrated up to the one before, given old rows, and
// only then the migration's up section in one transaction, as dbmate runs it.
// The old rows are written as the compose superuser in replica mode, which
// skips foreign keys and triggers: only the two tables the migration reads
// matter. Every identifier and text is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261101180000_checkpoint_clock_time.sql";

function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_clock_${randomBytes(6).toString("hex")}`;
let client: pg.Client | undefined;

afterAll(async () => {
  await client?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

type Checkpoint = { document_id: string; content_hash: string; created_at: string };

describe("the clock-time migration over checkpoints written before it", () => {
  it("refuses while a checkpoint is older than its revision, rewrites no time, and runs once none is", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.href });
    client = db;
    await db.connect();
    await db.query("SET ROLE ductus_migrator");
    const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
    for (const file of earlier) await db.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
    await db.query("RESET ROLE");

    // "older": the commit RPC's clock_timestamp() for the revision, the old
    // trigger's earlier now() for its checkpoint. "level": both at the same
    // instant, as the opening RPC writes revision 0.
    const institution = randomUUID();
    const student = randomUUID();
    const revisionAt = "2026-10-20T10:00:00.000002Z";
    const older = { document: `doc-older-${randomUUID()}`, checkpointAt: "2026-10-20T10:00:00.000001Z" };
    const level = { document: `doc-level-${randomUUID()}`, checkpointAt: revisionAt };
    const rows = [older, level];
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    for (const row of rows) {
      const body = `{"type":"doc","content":[{"type":"paragraph","text":"${row.document}"}]}`;
      const hash = createHash("sha256").update(body, "utf8").digest("hex");
      await db.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id,
                                                 content_hash, created_at)
         VALUES ($1, $2, 0, NULL, $3, $4, $5)`,
        [row.document, institution, student, hash, revisionAt],
      );
      await db.query(
        `INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body, content_hash, created_at)
         VALUES ($1, $2, 0, $3, $4, $5)`,
        [row.document, institution, body, hash, row.checkpointAt],
      );
    }
    await db.query("COMMIT");

    const checkpoints = () =>
      db.query<Checkpoint>(
        `SELECT document_id, content_hash, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS created_at
           FROM evidence.document_checkpoint ORDER BY document_id`,
      ).then((result) => result.rows);
    const sealSource = () =>
      db.query<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE oid = 'evidence.seal_document_checkpoint'::regproc")
        .then((result) => result.rows[0]?.src ?? "");
    const before = await checkpoints();
    expect(before.map((row) => row.created_at).sort()).toEqual(["2026-10-20 10:00:00.000001", "2026-10-20 10:00:00.000002"]);
    expect(await sealSource()).toContain("pg_catalog.now()");

    await db.query("SET ROLE ductus_migrator");
    await expect(db.query(`BEGIN;\n${upSection(TARGET)}\nCOMMIT;`)).rejects.toThrow(/checkpoint is older than its revision/);
    await db.query("ROLLBACK");
    await db.query("RESET ROLE");
    expect(await checkpoints()).toEqual(before);
    expect(await sealSource()).toContain("pg_catalog.now()");
    expect(await sealSource()).not.toContain("clock_timestamp");

    // Recreating the database stands in here for removing the older row.
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    await db.query("DELETE FROM evidence.document_checkpoint WHERE document_id = $1", [older.document]);
    await db.query("COMMIT");

    await db.query("SET ROLE ductus_migrator");
    await db.query(`BEGIN;\n${upSection(TARGET)}\nCOMMIT;`);
    await db.query("RESET ROLE");
    expect(await checkpoints()).toEqual(before.filter((row) => row.document_id === level.document));
    expect(await sealSource()).toContain("pg_catalog.clock_timestamp()");
  });
});
