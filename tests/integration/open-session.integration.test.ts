import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOpenSession } from "@/server/db/open-session";

// openSession against the compose stack (pnpm stack:up, pnpm db:migrate),
// over a real ductus_auth login (B-6, docs/BACKEND.md 4.3). Every
// identifier, token and password below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The logins exist only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const AUTH_LOGIN = "it_open_session_auth";
const APP_LOGIN = "it_open_session_app";
const password = randomBytes(24).toString("hex");

const suffix = randomBytes(4).toString("hex");
const institution = randomUUID();
const homeOrg = `it-${suffix}.ductus.test`;
const issuer = `https://issuer-${suffix}.test`;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pools: pg.Pool[] = [];

function loginPool(login: string) {
  const url = new URL(ADMIN_URL);
  url.username = login;
  url.password = password;
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  pools.push(pool);
  return pool;
}

const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest();
const input = (overrides: Partial<Parameters<ReturnType<typeof createOpenSession>>[0]> = {}) => ({
  issuer,
  subject: "sub-it-1",
  uniqueId: `ana@${homeOrg}`,
  homeOrg,
  tokenHash: tokenHash(),
  ...overrides,
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
  await admin.query("INSERT INTO identity.institution (id, slug, aai_home_org) VALUES ($1, $2, $3)", [
    institution, `it-open-${suffix}`, homeOrg,
  ]);
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await admin.query(
    "DELETE FROM identity.session WHERE user_id IN (SELECT id FROM identity.user_account WHERE institution_id = $1)",
    [institution],
  );
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institution]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  await admin.query(`DROP ROLE IF EXISTS ${AUTH_LOGIN}`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.end();
});

describe("openSession over a ductus_auth login", () => {
  it("opens a session for a known home organisation and stores only the token hash", async () => {
    const openSession = createOpenSession(loginPool(AUTH_LOGIN));
    const first = input();
    const opened = await openSession(first);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const hours = (opened.expires.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);

    const { rows } = await admin.query(
      `SELECT u.institution_id FROM identity.session s JOIN identity.user_account u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [first.tokenHash],
    );
    expect(rows).toEqual([{ institution_id: institution }]);
  });

  it("refuses an unknown or empty home organisation, never mapping it to a default", async () => {
    const openSession = createOpenSession(loginPool(AUTH_LOGIN));
    for (const other of [`nepoznata-${suffix}.test`, "", "demo..ductus test"]) {
      expect(await openSession(input({ subject: `sub-${randomUUID()}`, homeOrg: other }))).toEqual({ ok: false, reason: "refused" });
    }
  });

  it("refuses an identity that does not match the account", async () => {
    const openSession = createOpenSession(loginPool(AUTH_LOGIN));
    expect((await openSession(input({ subject: "sub-it-2", uniqueId: `ivo@${homeOrg}` }))).ok).toBe(true);
    expect(await openSession(input({ subject: "sub-it-2", uniqueId: `drugi@${homeOrg}` }))).toEqual({ ok: false, reason: "refused" });
  });

  it("reports a reused token hash as a conflict", async () => {
    const openSession = createOpenSession(loginPool(AUTH_LOGIN));
    const hash = tokenHash();
    expect((await openSession(input({ tokenHash: hash }))).ok).toBe(true);
    expect(await openSession(input({ tokenHash: hash }))).toEqual({ ok: false, reason: "conflict" });
  });

  it("does not run over a ductus_app login or the admin login", async () => {
    await expect(createOpenSession(loginPool(APP_LOGIN))(input())).rejects.toThrow();
    await expect(createOpenSession(admin)(input())).rejects.toThrow(/not a ductus_auth login/);
  });
});
