import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

// "Sign me out everywhere" on real connections (DAN-296, D-200 P2; contract on
// #1091). identity.close_all_sessions_for_identity() runs as a ductus_app
// login through withActor, the same statement src/server/auth/deps.ts sends.
// It closes the caller's account and nothing else, does not wait on a login
// that has not committed, and a second call at the same time waits and closes
// nothing more. Logins run as a ductus_auth login.
// Every identifier, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The logins exist only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const AUTH_LOGIN = "it_logout_all_auth";
const APP_LOGIN = "it_logout_all_app";
const password = randomBytes(24).toString("hex");

const suffix = randomBytes(4).toString("hex");
const institutions = [randomUUID(), randomUUID()];
const homeOrgs = [`la-${suffix}.ductus.test`, `la2-${suffix}.ductus.test`];
const issuers = [`https://issuer-la-${suffix}.test`, `https://issuer-la2-${suffix}.test`];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const clients: pg.Client[] = [];
const pools: pg.Pool[] = [];

const loginUrl = (login: string) => {
  const url = new URL(ADMIN_URL);
  url.username = login;
  url.password = password;
  return url.href;
};
async function client(login: string) {
  const c = new pg.Client({ connectionString: loginUrl(login) });
  clients.push(c);
  await c.connect();
  const pid = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0].pid;
  return { c, pid };
}

// A session token as the app issues it: 32 random bytes in base64url; the
// database keeps only its SHA-256.
const newToken = () => randomBytes(32).toString("base64url");
const hashOf = (token: string) => createHash("sha256").update(token, "utf8").digest();
const OPEN = "SELECT identity.open_session($1, $2, $3, $4, $5, $6, $7, $8, $9) AS expires";
const openArgs = (token: string, person: string, at = 0) =>
  [issuers[at], `sub-${person}-${suffix}`, `${person}@${homeOrgs[at]}`, homeOrgs[at], hashOf(token), null, null, false, null];
const CLOSE_ALL = "SELECT identity.close_all_sessions_for_identity()";
// What withActor sets, for the calls that must hold their transaction open.
const ENTER = "SELECT pg_catalog.set_config('app.session_token', $1, true)";

/** Resolves once `pending` has settled or backend `pid` waits for a lock; true when it waits. */
async function settlesOrWaits(pending: Promise<unknown>, pid: number): Promise<boolean> {
  let settled = false;
  void pending.then(() => (settled = true), () => (settled = true));
  for (let i = 0; i < 100; i += 1) {
    if (settled) return false;
    const r = await admin.query("SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [pid]);
    if (r.rowCount) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("neither settled nor waiting for a lock");
}

const state = async (token: string) =>
  (await admin.query<{ state: string }>(
    "SELECT coalesce(close_reason, 'open') AS state FROM identity.session WHERE token_hash = $1",
    [hashOf(token)],
  )).rows[0]?.state ?? "none";
const closedAt = async (token: string) =>
  (await admin.query<{ closed_at: Date | null }>("SELECT closed_at FROM identity.session WHERE token_hash = $1", [hashOf(token)]))
    .rows[0]?.closed_at?.toISOString() ?? null;

/** Opens and commits a session of `person`; returns its token. */
async function login(person: string, at = 0) {
  const token = newToken();
  const auth = await client(AUTH_LOGIN);
  await auth.c.query(OPEN, openArgs(token, person, at));
  return token;
}

let withActor: WithActor;
const logoutAll = (token: string) => withActor(token, async (tx) => {
  await tx.query(CLOSE_ALL);
});

beforeAll(async () => {
  for (const [login, group] of [[AUTH_LOGIN, "ductus_auth"], [APP_LOGIN, "ductus_app"]]) {
    await admin.query(`DROP ROLE IF EXISTS ${login}`);
    const ddl = await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE %I', $1::text, $2::text, $3::text) AS ddl",
      [login, password, group],
    );
    await admin.query(ddl.rows[0].ddl);
  }
  for (const at of [0, 1]) {
    await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
      institutions[at], `la${at}-${suffix}`, homeOrgs[at],
    ]);
    await admin.query("INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2)", [
      institutions[at], issuers[at],
    ]);
  }
  const appPool = new pg.Pool({ connectionString: loginUrl(APP_LOGIN), max: 2 });
  pools.push(appPool);
  withActor = createWithActor(appPool);
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  await Promise.all(pools.map((p) => p.end()));
  for (const at of [0, 1]) {
    await admin.query("DELETE FROM identity.logout_token_jti WHERE oidc_issuer = $1", [issuers[at]]);
    await admin.query(
      "DELETE FROM identity.session WHERE user_id IN (SELECT id FROM identity.user_account WHERE institution_id = $1)",
      [institutions[at]],
    );
    await admin.query("DELETE FROM identity.teacher_eligibility WHERE institution_id = $1", [institutions[at]]);
    await admin.query("DELETE FROM identity.person_name WHERE institution_id = $1", [institutions[at]]);
    await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutions[at]]);
    await admin.query("DELETE FROM identity.institution_issuer WHERE institution_id = $1", [institutions[at]]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutions[at]]);
  }
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.end();
});

