import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-515 (M2.6-P03): a mentorship comes into being only when a confirmed
// teacher approves the student's request. db/tests/104 covers every input
// class inside one transaction; this test holds the races between
// connections: two approvals of one request make one mentorship, a revocation
// of the teacher role committed first leaves the waiting approval with ZD403,
// a revocation started after an approval waits for it, and two requests for the
// same kind of work leave one open. Loopback only; one random login and random
// synthetic rows per run, removed afterwards. Iva, Vesna, Ana and Boris are
// invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(
  SAFE_ADMIN_URL,
  "The mentorship race test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(5).toString("hex");
const login = `it_mentorship_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = {
  iva: randomUUID(),
  vesna: randomUUID(),
  ana: randomUUID(),
  boris: randomUUID(),
};
type Person = keyof typeof people;
const tokens: Record<Person, string> = {
  iva: randomBytes(32).toString("base64url"),
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  boris: randomBytes(32).toString("base64url"),
};

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

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
    await client.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
       VALUES ($1, $2, 'admin', now())`,
      [institutionId, people.iva],
    );
    await client.query("COMMIT");
    fixtureReady = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeFixture() {
  if (!fixtureReady) return;
  await admin.query("BEGIN");
  try {
    // Disposable synthetic rows only; replica mode lifts the append-only
    // triggers of the trail for this teardown, as in the other race tests.
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "audit.mentorship_event",
      "institution.mentorship_request",
      "institution.mentorship",
      "audit.teacher_role_event",
      "institution.institution_role",
      "identity.session",
      "identity.user_account",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [
        institutionId,
      ]);
    }
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [
      institutionId,
    ]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

// Each case starts from a freshly confirmed role for Vesna and no
// mentorship, so the cases do not depend on their order.
async function resetCase() {
  await admin.query("BEGIN");
  try {
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "audit.mentorship_event",
      "institution.mentorship_request",
      "institution.mentorship",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [
        institutionId,
      ]);
    }
    await admin.query(
      "DELETE FROM institution.institution_role WHERE institution_id = $1 AND user_id = $2",
      [institutionId, people.vesna],
    );
    await admin.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_by, confirmed_at)
       VALUES ($1, $2, 'teacher', $3, now())`,
      [institutionId, people.vesna, people.iva],
    );
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

const request = (who: Person) =>
  call<string>(
    who,
    "SELECT institution.request_mentorship($1, 'master_thesis') AS v",
    [people.vesna],
  );
const approve = (requestId: string) =>
  call<string>(
    "vesna",
    "SELECT institution.approve_mentorship_request($1)::text AS v",
    [requestId],
  );
const revoke = () =>
  call<boolean>("iva", "SELECT institution.revoke_teacher_role($1) AS v", [
    people.vesna,
  ]);

// The SQLSTATE of a rejected promise, or "ok" when it resolved.
async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

// Holds a transaction of one actor open on its own ductus_app connection,
// with the token set as withActor sets it (withActor does not nest).
async function hold(who: Person, sql: string, params: unknown[]) {
  const client = await appPool.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_catalog.set_config('app.session_token', $1, true)",
    [tokens[who]],
  );
  const result = await client.query<{ v: unknown }>(sql, params);
  return {
    value: result.rows[0].v,
    async commit() {
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
    async rollback() {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  };
}

// Resolves once a backend of the test login waits on a row lock. No fixed
// sleep: the check repeats until the waiter is seen, for at most ten seconds.
async function untilLockWait() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const row = await admin.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_catalog.pg_stat_activity
       WHERE usename = $1 AND wait_event_type = 'Lock'`,
      [login],
    );
    if (row.rows[0].waiting > 0) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("no statement waited on the lock");
}

async function counts() {
  const row = await admin.query<{ mentorships: number; approved: number }>(
    `SELECT (SELECT count(*)::int FROM institution.mentorship WHERE institution_id = $1) AS mentorships,
            (SELECT count(*)::int FROM audit.mentorship_event
              WHERE institution_id = $1 AND kind = 'approved') AS approved`,
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

describe("mentorship approval under concurrency (DAN-515)", () => {
  it("makes one mentorship when two approvals of one request race", async () => {
    await resetCase();
    const requestId = await request("ana");
    const first = await hold(
      "vesna",
      "SELECT institution.approve_mentorship_request($1)::text AS v",
      [requestId],
    );
    let second: Promise<string> | undefined;
    try {
      second = approve(requestId);
      await untilLockWait();
    } finally {
      await first.commit();
    }
    expect(await second).toBe(first.value);
    expect(await counts()).toStrictEqual({ mentorships: 1, approved: 1 });
  });

  it("refuses the waiting approval when the revocation of the role commits first", async () => {
    await resetCase();
    const requestId = await request("ana");
    const revocation = await hold(
      "iva",
      "SELECT institution.revoke_teacher_role($1) AS v",
      [people.vesna],
    );
    expect(revocation.value).toBe(true);
    let approval: Promise<string> | undefined;
    try {
      approval = approve(requestId);
      await untilLockWait();
    } finally {
      await revocation.commit();
    }
    expect(await outcome(approval)).toBe("ZD403");
    expect(await counts()).toStrictEqual({ mentorships: 0, approved: 0 });
    const open = await admin.query<{ open: boolean }>(
      "SELECT approved_at IS NULL AND withdrawn_at IS NULL AS open FROM institution.mentorship_request WHERE id = $1",
      [requestId],
    );
    expect(open.rows[0].open).toBe(true);
  });

  it("holds a revocation until the approval that saw the role commits", async () => {
    await resetCase();
    const requestId = await request("ana");
    const approval = await hold(
      "vesna",
      "SELECT institution.approve_mentorship_request($1)::text AS v",
      [requestId],
    );
    let revocation: Promise<boolean> | undefined;
    try {
      revocation = revoke();
      await untilLockWait();
    } finally {
      await approval.commit();
    }
    expect(await revocation).toBe(true);
    // The mentorship was made while the role stood; a new request to the
    // revoked teacher is refused.
    expect(await counts()).toStrictEqual({ mentorships: 1, approved: 1 });
    const other = await request("boris").catch((error: { code?: string }) =>
      error.code,
    );
    expect(other).toBe("ZD403");
  });

  it("refuses a new request of the kind that waited for the approval of the open one", async () => {
    await resetCase();
    const requestId = await request("ana");
    const approval = await hold(
      "vesna",
      "SELECT institution.approve_mentorship_request($1)::text AS v",
      [requestId],
    );
    let again: Promise<string> | undefined;
    try {
      again = request("ana");
      await untilLockWait();
    } finally {
      await approval.commit();
    }
    expect(await outcome(again)).toBe("ZD409");
    expect(await counts()).toStrictEqual({ mentorships: 1, approved: 1 });
    const open = await admin.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM institution.mentorship_request
       WHERE institution_id = $1 AND student_id = $2 AND approved_at IS NULL AND withdrawn_at IS NULL`,
      [institutionId, people.ana],
    );
    expect(open.rows[0].open).toBe(0);
  });

  it("leaves one open request when a student sends the same request twice at once", async () => {
    await resetCase();
    const results = await Promise.all([
      outcome(request("boris")),
      outcome(request("boris")),
    ]);
    expect([...results].sort()).toStrictEqual(["ZD409", "ok"]);
    const row = await admin.query<{ open: number }>(
      `SELECT count(*)::int AS open FROM institution.mentorship_request
       WHERE institution_id = $1 AND student_id = $2 AND approved_at IS NULL AND withdrawn_at IS NULL`,
      [institutionId, people.boris],
    );
    expect(row.rows[0].open).toBe(1);
  });
});
