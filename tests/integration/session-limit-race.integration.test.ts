import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The five-session limit on two connections (DAN-296, D-200 P2). Two logins
// of one account at once are put in a row by the lock on its user_account
// row, so the second counts the first one's session; a touch that races the
// login that supersedes its session does not revive it, whichever of the two
// holds the row first; and a login under a
// snapshot isolation level is refused. Logins run as a ductus_auth login,
// touches as a ductus_app login.
// Every identifier, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The logins exist only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const AUTH_LOGIN = "it_session_limit_race_auth";
const APP_LOGIN = "it_session_limit_race_app";
const password = randomBytes(24).toString("hex");

const suffix = randomBytes(4).toString("hex");
const institution = randomUUID();
const homeOrg = `slr-${suffix}.ductus.test`;
const issuer = `https://issuer-slr-${suffix}.test`;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const clients: pg.Client[] = [];

async function client(login: string) {
  const url = new URL(ADMIN_URL);
  url.username = login;
  url.password = password;
  const c = new pg.Client({ connectionString: url.href });
  clients.push(c);
  await c.connect();
  const pid = (await c.query<{ pid: number }>("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0].pid;
  return { c, pid };
}

const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token).digest() };
};
const OPEN = "SELECT identity.open_session($1, $2, $3, $4, $5, $6, $7, $8, $9) AS expires";
const openArgs = (tokenHash: Buffer, person: string) =>
  [issuer, `sub-${person}-${suffix}`, `${person}@${homeOrg}`, homeOrg, tokenHash, null, null, false, null];
const outcome = (pending: Promise<pg.QueryResult>) =>
  pending.then(
    () => "ok",
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
const counts = async (person: string) =>
  (await admin.query<{ live: string; superseded: string }>(
    `SELECT count(*) FILTER (WHERE s.closed_at IS NULL AND s.expires_at > now()
                               AND s.last_seen_at > now() - interval '2 hours') AS live,
            count(*) FILTER (WHERE s.close_reason = 'superseded') AS superseded
     FROM identity.session s JOIN identity.user_account u ON u.id = s.user_id
     WHERE u.oidc_issuer = $1 AND u.hr_edu_person_unique_id = $2`,
    [issuer, `${person}@${homeOrg}`],
  )).rows.map((r) => ({ live: Number(r.live), superseded: Number(r.superseded) }))[0];

/**
 * Commits four logins of `person`, then dates them so their order is known:
 * the first is the least active, last seen 50 minutes ago.
 */
async function fourLogins(person: string) {
  const auth = await client(AUTH_LOGIN);
  const tokens = [];
  for (let i = 0; i < 4; i += 1) {
    const t = newToken();
    await auth.c.query(OPEN, openArgs(t.tokenHash, person));
    tokens.push(t);
  }
  for (const [i, t] of tokens.entries()) {
    await admin.query(
      `UPDATE identity.session SET created_at = now() - interval '1 hour',
              last_seen_at = now() - make_interval(mins => $2::int) WHERE token_hash = $1`,
      [t.tokenHash, 50 - i * 10],
    );
  }
  return tokens;
}

beforeAll(async () => {
  for (const [login, role] of [[AUTH_LOGIN, "ductus_auth"], [APP_LOGIN, "ductus_app"]]) {
    await admin.query(`DROP ROLE IF EXISTS ${login}`);
    const ddl = await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE %I', $1::text, $2::text, $3::text) AS ddl",
      [login, password, role],
    );
    await admin.query(ddl.rows[0].ddl);
  }
  await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
    institution, `slr-${suffix}`, homeOrg,
  ]);
  await admin.query("INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2)", [institution, issuer]);
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  await admin.query("DELETE FROM identity.session WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.teacher_eligibility WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.person_name WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.institution_issuer WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.end();
});

