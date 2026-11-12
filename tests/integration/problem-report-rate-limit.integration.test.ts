import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-431 (contract on #1836, c.6788234570): pgTAP runs in one transaction and
// cannot race two reports. Here two real connections send a report from the
// same account at once while it already has four in the hour.
// identity.submit_problem_report() locks the caller's user_account row before
// it counts, so the second waits for the first: after a commit it counts five
// and is refused (ZD429), after a rollback it counts four and is stored. A
// report from another account never waits on that lock. Every person and text
// is invented; random ids of one random institution, removed afterwards.
// Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The problem report race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_problem_report_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 6, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
// Iva sends the reports; Lea only shows that another account does not wait.
const names = ["iva", "lea"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;

const submit = async (tx: ActorTransaction) =>
  (await tx.query<{ reference: string }>(
    "SELECT identity.submit_problem_report($1, $2, $3, $4, $5, $6::integer, $7) AS reference",
    ["technical", `Izmisljena prijava ${suffix}.`, "/rad", "1.0.0", "firefox", 128, "SYNCED"])).rows[0].reference;

/** Waits until a report is in PostgreSQL and blocked by another transaction. */
async function waitForBlocked(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE '%submit_problem_report%'
            AND a.wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`, [applicationName]);
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The second report did not reach PostgreSQL and wait on the first.");
}

/** Sends a report and keeps its transaction open until `release`; `rollback` ends it with an error. */
function hold(token: string) {
  let started!: (value: string) => void;
  let failed!: (error: unknown) => void;
  let release!: (rollback: boolean) => void;
  const answered = new Promise<string>((resolve, reject) => { started = resolve; failed = reject; });
  const held = new Promise<boolean>((resolve) => { release = resolve; });
  const done = withActor(token, async (tx) => {
    const reference = await submit(tx);
    started(reference);
    if (await held) throw new Error("rolled back on purpose");
    return reference;
  });
  void done.catch(failed);
  return { answered, release, done };
}

const settle = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ value, code: null as string | null }),
  (error: { code?: string }) => ({ value: null, code: error.code ?? "no code" }),
);
const stored = async (name: Name) => Number((await admin.query<{ n: string }>(
  "SELECT count(*) AS n FROM identity.problem_report WHERE user_id = $1", [people[name].id])).rows[0].n);

/** Leaves `count` reports from the last half hour on Iva's account and none on Lea's. */
async function seed(count: number) {
  await admin.query("DELETE FROM identity.problem_report WHERE institution_id = $1", [institutionId]);
  for (let i = 0; i < count; i += 1) {
    await admin.query(
      `INSERT INTO identity.problem_report (reference, institution_id, user_id, category, description, app_version,
                                            browser_family, created_at)
       VALUES ($1, $2, $3, 'technical', 'Izmisljena ranija prijava.', '1.0.0', 'other', now() - interval '30 minutes')`,
      [`PR-${randomBytes(5).toString("hex").toUpperCase()}`, institutionId, people.iva.id]);
  }
}

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-problem-report-${suffix}`]);
    for (const name of names) {
      const { id, token } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`, [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`]);
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`, [token, id, institutionId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  try {
    await app.end();
  } finally {
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      for (const table of ["identity.problem_report", "identity.session", "identity.user_account"]) {
        await client.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
      }
      await client.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await admin.end();
    }
  }
});

describe("problem report hourly limit under concurrency (DAN-431)", () => {
  it("lets the second of two reports at once count the first and refuses it", async () => {
    await seed(4);
    const first = hold(people.iva.token);
    await expect(first.answered).resolves.toMatch(/^PR-[0-9A-F]{10}$/);
    const second = settle(withActor(people.iva.token, submit));
    await waitForBlocked();
    first.release(false);
    await expect(first.done).resolves.toMatch(/^PR-[0-9A-F]{10}$/);
    await expect(second).resolves.toEqual({ value: null, code: "ZD429" });
    expect(await stored("iva")).toBe(5);
  });

  it("stores the second report when the first one rolls back", async () => {
    await seed(4);
    const first = hold(people.iva.token);
    await expect(first.answered).resolves.toMatch(/^PR-[0-9A-F]{10}$/);
    const second = settle(withActor(people.iva.token, submit));
    await waitForBlocked();
    first.release(true);
    await expect(first.done).rejects.toThrow("rolled back on purpose");
    const outcome = await second;
    expect(outcome.code).toBeNull();
    expect(outcome.value).toMatch(/^PR-[0-9A-F]{10}$/);
    expect(await stored("iva")).toBe(5);
  });

  it("never stores a sixth report from five sent at once", async () => {
    await seed(1);
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => settle(withActor(people.iva.token, submit))));
    expect(outcomes.filter((outcome) => outcome.code === null)).toHaveLength(4);
    expect(outcomes.filter((outcome) => outcome.code !== null).map((outcome) => outcome.code)).toEqual(["ZD429"]);
    expect(await stored("iva")).toBe(5);
  });

  it("does not make another account wait on the lock", async () => {
    await seed(4);
    const first = hold(people.iva.token);
    await expect(first.answered).resolves.toMatch(/^PR-[0-9A-F]{10}$/);
    try {
      await expect(withActor(people.lea.token, submit)).resolves.toMatch(/^PR-[0-9A-F]{10}$/);
    } finally {
      first.release(false);
      await first.done;
    }
    expect(await stored("lea")).toBe(1);
    expect(await stored("iva")).toBe(5);
  });
});
