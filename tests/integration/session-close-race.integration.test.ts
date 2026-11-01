import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A change to an institution and a login in flight on two connections
// (F-036, DAN-169; Codex r4437426085). open_session reads the institution and
// issuer rows FOR SHARE, so neither order lets a session outlive the change.
// The login runs as a ductus_auth login, the change as the operator would.
// Every identifier, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The login exists only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const AUTH_LOGIN = "it_session_close_race_auth";
const password = randomBytes(24).toString("hex");

const suffix = randomBytes(4).toString("hex");
const institution = randomUUID();
const homeOrg = `race-${suffix}.ductus.test`;
const issuer = `https://issuer-race-${suffix}.test`;

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
// The eight-argument form is the one ductus_auth may call (DAN-304).
const OPEN = "SELECT identity.open_session($1, $2, $3, $4, $5, $6, $7, $8) AS expires";
const openArgs = (tokenHash: Buffer, home = homeOrg, person = "ana") =>
  [issuer, `sub-${person}-${suffix}`, `${person}@${homeOrg}`, home, tokenHash, "Ana", "Testić", false];

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

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_auth', $1::text, $2::text) AS ddl",
    [AUTH_LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
    institution, `race-${suffix}`, homeOrg,
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
  await admin.end();
});

describe("institution change and a login in flight", () => {
  it("an issuer removed while a login is still open closes that login's session", async () => {
    const login = await client(authUrl());
    const operator = await client(ADMIN_URL);
    const tokenHash = hash();

    try {
      await login.c.query("BEGIN");
      await login.c.query(OPEN, openArgs(tokenHash));
      await operator.c.query("BEGIN");
      const removal = operator.c.query("DELETE FROM identity.institution_issuer WHERE institution_id = $1 AND oidc_issuer = $2", [
        institution, issuer,
      ]);
      const waited = await settlesOrWaits(removal, operator.pid);
      await login.c.query("COMMIT");
      await removal;
      await operator.c.query("COMMIT");

      expect(waited).toBe(true);
      expect(await sessionState(tokenHash)).toBe("issuer_removed");
    } finally {
      await admin.query(
        "INSERT INTO identity.institution_issuer (institution_id, oidc_issuer) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [institution, issuer],
      );
    }
  });

  it("a login that starts while aai_home_org is being changed is refused once the change commits", async () => {
    const login = await client(authUrl());
    const operator = await client(ADMIN_URL);
    const tokenHash = hash();

    try {
      await operator.c.query("BEGIN");
      await operator.c.query("UPDATE identity.institution SET aai_home_org = $2 WHERE id = $1", [institution, `moved-${homeOrg}`]);
      const attempt = login.c.query(OPEN, openArgs(tokenHash)).then(
        () => "ok",
        (error: { code?: string }) => error.code ?? "error",
      );
      const waited = await settlesOrWaits(attempt, login.pid);
      await operator.c.query("COMMIT");

      expect(waited).toBe(true);
      expect(await attempt).toBe("ZD503");
      expect(await sessionState(tokenHash)).toBe("none");
    } finally {
      await operator.c.query("ROLLBACK").catch(() => {});
      await admin.query("UPDATE identity.institution SET aai_home_org = $2 WHERE id = $1", [institution, homeOrg]);
    }
  });

  it("logins do not wait for one another", async () => {
    const first = await client(authUrl());
    const second = await client(authUrl());
    const a = hash();
    const b = hash();

    await first.c.query("BEGIN");
    // Two people: one person's logins share that person's own rows (the name).
    await first.c.query(OPEN, openArgs(a));
    const other = second.c.query(OPEN, openArgs(b, homeOrg, "iva"));
    const waited = await settlesOrWaits(other, second.pid);
    await first.c.query("COMMIT");
    await other;

    expect(waited).toBe(false);
    expect([await sessionState(a), await sessionState(b)]).toEqual(["open", "open"]);
  });
});
