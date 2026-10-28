import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

// This test creates and removes only a randomly named database on the local
// stack. It runs the migration sections as the non-superuser migrator, like
// dbmate, over invented rows that existed before notification storage.
const LOCAL_ADMIN_URL = "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
function localAdminUrl(configured: string | undefined): string {
  // pg accepts query parameters such as ?host= and ?port= that override the
  // authority parsed by WHATWG URL. Accept only exact project-local URLs and
  // always connect to the fixed numeric loopback address.
  const allowed = new Set([
    LOCAL_ADMIN_URL,
    "postgres://ductus:ductus-local-only@localhost:54329/ductus",
    "postgresql://ductus:ductus-local-only@127.0.0.1:54329/ductus",
    "postgresql://ductus:ductus-local-only@localhost:54329/ductus",
  ]);
  if (configured !== undefined && !allowed.has(configured)) {
    throw new Error("The notification migration test runs only against the local Compose database.");
  }
  return LOCAL_ADMIN_URL;
}
const ADMIN_URL = localAdminUrl(process.env.DATABASE_URL);
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261028150000_notification_store.sql";
const name = `ductus_notifications_${randomBytes(6).toString("hex")}`;
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
let client: pg.Client | undefined;
let created = false;

function section(file: string, direction: "up" | "down"): string {
  const sql = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = sql.indexOf("-- migrate:up");
  const down = sql.indexOf("-- migrate:down");
  if (up < 0 || down <= up) throw new Error(`${file} is not a dbmate migration`);
  return direction === "up" ? sql.slice(up, down) : sql.slice(down);
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

afterAll(async () => {
  await client?.end();
  if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
});

describe("notification storage migration on an isolated database", () => {
  it("refuses connection strings that can redirect the migration test", () => {
    expect(localAdminUrl(undefined)).toBe(LOCAL_ADMIN_URL);
    for (const value of [
      `${LOCAL_ADMIN_URL}?host=remote.invalid&port=5432`,
      `${LOCAL_ADMIN_URL}?host=127.0.0.2&port=5432`,
      `${LOCAL_ADMIN_URL}?host=%2Ftmp%2Fother`,
      `${LOCAL_ADMIN_URL}?dbname=other`,
      `${LOCAL_ADMIN_URL}#fragment`,
      "postgres://ductus:ductus-local-only@127.0.0.1:5432/ductus",
      "postgres://other:ductus-local-only@127.0.0.1:54329/ductus",
      "postgres://ductus:ductus-local-only@127.0.0.1:54329/other",
    ]) {
      expect(() => localAdminUrl(value)).toThrow("local Compose database");
    }
    expect(localAdminUrl("postgres://ductus:ductus-local-only@localhost:54329/ductus")).toBe(LOCAL_ADMIN_URL);
    vi.stubEnv("PGHOST", "127.0.0.2");
    vi.stubEnv("PGPORT", "5432");
    vi.stubEnv("PGDATABASE", "other");
    vi.stubEnv("PGUSER", "other");
    try {
      const parsed = new pg.Client({ connectionString: localAdminUrl(undefined) });
      expect(parsed.host).toBe("127.0.0.1");
      expect(parsed.port).toBe(54329);
      expect(parsed.database).toBe("ductus");
      expect(parsed.user).toBe("ductus");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("restores the trigger on up/down/up without changing existing assignments", async () => {
    await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
    created = true;
    const url = new URL(ADMIN_URL);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.href });
    await client.connect();
    const db = client;

    const earlier = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql") && file < TARGET)
      .sort();
    for (const file of earlier) await migrate(db, file, "up");

    const ids = { institution: randomUUID(), teacher: randomUUID(), student: randomUUID(), course: randomUUID(), assignment: randomUUID() };
    await db.query("INSERT INTO identity.institution (id, slug) VALUES ($1, 'fak-test')", [ids.institution]);
    for (const [id, who] of [[ids.teacher, "teacher"], [ids.student, "student"]] as const) {
      await db.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@test.example')`,
        [id, ids.institution, who],
      );
    }
    await db.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, 'Izmišljeni kolegij', '2026/2027', 'prohibited', $3)`,
      [ids.course, ids.institution, ids.teacher],
    );
    await db.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [ids.course, ids.institution, ids.student],
    );

    const insertVersion = async (version: number) => db.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at,
          ai_policy, ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, $2, 'Izmišljeni zadatak', 'Upute.', 'essay', now(), now() + interval '30 days',
               'prohibited', '{}', 'basic', false, $3)`,
      [ids.assignment, version, ids.teacher],
    );
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO institution.assignment (id, course_id, institution_id, created_by) VALUES ($1, $2, $3, $4)",
      [ids.assignment, ids.course, ids.institution, ids.teacher],
    );
    await insertVersion(1);
    await db.query("COMMIT");

    const existing = async () => (await db.query(
      `SELECT a.id, a.current_version, a.course_id, a.institution_id,
              array_agg(v.version_no ORDER BY v.version_no) AS versions
         FROM institution.assignment a JOIN institution.assignment_version v ON v.assignment_id = a.id
        WHERE a.id = $1 GROUP BY a.id`, [ids.assignment],
    )).rows;
    const advance = async (version: number) => {
      await db.query("BEGIN");
      await insertVersion(version);
      await db.query("UPDATE institution.assignment SET current_version = $2 WHERE id = $1", [ids.assignment, version]);
      await db.query("COMMIT");
    };
    const table = async () => (await db.query("SELECT to_regclass('institution.notification') AS name")).rows[0].name;
    const triggerCount = async () => (await db.query(
      `SELECT count(*)::int AS count FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'institution.assignment_version'::regclass AND tgname = 'assignment_version_notify' AND NOT tgisinternal`,
    )).rows[0].count;

    const before = await existing();
    expect(await table()).toBeNull();
    expect(await triggerCount()).toBe(0);
    await migrate(db, TARGET, "up");
    expect(await existing()).toEqual(before);
    expect(await triggerCount()).toBe(1);
    await advance(2);
    const events = async () => (await db.query(
      "SELECT recipient_id, kind, target_id, event_key FROM institution.notification ORDER BY event_key",
    )).rows;
    expect(await events()).toEqual([{
      recipient_id: ids.student, kind: "assignment_version", target_id: ids.assignment,
      event_key: `assignment_version:${ids.assignment}:2`,
    }]);

    const beforeDown = await existing();
    await migrate(db, TARGET, "down");
    expect(await table()).toBeNull();
    expect(await triggerCount()).toBe(0);
    expect((await db.query("SELECT to_regprocedure('institution.notify_assignment_version()') AS name")).rows[0].name).toBeNull();
    expect(await existing()).toEqual(beforeDown);

    await migrate(db, TARGET, "up");
    expect(await existing()).toEqual(beforeDown);
    expect(await triggerCount()).toBe(1);
    expect((await db.query(
      `SELECT relrowsecurity AND relforcerowsecurity AS forced,
              has_table_privilege('ductus_app', 'institution.notification', 'SELECT') AS app_can_select
         FROM pg_catalog.pg_class WHERE oid = 'institution.notification'::regclass`,
    )).rows).toEqual([{ forced: true, app_can_select: false }]);
    await advance(3);
    expect(await events()).toEqual([{
      recipient_id: ids.student, kind: "assignment_version", target_id: ids.assignment,
      event_key: `assignment_version:${ids.assignment}:3`,
    }]);
    expect((await existing())[0]).toMatchObject({ current_version: 3, versions: [1, 2, 3] });
  }, 120_000);
});
