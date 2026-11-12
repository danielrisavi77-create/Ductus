import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type ActorTransaction } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-427 (contract on #1836, c.6820446364): pgTAP runs in one transaction and
// cannot race two saves. Here two real connections save one person's
// interface language at once. identity.set_interface_locale() writes with
// INSERT ... ON CONFLICT DO UPDATE, so the second waits on the first's row:
// after a commit it updates that row, after a rollback it inserts its own.
// Never a second row and never a unique_violation. Another account never
// waits. Every person is invented; random ids of one random institution,
// removed afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The interface locale race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const applicationName = `it_interface_locale_${suffix}`;
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 6, application_name: applicationName });
const withActor = createWithActor(app);

const institutionId = randomUUID();
const names = ["ema", "noa"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: randomBytes(32).toString("base64url") }])) as
  Record<Name, { id: string; token: string }>;

const save = (locale: string) => async (tx: ActorTransaction) =>
  (await tx.query<{ locale: string }>("SELECT identity.set_interface_locale($1) AS locale", [locale])).rows[0].locale;
const read = async (tx: ActorTransaction) =>
  (await tx.query<{ locale: string | null }>("SELECT identity.interface_locale() AS locale")).rows[0].locale;

/** Waits until a save is in PostgreSQL and blocked by another transaction. */
async function waitForBlocked(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE '%set_interface_locale%'
            AND a.wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`, [applicationName]);
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The second save did not reach PostgreSQL and wait on the first.");
}

/** Saves and keeps the transaction open until `release`; `rollback` ends it with an error. */
function hold(token: string, locale: string) {
  let started!: (value: string) => void;
  let failed!: (error: unknown) => void;
  let release!: (rollback: boolean) => void;
  const answered = new Promise<string>((resolve, reject) => { started = resolve; failed = reject; });
  const held = new Promise<boolean>((resolve) => { release = resolve; });
  const done = withActor(token, async (tx) => {
    const saved = await save(locale)(tx);
    started(saved);
    if (await held) throw new Error("rolled back on purpose");
    return saved;
  });
  void done.catch(failed);
  return { answered, release, done };
}

const rows = async (name: Name) => (await admin.query<{ interface_locale: string }>(
  "SELECT interface_locale FROM identity.user_preference WHERE user_id = $1", [people[name].id])).rows;
const reset = () => admin.query("DELETE FROM identity.user_preference WHERE institution_id = $1", [institutionId]);

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-interface-locale-${suffix}`]);
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
      for (const table of ["identity.user_preference", "identity.session", "identity.user_account"]) {
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

describe("interface locale saves under concurrency (DAN-427)", () => {
  it("two first saves at once leave one row with the later value", async () => {
    await reset();
    const first = hold(people.ema.token, "en");
    await expect(first.answered).resolves.toBe("en");
    const second = withActor(people.ema.token, save("hr"));
    await waitForBlocked();
    first.release(false);
    await expect(first.done).resolves.toBe("en");
    await expect(second).resolves.toBe("hr");
    expect(await rows("ema")).toEqual([{ interface_locale: "hr" }]);
    await expect(withActor(people.ema.token, read)).resolves.toBe("hr");
  });

  it("the second save inserts its own row when the first rolls back", async () => {
    await reset();
    const first = hold(people.ema.token, "en");
    await expect(first.answered).resolves.toBe("en");
    const second = withActor(people.ema.token, save("hr"));
    await waitForBlocked();
    first.release(true);
    await expect(first.done).rejects.toThrow("rolled back on purpose");
    await expect(second).resolves.toBe("hr");
    expect(await rows("ema")).toEqual([{ interface_locale: "hr" }]);
  });

  it("many saves at once never fail and leave one row", async () => {
    await reset();
    const locales = ["en", "hr", "en", "hr", "en", "hr"];
    const outcomes = await Promise.allSettled(locales.map((locale) => withActor(people.ema.token, save(locale))));
    expect(outcomes.map((outcome) => outcome.status)).toEqual(locales.map(() => "fulfilled"));
    const stored = await rows("ema");
    expect(stored).toHaveLength(1);
    expect(locales).toContain(stored[0]?.interface_locale);
  });

  it("does not make another account wait", async () => {
    await reset();
    const first = hold(people.ema.token, "en");
    await expect(first.answered).resolves.toBe("en");
    try {
      await expect(withActor(people.noa.token, save("en"))).resolves.toBe("en");
    } finally {
      first.release(false);
      await first.done;
    }
    expect(await rows("noa")).toEqual([{ interface_locale: "en" }]);
    expect(await rows("ema")).toEqual([{ interface_locale: "en" }]);
  });
});
