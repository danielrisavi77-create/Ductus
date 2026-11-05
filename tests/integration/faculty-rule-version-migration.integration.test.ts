import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-315 (M2.12-P01a, plan #1505 F1 and F2): the migration that makes faculty
// rules versioned runs over rules that already exist. pgTAP sees only the
// finished schema; here a database of its own is migrated up to the one
// before, given faculty_work_rule rows from before the migration, and then the
// up section runs in one transaction, as dbmate runs it. Every existing rule
// becomes version 1 with its content and its last change as the moment of
// publication, from the operator and with no audit row; the down section then
// drops the versions and leaves the rules as they were. Rows are written as
// the compose superuser; every identifier is random.
const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const LOOPBACK_ONLY =
  "The migration test runs only against a loopback database.";
requireLoopbackDatabaseUrl(ADMIN_URL, LOOPBACK_ONLY);
const MIGRATIONS = fileURLToPath(
  new URL("../../db/migrations/", import.meta.url),
);
const TARGET = "20261104110000_faculty_rule_version.sql";

function section(file: string, which: "up" | "down") {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return which === "up" ? text.slice(0, down) : text.slice(down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const name = `ductus_rulever_${randomBytes(6).toString("hex")}`;
const clients: pg.Client[] = [];

// The superuser reads and writes the rows; the migrator connects with the role
// as a connection option, as dbmate does, so the RESET ROLE of a migration
// returns to it.
async function connect(options?: string): Promise<pg.Client> {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href, options });
  await client.connect();
  clients.push(client);
  return client;
}

// Runs one section in one transaction, as dbmate runs it.
async function run(client: pg.Client, sql: string) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

afterAll(async () => {
  for (const client of clients) await client.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

type Rule = {
  institution_id: string;
  work_type: string;
  ai_policy: string;
  ai_purposes: string[];
  evidence_profile: string;
  import_allowed: boolean;
  updated_at: Date;
};

describe("the faculty rule version migration over rules from before it", () => {
  it("makes every rule version 1 of the operator, and its down section leaves the rules as they were", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    const migrator = await connect("-c role=ductus_migrator");
    const db = await connect();
    const earlier = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql") && file < TARGET)
      .sort();
    for (const file of earlier) await run(migrator, section(file, "up"));

    const first = randomUUID();
    const second = randomUUID();
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO identity.institution (id, slug) VALUES ($1, $3), ($2, $4)",
      [first, second, `it-${first.slice(0, 8)}`, `it-${second.slice(0, 8)}`],
    );
    await db.query(
      `INSERT INTO institution.faculty_work_rule
         (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed, updated_at)
       VALUES ($1, 'essay', 'partially_allowed', ARRAY['proofreading', 'translation'], 'basic', true, now() - interval '40 days'),
              ($1, 'master_thesis', 'prohibited', '{}', 'extended', false, now() - interval '3 days'),
              ($2, 'essay', 'encouraged', ARRAY['formatting'], 'basic', false, now() - interval '1 day')`,
      [first, second],
    );
    await db.query("COMMIT");
    const read = async () =>
      (
        await db.query<Rule>(
          `SELECT institution_id::text, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed, updated_at
           FROM institution.faculty_work_rule ORDER BY institution_id, work_type`,
        )
      ).rows;
    const before = await read();
    expect(before).toHaveLength(3);

    await run(migrator, section(TARGET, "up"));

    const versions = (
      await db.query<
        Omit<Rule, "updated_at"> & {
          version_no: number;
          origin: string;
          published_by: string | null;
          published_at: Date;
        }
      >(
        `SELECT institution_id::text, work_type, version_no, ai_policy, ai_purposes, evidence_profile,
                import_allowed, origin, published_by, published_at
         FROM institution.faculty_rule_version ORDER BY institution_id, work_type`,
      )
    ).rows;
    expect(versions).toStrictEqual(
      before.map(({ updated_at, ...rule }) => ({
        ...rule,
        version_no: 1,
        origin: "operator",
        published_by: null,
        published_at: updated_at,
      })),
    );
    const events = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit.faculty_rule_event",
    );
    expect(events.rows[0].n).toBe(0);
    // The rules themselves are not touched by the up section.
    expect(await read()).toStrictEqual(before);

    // F2: the down section, run as dbmate runs it, drops the versions and the
    // trail and keeps every rule.
    await run(migrator, section(TARGET, "down"));
    const left = await db.query<{
      versions: string | null;
      events: string | null;
      publish: boolean;
    }>(
      `SELECT to_regclass('institution.faculty_rule_version')::text AS versions,
              to_regclass('audit.faculty_rule_event')::text AS events,
              EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'publish_faculty_rule_version') AS publish`,
    );
    expect(left.rows[0]).toStrictEqual({
      versions: null,
      events: null,
      publish: false,
    });
    expect(await read()).toStrictEqual(before);
  });
});