describe("five sessions per account on two connections", () => {
  it("two logins at once at four live sessions: the second waits, counts the first and supersedes one", async () => {
    const old = await fourLogins("ana");
    const first = await client(AUTH_LOGIN);
    const second = await client(AUTH_LOGIN);
    const a = newToken();
    const b = newToken();

    await first.c.query("BEGIN");
    expect(await outcome(first.c.query(OPEN, openArgs(a.tokenHash, "ana")))).toBe("ok");
    const other = outcome(second.c.query(OPEN, openArgs(b.tokenHash, "ana")));
    const waited = await settlesOrWaits(other, second.pid);
    await first.c.query("COMMIT");

    expect(waited).toBe(true);
    expect(await other).toBe("ok");
    expect(await counts("ana")).toEqual({ live: 5, superseded: 1 });
    expect(await sessionState(old[0].tokenHash)).toBe("superseded");
    expect([await sessionState(a.tokenHash), await sessionState(b.tokenHash)]).toEqual(["open", "open"]);
  });

  it("when the first login rolls back, the waiting one finds four others and supersedes nothing", async () => {
    await fourLogins("iva");
    const first = await client(AUTH_LOGIN);
    const second = await client(AUTH_LOGIN);
    const a = newToken();
    const b = newToken();

    await first.c.query("BEGIN");
    await first.c.query(OPEN, openArgs(a.tokenHash, "iva"));
    const other = outcome(second.c.query(OPEN, openArgs(b.tokenHash, "iva")));
    const waited = await settlesOrWaits(other, second.pid);
    await first.c.query("ROLLBACK");

    expect(waited).toBe(true);
    expect(await other).toBe("ok");
    expect(await counts("iva")).toEqual({ live: 5, superseded: 0 });
    expect([await sessionState(a.tokenHash), await sessionState(b.tokenHash)]).toEqual(["none", "open"]);
  });

  it("a touch of the session a login is superseding waits and does not revive it", async () => {
    await fourLogins("dora");
    const fifth = newToken();
    const auth = await client(AUTH_LOGIN);
    await auth.c.query(OPEN, openArgs(fifth.tokenHash, "dora"));
    await admin.query(
      "UPDATE identity.session SET created_at = now() - interval '1 hour', last_seen_at = now() - interval '55 minutes' WHERE token_hash = $1",
      [fifth.tokenHash],
    );
    const login = await client(AUTH_LOGIN);
    const app = await client(APP_LOGIN);
    const sixth = newToken();

    await login.c.query("BEGIN");
    await login.c.query(OPEN, openArgs(sixth.tokenHash, "dora"));
    expect(await sessionState(fifth.tokenHash)).toBe("open"); // not yet committed
    await app.c.query("BEGIN");
    await app.c.query("SELECT pg_catalog.set_config('app.session_token', $1, true)", [fifth.token]);
    const touch = app.c.query<{ touched: boolean }>("SELECT identity.touch_current_session() AS touched");
    const waited = await settlesOrWaits(touch, app.pid);
    await login.c.query("COMMIT");
    const touched = (await touch).rows[0].touched;
    await app.c.query("COMMIT");

    expect(waited).toBe(true);
    expect(touched).toBe(false);
    expect(await sessionState(fifth.tokenHash)).toBe("superseded");
    expect(await counts("dora")).toEqual({ live: 5, superseded: 1 });
  });

  it("a login that waits on a touch of the least active session supersedes the next one instead", async () => {
    const old = await fourLogins("lea");
    const fifth = newToken();
    const auth = await client(AUTH_LOGIN);
    await auth.c.query(OPEN, openArgs(fifth.tokenHash, "lea"));
    await admin.query(
      "UPDATE identity.session SET created_at = now() - interval '1 hour', last_seen_at = now() - interval '55 minutes' WHERE token_hash = $1",
      [fifth.tokenHash],
    );
    const app = await client(APP_LOGIN);
    const login = await client(AUTH_LOGIN);
    const sixth = newToken();

    // The touch has written the least active session and holds its row.
    await app.c.query("BEGIN");
    await app.c.query("SELECT pg_catalog.set_config('app.session_token', $1, true)", [fifth.token]);
    const touched = (await app.c.query<{ touched: boolean }>("SELECT identity.touch_current_session() AS touched")).rows[0].touched;
    const other = outcome(login.c.query(OPEN, openArgs(sixth.tokenHash, "lea")));
    const waited = await settlesOrWaits(other, login.pid);
    await app.c.query("COMMIT");

    expect(touched).toBe(true);
    expect(waited).toBe(true);
    expect(await other).toBe("ok");
    expect(await sessionState(fifth.tokenHash)).toBe("open");
    expect(await sessionState(old[0].tokenHash)).toBe("superseded");
    expect(await sessionState(sixth.tokenHash)).toBe("open");
    expect(await counts("lea")).toEqual({ live: 5, superseded: 1 });
  });

  // A snapshot taken before another login committed would hide its session,
  // so a live login is refused under any level but READ COMMITTED.
  it.each(["REPEATABLE READ", "SERIALIZABLE"])("under %s a login is refused and leaves nothing", async (level) => {
    const auth = await client(AUTH_LOGIN);
    const t = newToken();

    await auth.c.query(`BEGIN ISOLATION LEVEL ${level}`);
    const result = await outcome(auth.c.query(OPEN, openArgs(t.tokenHash, "boris")));
    await auth.c.query("ROLLBACK");

    expect(result).toBe("25000");
    expect(await sessionState(t.tokenHash)).toBe("none");
  });
});
