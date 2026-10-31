import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// D-91 measure 6: db/migrations/20261031230000_roles_check.sql only checks
// the group roles. Every case runs the migration's own up section as
// ductus_migrator, the way dbmate does, inside a transaction that is always
// rolled back: roles are cluster-wide, and nothing a case changes may
// outlive it. The one role a case creates has a random synthetic name.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "The roles check migration test runs only against a loopback database (DATABASE_URL).",
);
const FILE = fileURLToPath(new URL("../../db/migrations/20261031230000_roles_check.sql", import.meta.url));
const GROUP_ROLES = [
  "ductus_app", "ductus_worker", "ductus_retention", "ductus_evidence", "ductus_identity", "ductus_auth",
] as const;
const ATTRIBUTES = ["LOGIN", "SUPERUSER", "CREATEDB", "CREATEROLE", "REPLICATION", "BYPASSRLS"] as const;
const suffix = randomBytes(4).toString("hex");
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

function section(direction: "up" | "down"): string {
  const sql = readFileSync(FILE, "utf8");
  const up = sql.indexOf("-- migrate:up");
  const down = sql.indexOf("-- migrate:down");
  if (up < 0 || down <= up || sql.match(/migrate:(up|down)/g)?.length !== 2) {
    throw new Error("the roles check is not a dbmate migration with one up and one down section");
  }
  return direction === "up" ? sql.slice(up, down) : sql.slice(down);
}

// Every ductus_* role with its attributes and every membership that involves
// one, with its options and grantor, plus the number of schema objects.
const SNAPSHOT = `
  SELECT
    (SELECT json_agg(r ORDER BY r.rolname) FROM (
       SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
         FROM pg_catalog.pg_roles WHERE rolname LIKE 'ductus\\_%') r) AS roles,
    (SELECT json_agg(m ORDER BY m.role, m.member, m.grantor) FROM (
       SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, pg_get_userbyid(grantor) AS grantor,
              admin_option, inherit_option, set_option
         FROM pg_catalog.pg_auth_members
        WHERE pg_get_userbyid(roleid) LIKE 'ductus\\_%' OR pg_get_userbyid(member) LIKE 'ductus\\_%') m) AS members,
    (SELECT count(*) FROM pg_catalog.pg_class) AS relations,
    (SELECT count(*) FROM pg_catalog.pg_proc) AS functions,
    (SELECT count(*) FROM pg_catalog.pg_namespace) AS schemas`;

type Outcome = { error?: string; before: unknown; after: unknown };

