import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-315 (M2.12-P01a, plan #1505 E1, E4 and B3): a faculty rule version is
// published with the version the administrator expects. db/tests/105 covers
// every input class inside one transaction; this test holds the races between
// connections: two administrators publishing from the same expected version
// make one version and one audit row, the same administrator retrying while
// the first call runs gets the version back without a second one, a
// revocation of the admin role committed first leaves the waiting publication
// with ZD403, and a revocation started after a publication waits for it.
// Loopback only; one random login and random synthetic rows per run, removed
// afterwards. Iva and Ines are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(
  SAFE_ADMIN_URL,
  "The faculty rule race test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(5).toString("hex");
const login = `it_rule_version_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = { iva: randomUUID(), ines: randomUUID() };
type Person = keyof typeof people;
const tokens: Record<Person, string> = {
  iva: randomBytes(32).toString("base64url"),
  ines: randomBytes(32).toString("base64url"),
};

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

const PUBLISH =
  "SELECT institution.publish_faculty_rule_version('essay', $1, 'partially_allowed', ARRAY['proofreading'], 'basic', true) AS v";
const PUBLISH_OTHER =
  "SELECT institution.publish_faculty_rule_version('essay', $1, 'prohibited', '{}', 'extended', false) AS v";

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      "INSERT INTO identity.institution (id, slug) VALUES ($1, $2)",
      [institutionId, `it-${suffix}`],
    );
    for (const [name, id] of Object.entries(people)) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          institutionId,
          `https://issuer-${suffix}.test`,
          `sub-${name}`,
          `${name}@${suffix}.example`,
        ],
      );
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [tokens[name as Person], id, institutionId],
      );
    }
    await client.query("COMMIT");
    fixtureReady = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Disposable synthetic rows only; replica mode lifts the immutability and
// append-only triggers for this teardown, as in the other race tests.
async function clear(tables: string[]) {
  await admin.query("BEGIN");
  try {
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of tables) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [
        institutionId,
      ]);
    }
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

const RULE_TABLES = [
  "audit.faculty_rule_event",
  "institution.faculty_rule_version",
  "institution.faculty_work_rule",
];

