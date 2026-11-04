import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-306, attack plan #1502, C3 and C4: the fingerprint migration runs over
// acknowledgments from before it, then down and up again, and no
// acknowledgment is lost or changed; rows from before it get no fingerprint.
// pgTAP sees only the finished schema; here a database of its own is migrated
// up to the one before. The three acknowledgments are written as the compose
// superuser in replica mode, which skips the foreign keys: only the
// acknowledgment table matters. Every identifier is random.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261104120000_notice_fingerprint.sql";

function section(file: string, direction: "up" | "down"): string {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down <= up) throw new Error(`${file} is not a dbmate migration`);
  return direction === "up" ? text.slice(up, down) : text.slice(down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_notice_${randomBytes(6).toString("hex")}`;
let client: pg.Client | undefined;

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

afterAll(async () => {
  await client?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe("the notice fingerprint migration over acknowledgments from before it", () => {
  it("keeps every acknowledgment on up, down and up, and gives none of them a fingerprint", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.href });
    await client.connect();
    const db = client;

    const earlier = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql") && file < TARGET).sort();
    for (const file of earlier) await migrate(db, file, "up");

    const institution = randomUUID();
    const assignment = randomUUID();
    await db.query("BEGIN");
    await db.query("SET LOCAL session_replication_role = replica");
    for (const [version, days] of [[1, 9], [1, 8], [2, 3]] as const) {
      await db.query(
        `INSERT INTO institution.notice_acknowledgment
           (assignment_id, version_no, student_id, institution_id, acknowledged_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
        [assignment, version, randomUUID(), institution, days],
      );
    }
    await db.query("COMMIT");

    const rows = async () => (await db.query<{ row: string }>(
      `SELECT concat_ws('|', assignment_id, version_no, student_id, institution_id, acknowledged_at) AS row
         FROM institution.notice_acknowledgment ORDER BY acknowledged_at`,
    )).rows.map((r) => r.row);
    const fingerprinted = async () => Number((await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM institution.notice_acknowledgment
        WHERE notice_template_version IS NOT NULL OR notice_fingerprint IS NOT NULL`,
    )).rows[0]!.n);
    const signature = async (regprocedure: string) =>
      (await db.query<{ ok: boolean }>("SELECT to_regprocedure($1) IS NOT NULL AS ok", [regprocedure])).rows[0]!.ok;
    const before = await rows();
    expect(before).toHaveLength(3);

    await migrate(db, TARGET, "up");
    expect(await rows()).toEqual(before);
    expect(await fingerprinted()).toBe(0);
    expect(await signature("institution.acknowledge_notice(uuid, integer)")).toBe(false);
    expect(await signature("institution.acknowledge_notice(uuid, integer, integer)")).toBe(true);

    await migrate(db, TARGET, "down");
    expect(await rows()).toEqual(before);
    expect(await signature("institution.acknowledge_notice(uuid, integer)")).toBe(true);
    expect(await signature("institution.acknowledge_notice(uuid, integer, integer)")).toBe(false);

    await migrate(db, TARGET, "up");
    expect(await rows()).toEqual(before);
    expect(await fingerprinted()).toBe(0);
    expect(await signature("institution.acknowledge_notice(uuid, integer, integer)")).toBe(true);
  });
});