/** Runs `setup` as the superuser, then `sql` as `as` (or as the superuser), and rolls back. */
async function attempt(setup: string[], as: string | null, sql: string): Promise<Outcome> {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    for (const statement of setup) await client.query(statement);
    const before = (await client.query(SNAPSHOT)).rows[0];
    if (as !== null) await client.query(`SET LOCAL ROLE ${as}`);
    try {
      await client.query(sql);
    } catch (error) {
      return { error: (error as Error).message, before, after: undefined };
    }
    const after = (await client.query(SNAPSHOT)).rows[0];
    return { before, after };
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Statements that take away each option of `role` held by the migrator, whoever granted it. */
async function revokeOption(option: "ADMIN" | "SET", role: string): Promise<string[]> {
  const column = option === "ADMIN" ? "admin_option" : "set_option";
  const { rows } = await admin.query<{ grantor: string }>(
    `SELECT pg_get_userbyid(grantor) AS grantor FROM pg_catalog.pg_auth_members
      WHERE roleid = $1::regrole AND member = 'ductus_migrator'::regrole AND ${column}`,
    [role],
  );
  expect(rows.length).toBeGreaterThan(0);
  return rows.map(({ grantor }) => `REVOKE ${option} OPTION FOR ${role} FROM ductus_migrator GRANTED BY "${grantor}" CASCADE`);
}

afterAll(async () => {
  await admin.end();
});

describe("the roles check migration", () => {
  it("passes on the migrated database and changes nothing", async () => {
    const outcome = await attempt([], "ductus_migrator", section("up"));
    expect(outcome.error).toBeUndefined();
    expect(outcome.after).toEqual(outcome.before);
    expect((outcome.before as { roles: unknown[] }).roles.length).toBeGreaterThanOrEqual(GROUP_ROLES.length + 1);
  });

  it("has a down section that changes nothing", async () => {
    const outcome = await attempt([], "ductus_migrator", section("down"));
    expect(outcome.error).toBeUndefined();
    expect(outcome.after).toEqual(outcome.before);
  });

  it("stops when it does not run as ductus_migrator, or the migrator is above RLS", async () => {
    expect((await attempt([], null, section("up"))).error).toMatch(/^migrations must run as ductus_migrator /);
    expect((await attempt([], "ductus_identity", section("up"))).error).toMatch(/current role: ductus_identity\)/);
    for (const attribute of ["SUPERUSER", "BYPASSRLS"]) {
      const outcome = await attempt([`ALTER ROLE ductus_migrator ${attribute}`], "ductus_migrator", section("up"));
      expect(outcome.error, attribute).toMatch(/current role: ductus_migrator\)/);
    }
  });

  it("stops on each group role that is missing", async () => {
    for (const role of GROUP_ROLES) {
      const outcome = await attempt([`ALTER ROLE ${role} RENAME TO ${role}_${suffix}`], "ductus_migrator", section("up"));
      expect(outcome.error, role).toBe(`group role ${role} does not exist`);
    }
  });

  it("stops on each attribute a group role must not have, for every group role", async () => {
    for (const [index, role] of GROUP_ROLES.entries()) {
      const attribute = ATTRIBUTES[index];
      const outcome = await attempt([`ALTER ROLE ${role} ${attribute}`], "ductus_migrator", section("up"));
      expect(outcome.error, `${role} ${attribute}`).toBe(`group role ${role} has LOGIN or an elevated attribute`);
    }
  });

  it("stops when the migrator does not administer a group role", async () => {
    for (const role of ["ductus_retention", "ductus_identity"]) {
      const outcome = await attempt(await revokeOption("ADMIN", role), "ductus_migrator", section("up"));
      expect(outcome.error, role).toBe(`ductus_migrator does not administer group role ${role}`);
    }
  });

  it("stops when the migrator inherits a group role, directly or through another role", async () => {
    const direct = await attempt(
      ["GRANT ductus_worker TO ductus_migrator WITH INHERIT TRUE"], "ductus_migrator", section("up"),
    );
    expect(direct.error).toBe("ductus_migrator inherits the privileges of group role ductus_worker");

    const between = `it_roles_check_${suffix}`;
    const indirect = await attempt([
      `CREATE ROLE ${between} NOLOGIN`,
      `GRANT ductus_app TO ${between} WITH INHERIT TRUE`,
      `GRANT ${between} TO ductus_migrator WITH INHERIT TRUE`,
    ], "ductus_migrator", section("up"));
    expect(indirect.error).toBe("ductus_migrator inherits the privileges of group role ductus_app");
  });

  it("stops when the migrator cannot SET ROLE to an owner role", async () => {
    for (const role of ["ductus_identity", "ductus_evidence"]) {
      const outcome = await attempt(await revokeOption("SET", role), "ductus_migrator", section("up"));
      expect(outcome.error, role).toBe(`ductus_migrator cannot SET ROLE to owner role ${role}`);
    }
  });

  it("leaves the roles as they were after every case", async () => {
    const outcome = await attempt([], "ductus_migrator", section("up"));
    expect(outcome.error).toBeUndefined();
    const { rows } = await admin.query(
      "SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = ANY ($1) AND NOT (rolcanlogin OR rolsuper OR rolbypassrls)",
      [[...GROUP_ROLES]],
    );
    expect(rows.map((row) => row.rolname).sort()).toEqual([...GROUP_ROLES].sort());
  });
});
