import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createWithActor } from "@/server/db/with-actor";

// withActor against the compose stack (pnpm stack:up, pnpm db:migrate), over
// a real pool and a real ductus_app login (B-5, docs/BACKEND.md 4.3).
// Every identifier, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The login exists only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const LOGIN = "it_with_actor_login";
const password = randomBytes(24).toString("hex");
const newToken = () => randomBytes(32).toString("base64url");

const institutionA = randomUUID();
const institutionB = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const tokenA = newToken();
const tokenB = newToken();
const tokenLogout = newToken();

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pools: pg.Pool[] = [admin];

function appPool(max: number, options?: string) {
  const url = new URL(ADMIN_URL);
  url.username = LOGIN;
  url.password = password;
  const pool = new pg.Pool({ connectionString: url.href, max, options });
  pools.push(pool);
  return pool;
}

const WHO = "SELECT app.current_user_id() AS user_id, app.current_institution_id() AS institution_id, pg_catalog.pg_backend_pid() AS pid";
type Who = { user_id: string | null; institution_id: string | null; pid: number };
const who = (withActor: ReturnType<typeof createWithActor>, token: string | null) =>
  withActor(token, async (tx) => (await tx.query<Who>(WHO)).rows[0]);

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);

  const suffix = randomBytes(4).toString("hex");
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2), ($3, $4)", [
    institutionA, `it-a-${suffix}`, institutionB, `it-b-${suffix}`,
  ]);
  await admin.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, $5, 'sub-a', 'a@it-a.example'), ($3, $4, $5, 'sub-b', 'b@it-b.example')`,
    [userA, institutionA, userB, institutionB, `https://issuer-${suffix}.test`],
  );
  for (const [token, user, institution] of [
    [tokenA, userA, institutionA],
    [tokenB, userB, institutionB],
    [tokenLogout, userA, institutionA],
  ]) {
    await admin.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [token, user, institution],
    );
  }
});

afterAll(async () => {
  await Promise.all(pools.filter((pool) => pool !== admin).map((pool) => pool.end()));
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY ($1)", [[userA, userB]]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [[userA, userB]]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY ($1)", [[institutionA, institutionB]]);
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  await admin.end();
});