async function removeFixture() {
  if (!fixtureReady) return;
  await clear([
    ...RULE_TABLES,
    "institution.institution_role",
    "identity.session",
    "identity.user_account",
  ]);
  try {
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [
      institutionId,
    ]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

// Each case starts with no version and both administrators confirmed, so the
// cases do not depend on their order.
async function resetCase() {
  await clear([...RULE_TABLES, "institution.institution_role"]);
  try {
    for (const id of Object.values(people)) {
      await admin.query(
        `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
         VALUES ($1, $2, 'admin', now())`,
        [institutionId, id],
      );
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

function call<T>(who: Person, sql: string, params: unknown[] = []) {
  return withActor(tokens[who], async (tx) => {
    const row = await tx.query<{ v: T }>(sql, params);
    return row.rows[0].v;
  });
}

// The SQLSTATE of a rejected promise, or "ok" when it resolved.
async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

// Holds a transaction open on its own connection after one statement: an
// actor's call on ductus_app, or the operator's write on the admin pool.
async function hold(who: Person | "operator", sql: string, params: unknown[]) {
  const client = await (who === "operator" ? admin : appPool).connect();
  await client.query("BEGIN");
  if (who !== "operator") {
    await client.query(
      "SELECT pg_catalog.set_config('app.session_token', $1, true)",
      [tokens[who]],
    );
  }
  let result: pg.QueryResult<{ v: unknown }>;
  try {
    result = await client.query<{ v: unknown }>(sql, params);
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    throw error;
  }
  return {
    value: result.rows[0]?.v,
    async commit() {
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
  };
}

// Resolves once a backend waits on a lock (a row lock or the advisory lock of
// the rule): any backend of the test login, or one backend by its pid. No
// fixed sleep: the check repeats until the waiter is seen, for at most ten
// seconds. pg_stat_activity is read on a fresh superuser connection, so the
// admin pool can stay held by an open transaction.
async function untilLockWait(waiter: { user: string } | { pid: number }) {
  const probe = new pg.Client({ connectionString: SAFE_ADMIN_URL });
  await probe.connect();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const row = await probe.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_catalog.pg_stat_activity
         WHERE wait_event_type = 'Lock' AND (usename = $1 OR pid = $2)`,
        "user" in waiter ? [waiter.user, null] : [null, waiter.pid],
      );
      if (row.rows[0].waiting > 0) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("no statement waited on the lock");
  } finally {
    await probe.end();
  }
}

async function counts() {
  const row = await admin.query<{
    versions: number;
    events: number;
    rules: number;
  }>(
    `SELECT (SELECT count(*)::int FROM institution.faculty_rule_version WHERE institution_id = $1) AS versions,
            (SELECT count(*)::int FROM audit.faculty_rule_event WHERE institution_id = $1) AS events,
            (SELECT count(*)::int FROM institution.faculty_work_rule WHERE institution_id = $1) AS rules`,
    [institutionId],
  );
  return row.rows[0];
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await insertFixture();
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  // Two connections: one transaction stays open while the other statement
  // runs into its lock.
  appPool = new pg.Pool({ connectionString: url.href, max: 2 });
  withActor = createWithActor(appPool);
});

afterAll(async () => {
  await appPool?.end();
  let cleanupError: unknown;
  try {
    await removeFixture();
  } catch (error) {
    cleanupError = error;
  }
  try {
    const drop = await admin.query<{ ddl: string }>(
      "SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl",
      [login],
    );
    await admin.query(drop.rows[0].ddl);
  } finally {
    await admin.end();
  }
  if (cleanupError) throw cleanupError;
});

describe("faculty rule publication under concurrency (DAN-315)", () => {
  it("E1: makes one version and one audit row when two administrators publish from the same expected version", async () => {
    await resetCase();
    const first = await hold("iva", PUBLISH, [0]);
    expect(first.value).toBe(1);
    let second: Promise<number> | undefined;
    try {
      second = call<number>("ines", PUBLISH_OTHER, [0]);
      await untilLockWait({ user: login });
    } finally {
      await first.commit();
    }
    expect(await outcome(second)).toBe("ZD409");
    expect(await counts()).toStrictEqual({ versions: 1, events: 1, rules: 1 });
    const row = await admin.query<{ by: string; policy: string }>(
      `SELECT v.published_by::text AS by, r.ai_policy AS policy
       FROM institution.faculty_rule_version v
       JOIN institution.faculty_work_rule r USING (institution_id, work_type)
       WHERE v.institution_id = $1`,
      [institutionId],
    );
    expect(row.rows).toStrictEqual([
      { by: people.iva, policy: "partially_allowed" },
    ]);
  });

  it("E4: returns the same version to a retry that waited for the first call", async () => {
    await resetCase();
    const first = await hold("iva", PUBLISH, [0]);
    let retry: Promise<number> | undefined;
    try {
      retry = call<number>("iva", PUBLISH, [0]);
      await untilLockWait({ user: login });
    } finally {
      await first.commit();
    }
    expect(await retry).toBe(1);
    expect(await counts()).toStrictEqual({ versions: 1, events: 1, rules: 1 });
  });

  it("B3: refuses the waiting publication when the revocation of the admin role commits first", async () => {
    await resetCase();
    const revocation = await hold(
      "operator",
      `UPDATE institution.institution_role SET revoked_at = now()
       WHERE institution_id = $1 AND user_id = $2 AND role = 'admin' RETURNING true AS v`,
      [institutionId, people.iva],
    );
    expect(revocation.value).toBe(true);
    let publication: Promise<number> | undefined;
    try {
      publication = call<number>("iva", PUBLISH, [0]);
      await untilLockWait({ user: login });
    } finally {
      await revocation.commit();
    }
    expect(await outcome(publication)).toBe("ZD403");
    expect(await counts()).toStrictEqual({ versions: 0, events: 0, rules: 0 });
  });

  it("B3: holds a revocation until the publication that saw the role commits", async () => {
    await resetCase();
    const publication = await hold("iva", PUBLISH, [0]);
    expect(publication.value).toBe(1);
    const operator = new pg.Client({ connectionString: SAFE_ADMIN_URL });
    await operator.connect();
    let revocation: Promise<unknown> | undefined;
    try {
      const pid = (
        await operator.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      revocation = operator.query(
        `UPDATE institution.institution_role SET revoked_at = now()
         WHERE institution_id = $1 AND user_id = $2 AND role = 'admin'`,
        [institutionId, people.iva],
      );
      await untilLockWait({ pid });
    } finally {
      await publication.commit();
    }
    try {
      expect(await outcome(revocation)).toBe("ok");
    } finally {
      await operator.end();
    }
    // The version was published while the role stood; the next one is refused.
    expect(await counts()).toStrictEqual({ versions: 1, events: 1, rules: 1 });
    expect(await outcome(call<number>("iva", PUBLISH_OTHER, [1]))).toBe(
      "ZD403",
    );
  });
});
