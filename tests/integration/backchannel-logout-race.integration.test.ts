import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Back-channel logout on two connections (DAN-474; plan of attack #1620 B2,
// D1, D2, F4). One logout token closes once: a second call with its jti waits
// for the first and is refused. A login that has not committed is not seen
// and stays open. Both calls run as a ductus_auth login.
// Every identifier, sid, jti, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The login exists only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const AUTH_LOGIN = "it_backchannel_logout_race_auth";
const password = randomBytes(24).toString("hex");

const suffix = randomBytes(4).toString("hex");
const institution = randomUUID();
const homeOrg = `bcl-${suffix}.ductus.test`;
const issuer = `https://issuer-bcl-${suffix}.test`;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const clients: pg.Client[] = [];

async function client(url: string) {
  const c = new pg.Client({ connectionString: url });
  clients.push(c);
  await c.connect();
  const pid = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0].pid;
  return { c, pid };
}
const authUrl = () => {
  const url = new URL(ADMIN_URL);
  url.username = AUTH_LOGIN;
  url.password = password;
  return url.href;
};

const hash = () => createHash("sha256").update(randomBytes(32)).digest();
const fresh = (what: string) => `${what}-${randomBytes(8).toString("hex")}`;
const OPEN = "SELECT identity.open_session($1, $2, $3, $4, $5, $6, $7, $8, $9) AS expires";
const openArgs = (tokenHash: Buffer, person: string, sid: string | null) =>
  [issuer, `sub-${person}-${suffix}`, `${person}@${homeOrg}`, homeOrg, tokenHash, null, null, false, sid];
const LOGOUT = "SELECT identity.backchannel_logout($1, $2, $3, $4) AS n";
const outcome = (pending: Promise<pg.QueryResult<{ n: number }>>) =>
  pending.then(
    (r) => String(r.rows[0].n),
    (error: { code?: string }) => error.code ?? "error",
  );

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

const sessionState = async (tokenHash: Buffer) =>
  (await admin.query<{ state: string }>(
    "SELECT coalesce(close_reason, 'open') AS state FROM identity.session WHERE token_hash = $1",
    [tokenHash],
  )).rows[0]?.state ?? "none";
const jtiRecords = async (jti: string) =>
  (await admin.query(
    "SELECT 1 FROM identity.logout_token_jti WHERE oidc_issuer = $1 AND jti_hash = sha256(convert_to($2, 'UTF8'))",
    [issuer, jti],
  )).rowCount;

/** Opens and commits a session of `person` with `sid`. */
async function login(person: string, sid: string | null) {
  const tokenHash = hash();
  const auth = await client(authUrl());
  await auth.c.query(OPEN, openArgs(tokenHash, person, sid));
  return tokenHash;
}

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_auth', $1::text, $2::text) AS ddl",
    [AUTH_LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
    institution, `bcl-${suffix}`, homeOrg,
  ]);
  await admin.query("INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2)", [institution, issuer]);
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  await admin.query("DELETE FROM identity.logout_token_jti WHERE oidc_issuer = $1", [issuer]);
  await admin.query("DELETE FROM identity.session WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.teacher_eligibility WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.person_name WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.institution_issuer WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.end();
});

describe("back-channel logout on two connections", () => {
  it("B2: the same token twice at once closes once; the second call waits and is refused as a replay", async () => {
    const sid = fresh("sid");
    const jti = fresh("jti");
    const tokenHash = await login("ana", sid);
    const first = await client(authUrl());
    const second = await client(authUrl());

    await first.c.query("BEGIN");
    expect(await outcome(first.c.query(LOGOUT, [issuer, null, sid, jti]))).toBe("1");
    await second.c.query("BEGIN");
    const replay = outcome(second.c.query(LOGOUT, [issuer, null, sid, jti]));
    const waited = await settlesOrWaits(replay, second.pid);
    await first.c.query("COMMIT");
    const result = await replay;
    await second.c.query("ROLLBACK");

    expect(waited).toBe(true);
    expect(result).toBe("ZD409");
    expect(await sessionState(tokenHash)).toBe("backchannel_logout");
    expect(await jtiRecords(jti)).toBe(1);
  });

  it("B2: when the first call rolls back, the waiting one counts the token and closes", async () => {
    const sid = fresh("sid");
    const jti = fresh("jti");
    const tokenHash = await login("ana", sid);
    const first = await client(authUrl());
    const second = await client(authUrl());

    await first.c.query("BEGIN");
    await first.c.query(LOGOUT, [issuer, null, sid, jti]);
    const other = outcome(second.c.query(LOGOUT, [issuer, null, sid, jti]));
    const waited = await settlesOrWaits(other, second.pid);
    await first.c.query("ROLLBACK");

    expect(waited).toBe(true);
    expect(await other).toBe("1");
    expect(await sessionState(tokenHash)).toBe("backchannel_logout");
    expect(await jtiRecords(jti)).toBe(1);
  });

  it("D1: a login with the sid that has not committed is not seen and stays open", async () => {
    const sid = fresh("sid");
    const jti = fresh("jti");
    const loginConn = await client(authUrl());
    const logout = await client(authUrl());
    const tokenHash = hash();

    await loginConn.c.query("BEGIN");
    await loginConn.c.query(OPEN, openArgs(tokenHash, "dora", sid));
    const call = outcome(logout.c.query(LOGOUT, [issuer, null, sid, jti]));
    const waited = await settlesOrWaits(call, logout.pid);
    await loginConn.c.query("COMMIT");

    expect(waited).toBe(false);
    expect(await call).toBe("0");
    expect(await sessionState(tokenHash)).toBe("open");
  });

  it("D2: a sub closes the committed sessions of the account, not a login still in flight", async () => {
    const committed = await login("iva", fresh("sid"));
    const jti = fresh("jti");
    const loginConn = await client(authUrl());
    const logout = await client(authUrl());
    const inFlight = hash();

    await loginConn.c.query("BEGIN");
    await loginConn.c.query(OPEN, openArgs(inFlight, "iva", fresh("sid")));
    const call = outcome(logout.c.query(LOGOUT, [issuer, `sub-iva-${suffix}`, null, jti]));
    const waited = await settlesOrWaits(call, logout.pid);
    await loginConn.c.query("COMMIT");

    expect(waited).toBe(false);
    expect(await call).toBe("1");
    expect([await sessionState(committed), await sessionState(inFlight)]).toEqual(["backchannel_logout", "open"]);
  });

  // A snapshot taken before a login committed would hide its session, so the
  // call is refused under any level but READ COMMITTED (F4).
  it.each(["REPEATABLE READ", "SERIALIZABLE"])("F4: under %s the call is refused and leaves nothing", async (level) => {
    const sid = fresh("sid");
    const jti = fresh("jti");
    const tokenHash = await login("boris", sid);
    const auth = await client(authUrl());

    await auth.c.query(`BEGIN ISOLATION LEVEL ${level}`);
    const result = await outcome(auth.c.query(LOGOUT, [issuer, null, sid, jti]));
    await auth.c.query("ROLLBACK");

    expect(result).toBe("25000");
    expect(await sessionState(tokenHash)).toBe("open");
    expect(await jtiRecords(jti)).toBe(0);
  });
});