describe("withActor over a ductus_app login", () => {
  it("connects as a ductus_app member without SUPERUSER or BYPASSRLS, and cannot read sessions", async () => {
    const withActor = createWithActor(appPool(1));
    const role = await withActor(tokenA, async (tx) => {
      const { rows } = await tx.query(
        `SELECT session_user::text AS login, r.rolsuper, r.rolbypassrls, pg_has_role(r.oid, 'ductus_app', 'USAGE') AS member
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      return rows[0];
    });
    expect(role).toEqual({ login: LOGIN, rolsuper: false, rolbypassrls: false, member: true });

    await expect(
      withActor(tokenA, (tx) => tx.query("SELECT count(*) FROM identity.session")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("derives the actor from the session token alone", async () => {
    const withActor = createWithActor(appPool(1));
    expect(await who(withActor, tokenA)).toMatchObject({ user_id: userA, institution_id: institutionA });
    expect(await who(withActor, tokenB)).toMatchObject({ user_id: userB, institution_id: institutionB });
    for (const token of [null, "", newToken(), tokenA.slice(0, 42), `${tokenA} `, userA]) {
      expect(await who(withActor, token)).toMatchObject({ user_id: null, institution_id: null });
    }
  });

  it("leaves no token on the pooled connection after commit or rollback", async () => {
    const pool = appPool(1);
    const withActor = createWithActor(pool);
    const AFTER = `SELECT pg_catalog.pg_backend_pid() AS pid, current_setting('app.session_token', true) AS token, app.current_user_id() AS user_id`;

    const committed = await who(withActor, tokenA);
    expect(committed.user_id).toBe(userA);
    // After the first SET LOCAL the setting reads '' on that connection, not NULL.
    expect((await pool.query(AFTER)).rows[0]).toEqual({ pid: committed.pid, token: "", user_id: null });

    let rolledBackPid = 0;
    await expect(
      withActor(tokenA, async (tx) => {
        const { rows } = await tx.query<Who>(WHO);
        expect(rows[0].user_id).toBe(userA);
        rolledBackPid = rows[0].pid;
        throw new Error("fn failed");
      }),
    ).rejects.toThrow("fn failed");
    expect(rolledBackPid).toBe(committed.pid);
    expect((await pool.query(AFTER)).rows[0]).toEqual({ pid: committed.pid, token: "", user_id: null });
  });

  it("overrides a token that something else left on the connection", async () => {
    const pool = appPool(1);
    const withActor = createWithActor(pool);
    // What a session-level SET in a library or a careless query would do.
    await pool.query("SELECT set_config('app.session_token', $1, false)", [tokenA]);
    expect((await pool.query("SELECT app.current_user_id() AS user_id")).rows[0].user_id).toBe(userA);

    expect((await who(withActor, null)).user_id).toBeNull();
    expect((await who(withActor, tokenB)).user_id).toBe(userB);
  });

  it.each([1, 3])("keeps interleaved actors apart on a pool of %i", async (max) => {
    const withActor = createWithActor(appPool(max));
    const cases = Array.from({ length: 45 }, (_, i) => [[tokenA, userA], [tokenB, userB], [null, null]][i % 3]);
    const seen = await Promise.all(
      cases.map(([token]) =>
        withActor(token, async (tx) => {
          const first = (await tx.query<Who>(WHO)).rows[0].user_id;
          await tx.query("SELECT pg_catalog.pg_sleep(0.005)");
          return [first, (await tx.query<Who>(WHO)).rows[0].user_id];
        }),
      ),
    );
    expect(seen).toEqual(cases.map(([, user]) => [user, user]));
  });

  it("commits what fn did and rolls back when fn fails", async () => {
    const withActor = createWithActor(appPool(1));
    const logout = "SELECT identity.close_current_session() AS closed";

    await expect(
      withActor(tokenLogout, async (tx) => {
        expect((await tx.query(logout)).rows[0].closed).toBe(true);
        throw new Error("fn failed");
      }),
    ).rejects.toThrow("fn failed");
    expect((await who(withActor, tokenLogout)).user_id).toBe(userA);

    expect(await withActor(tokenLogout, async (tx) => (await tx.query(logout)).rows[0].closed)).toBe(true);
    expect((await who(withActor, tokenLogout)).user_id).toBeNull();
    expect((await who(withActor, tokenA)).user_id).toBe(userA);
  });

  it("fails when fn swallowed an error that aborted the transaction", async () => {
    const withActor = createWithActor(appPool(1));
    await expect(
      withActor(tokenA, async (tx) => {
        await tx.query("SELECT 1 / 0").catch(() => undefined);
        return "saved";
      }),
    ).rejects.toThrow("rolled back");
    expect((await who(withActor, tokenA)).user_id).toBe(userA);
  });

  it("refuses a superuser connection, also one that switched role to ductus_app", async () => {
    const switched = new pg.Pool({ connectionString: ADMIN_URL, max: 1, options: "-c role=ductus_app" });
    pools.push(switched);
    expect((await switched.query("SELECT current_user::text AS role")).rows[0].role).toBe("ductus_app");

    for (const pool of [admin, switched]) {
      const fn = vi.fn(async () => "ran");
      await expect(createWithActor(pool)(tokenA, fn)).rejects.toThrow("not a ductus_app login");
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

// DAN-129: what fn or the connection could carry past the transaction is
// refused, and a connection that may carry it is closed instead of pooled.
describe("withActor refuses what could outlive its transaction", () => {
  const AFTER = `SELECT pg_catalog.pg_backend_pid() AS pid, current_setting('app.session_token', true) AS token, app.current_user_id() AS user_id`;
  type After = { pid: number; token: string | null; user_id: string | null };

  it("refuses a superuser connection that took on an app login with SET SESSION AUTHORIZATION", async () => {
    const assumed = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
    pools.push(assumed);
    await assumed.query(`SET SESSION AUTHORIZATION ${LOGIN}`);
    const names = (await assumed.query("SELECT session_user::text AS login, current_user::text AS role")).rows[0];
    expect(names).toEqual({ login: LOGIN, role: LOGIN });

    const fn = vi.fn(async () => "ran");
    await expect(createWithActor(assumed)(tokenA, fn)).rejects.toThrow("not a ductus_app login");
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    `COMMIT; SELECT set_config('app.session_token', '%s', false)`,
    `commit; select set_config('app.session_token', '%s', false)`,
    `/* SELECT */ end; SELECT set_config('app.session_token', '%s', false)`,
    `SELECT 1; COMMIT; SELECT set_config('app.session_token', '%s', false)`,
    `-- SELECT\nSET app.session_token = '%s'`,
    `SAVEPOINT a; RELEASE a; SELECT set_config('app.session_token', '%s', false)`,
    `DISCARD ALL; SELECT '%s'`,
  ])("refuses %j and leaves no token on the pooled connection", async (template) => {
    const pool = appPool(1);
    const withActor = createWithActor(pool);
    const { pid } = await who(withActor, tokenB);

    await expect(withActor(tokenB, (tx) => tx.query(template.replace("%s", tokenA)))).rejects.toThrow();
    const after = (await pool.query<After>(AFTER)).rows[0];
    expect(after.user_id).toBeNull();
    expect(after.token === null || after.token === "").toBe(true);
    expect((await who(withActor, null)).user_id).toBeNull();
    expect((await who(withActor, tokenB)).user_id).toBe(userB);
    // A refused statement never reached the database; the connection stays.
    if (!template.startsWith("SELECT 1;")) expect(after.pid).toBe(pid);
  });

  it.each([
    ["replaces the token for the session", "SELECT set_config('app.session_token', $1, false)", () => [tokenA]],
    ["switches role for the session", "SELECT set_config('role', 'ductus_app', false)", () => []],
  ])("does not commit and closes the connection when fn %s", async (_name, statement, values) => {
    const pool = appPool(1);
    const withActor = createWithActor(pool);
    const { pid } = await who(withActor, tokenB);

    await expect(withActor(tokenB, (tx) => tx.query(statement, values()))).rejects.toThrow("changed inside fn");
    const after = (await pool.query<After>(AFTER)).rows[0];
    expect(after.pid).not.toBe(pid);
    expect(after.user_id).toBeNull();
    expect((await who(withActor, tokenB)).user_id).toBe(userB);
  });

  // Review on #160: a SELECT in fn can set any parameter for the session. The
  // login value of statement_timeout stands in for the limits of DAN-120.
  const SETTINGS = `SELECT pg_catalog.pg_backend_pid() AS pid,
    current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout,
    current_setting('search_path') AS search_path, current_setting('application_name') AS application_name,
    coalesce(current_setting('app.leftover', true), '') AS leftover,
    (SELECT count(*)::int FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND pid = pg_catalog.pg_backend_pid()) AS advisory_locks`;
  const LEAVE_BEHIND = `SELECT set_config('statement_timeout', '0', false), set_config('lock_timeout', '1', false),
    set_config('search_path', 'public', false), set_config('application_name', 'it-leftover', false),
    set_config('app.leftover', 'x', false), pg_catalog.pg_advisory_lock(4242)`;

  it.each([
    ["commits", async () => "saved"],
    ["fails", async () => Promise.reject(new Error("fn failed"))],
  ])("resets session settings and advisory locks that fn left when it %s", async (_name, end) => {
    const pool = appPool(1, "-c statement_timeout=15000 -c application_name=it-login");
    const withActor = createWithActor(pool);
    const settings = () => withActor(null, async (tx) => (await tx.query(SETTINGS)).rows[0]);
    const before = await settings();
    expect(before).toMatchObject({ statement_timeout: "15s", application_name: "it-login", advisory_locks: 0 });

    await withActor(tokenA, async (tx) => {
      await tx.query(LEAVE_BEHIND);
      expect((await tx.query(SETTINGS)).rows[0]).toMatchObject({ statement_timeout: "0", advisory_locks: 1 });
      return end();
    }).catch(() => undefined);
    // The same connection, back at its login values.
    expect(await settings()).toEqual(before);
    expect((await pool.query(SETTINGS)).rows[0]).toEqual(before);
    // The advisory lock went with it: another connection can take it.
    const other = await admin.connect();
    try {
      expect((await other.query("SELECT pg_catalog.pg_try_advisory_lock(4242) AS got")).rows[0].got).toBe(true);
      await other.query("SELECT pg_catalog.pg_advisory_unlock_all()");
    } finally {
      other.release();
    }
  });

  it("refuses a nested call instead of waiting for a second connection", async () => {
    const withActor = createWithActor(appPool(1));
    const inner = vi.fn(async () => "inner");
    await expect(withActor(tokenA, async () => withActor(tokenB, inner))).rejects.toThrow("nested call");
    expect(inner).not.toHaveBeenCalled();
    expect((await who(withActor, tokenA)).user_id).toBe(userA);
  });

  it("propagates a connection dropped inside fn and serves the next call on a new connection", async () => {
    const pool = appPool(1);
    const withActor = createWithActor(pool);
    let pid = 0;
    await expect(
      withActor(tokenA, async (tx) => {
        pid = (await tx.query<Who>(WHO)).rows[0].pid;
        await admin.query("SELECT pg_catalog.pg_terminate_backend($1)", [pid]);
        return tx.query(WHO);
      }),
    ).rejects.toThrow();
    const next = await who(withActor, tokenB);
    expect(next.pid).not.toBe(pid);
    expect(next.user_id).toBe(userB);
  });
});