describe("sign out on every device", () => {
  it("class 1: closes every live session of the account, the calling one included", async () => {
    const here = await login("ana");
    const phone = await login("ana");

    await logoutAll(here);

    expect(await state(here)).toBe("logout_all");
    expect(await state(phone)).toBe("logout_all");
  });

  it("class 9: leaves other accounts alone, in the same institution and in another", async () => {
    const mine = await login("ana");
    const neighbour = await login("iva");
    const elsewhere = await login("ana", 1);

    await logoutAll(mine);

    expect(await state(mine)).toBe("logout_all");
    expect(await state(neighbour)).toBe("open");
    expect(await state(elsewhere)).toBe("open");
  });

  it("class 3: an unknown, malformed or closed token closes nothing", async () => {
    const bystander = await login("ivo");
    const closed = await login("ivo");
    await admin.query("UPDATE identity.session SET closed_at = now(), close_reason = 'logout' WHERE token_hash = $1", [hashOf(closed)]);

    for (const token of [newToken(), "not-a-token", closed]) await logoutAll(token);

    expect(await state(bystander)).toBe("open");
    expect(await state(closed)).toBe("logout");
  });

  it("does not wait on a login of the same account that has not committed, and that login stays open", async () => {
    const one = await login("mia");
    const two = await login("mia");
    const auth = await client(AUTH_LOGIN);
    const late = newToken();

    // The login has run open_session (and the session-limit trigger, where
    // the migration has it) but has not committed.
    await auth.c.query("BEGIN");
    await auth.c.query(OPEN, openArgs(late, "mia"));
    const app = await client(APP_LOGIN);
    await app.c.query("BEGIN");
    await app.c.query(ENTER, [one]);
    const pending = app.c.query(CLOSE_ALL);
    const appWaits = await settlesOrWaits(pending, app.pid);
    await pending;
    await app.c.query("COMMIT");
    await auth.c.query("COMMIT");

    expect(appWaits).toBe(false);
    expect(await state(one)).toBe("logout_all");
    expect(await state(two)).toBe("logout_all");
    expect(await state(late)).toBe("open");
  });

  it("two calls of one account at once: the second waits for the first and closes nothing more", async () => {
    const one = await login("lea");
    const two = await login("lea");
    const first = await client(APP_LOGIN);
    const second = await client(APP_LOGIN);

    await first.c.query("BEGIN");
    await first.c.query(ENTER, [one]);
    await first.c.query(CLOSE_ALL);
    await second.c.query("BEGIN");
    await second.c.query(ENTER, [two]);
    const pending = second.c.query(CLOSE_ALL);
    const waited = await settlesOrWaits(pending, second.pid);
    await first.c.query("COMMIT");
    const firstClosed = [await closedAt(one), await closedAt(two)];
    await pending;
    await second.c.query("COMMIT");

    expect(waited).toBe(true);
    expect(await state(one)).toBe("logout_all");
    expect(await state(two)).toBe("logout_all");
    expect([await closedAt(one), await closedAt(two)]).toEqual(firstClosed);
  });

  it("class 6: a call that rolls back leaves every session open", async () => {
    const one = await login("eva");
    const two = await login("eva");

    await expect(
      withActor(one, async (tx) => {
        await tx.query(CLOSE_ALL);
        throw new Error("fails after the update");
      }),
    ).rejects.toThrow("fails after the update");

    expect(await state(one)).toBe("open");
    expect(await state(two)).toBe("open");
  });
});
