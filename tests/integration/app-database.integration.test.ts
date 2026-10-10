import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  APP_CONNECTION_TIMEOUT_MS,
  APP_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  APP_POOL_MAX,
  APP_STATEMENT_TIMEOUT_MS,
  appPoolConfig,
  withActor,
} from "@/server/db";
import { createWithActor } from "@/server/db/with-actor";

// The application's own way to the database, as a route will use it: withActor
// from src/server/db over APP_DATABASE_URL, the login that `pnpm db:migrate`
// provisions on the compose stack (db/local/app-login.sql). The variable comes
// from the integration project in vitest.config.ts. Every identifier and token
// below is random and synthetic.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const APP_URL = process.env.APP_DATABASE_URL ?? "";

const institution = randomUUID();
const user = randomUUID();
const token = randomBytes(32).toString("base64url");

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const single = new pg.Pool({ ...appPoolConfig(APP_URL), max: 1 });

beforeAll(async () => {
  const suffix = randomBytes(4).toString("hex");
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institution, `it-app-${suffix}`]);
  await admin.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, $3, 'sub-app', 'app@it-app.example')`,
    [user, institution, `https://issuer-${suffix}.test`],
  );
  await admin.query(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
     VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
    [token, user, institution],
  );
});

afterAll(async () => {
  await single.end();
  await admin.query("DELETE FROM identity.session WHERE user_id = $1", [user]);
  await admin.query("DELETE FROM identity.user_account WHERE id = $1", [user]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  await admin.end();
});

describe("withActor over APP_DATABASE_URL", () => {
  it("connects as the provisioned login: a member of ductus_app and of nothing else", async () => {
    const role = await withActor(null, async (tx) => {
      const { rows } = await tx.query(
        `SELECT session_user::text AS login, r.rolsuper, r.rolbypassrls,
                ARRAY(SELECT pg_get_userbyid(m.roleid)::text FROM pg_auth_members m WHERE m.member = r.oid) AS groups
           FROM pg_roles r WHERE r.rolname = session_user`,
      );
      return rows[0];
    });
    expect(role).toEqual({ login: "ductus_app_local", rolsuper: false, rolbypassrls: false, groups: ["ductus_app"] });

    await expect(
      withActor(token, (tx) => tx.query("SELECT count(*) FROM identity.session")),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("derives the actor from the session token", async () => {
    const who = (sessionToken: string | null) =>
      withActor(sessionToken, async (tx) => (await tx.query("SELECT app.current_user_id() AS user_id")).rows[0].user_id);
    expect(await who(token)).toBe(user);
    expect(await who(null)).toBeNull();
    expect(await who(randomBytes(32).toString("base64url"))).toBeNull();
  });

  it("runs with the statement and idle-in-transaction limits set on the server", async () => {
    const { rows } = await withActor(null, (tx) =>
      tx.query(
        `SELECT name, setting::int AS value, unit FROM pg_settings
          WHERE name IN ('statement_timeout', 'idle_in_transaction_session_timeout') ORDER BY name`,
      ),
    );
    expect(rows).toEqual([
      { name: "idle_in_transaction_session_timeout", value: APP_IDLE_IN_TRANSACTION_TIMEOUT_MS, unit: "ms" },
      { name: "statement_timeout", value: APP_STATEMENT_TIMEOUT_MS, unit: "ms" },
    ]);
  });

  it("fails a nested call on a pool of one instead of hanging", async () => {
    const nested = createWithActor(single);
    const inner = vi.fn(async () => "inner");
    const started = Date.now();

    await expect(nested(null, () => nested(null, inner))).rejects.toThrow(/timeout/i);

    const waited = Date.now() - started;
    expect(inner).not.toHaveBeenCalled();
    expect(waited).toBeGreaterThanOrEqual(APP_CONNECTION_TIMEOUT_MS - 250);
    expect(waited).toBeLessThan(APP_IDLE_IN_TRANSACTION_TIMEOUT_MS);
    // The outer transaction was rolled back and its connection is usable again.
    expect(await nested(null, async (tx) => (await tx.query("SELECT 1 AS one")).rows[0].one)).toBe(1);
  });

  it("fails a call on the exhausted application pool instead of queueing it for good", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding = 0;
    let allHolding = () => {};
    const full = new Promise<void>((resolve) => (allHolding = resolve));
    const holders = Array.from({ length: APP_POOL_MAX }, () =>
      withActor(null, async () => {
        if (++holding === APP_POOL_MAX) allHolding();
        await gate;
      }),
    );
    const extra = vi.fn(async () => "ran");
    try {
      // A holder that fails before all are in must fail the test, not stall it.
      await Promise.race([full, Promise.all(holders)]);
      await expect(withActor(null, extra)).rejects.toThrow(/timeout/i);
      expect(extra).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all(holders);
    }
    expect(await withActor(token, async (tx) => (await tx.query("SELECT app.current_user_id() AS id")).rows[0].id)).toBe(user);
  });
});
