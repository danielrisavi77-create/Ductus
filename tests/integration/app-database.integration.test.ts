import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";

import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_CONNECTION_TIMEOUT_MS,
  APP_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  APP_POOL_MAX,
  APP_STATEMENT_TIMEOUT_MS,
  appPoolConfig,
  handleConnectionErrors,
  withActor,
} from "@/server/db";
import { type ActorTransaction, createWithActor, type WithActor } from "@/server/db/with-actor";

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
const pools: pg.Pool[] = [];

/** A pool with the application's settings and error handling; `limits` shortens a wait. */
function appPool(limits: pg.PoolConfig = {}) {
  const pool = handleConnectionErrors(new pg.Pool({ ...appPoolConfig(APP_URL), max: 1, ...limits }));
  pools.push(pool);
  return pool;
}
const single = appPool();

// A connection that dies must never surface as an error nobody handles.
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => void unhandled.push(error);

const WHO = "SELECT app.current_user_id() AS user_id, pg_catalog.pg_backend_pid() AS pid";
type Who = { user_id: string | null; pid: number };
const who = (actor: WithActor, sessionToken: string | null) =>
  actor(sessionToken, async (tx) => (await tx.query<Who>(WHO)).rows[0]);
const terminate = (...pids: number[]) =>
  admin.query("SELECT pg_catalog.pg_terminate_backend(pid) FROM unnest($1::int[]) AS pid", [pids]);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough for the driver to see what the server did to a connection. */
const SETTLE_MS = 500;

beforeAll(async () => {
  process.on("uncaughtException", onUnhandled);
  process.on("unhandledRejection", onUnhandled);
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
  process.off("uncaughtException", onUnhandled);
  process.off("unhandledRejection", onUnhandled);
  // Rows first: closing a pool waits for every borrowed client, so a test that
  // failed with one still out must not keep the rows in the database.
  try {
    await admin.query("DELETE FROM identity.session WHERE user_id = $1", [user]);
    await admin.query("DELETE FROM identity.user_account WHERE id = $1", [user]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institution]);
  } finally {
    await admin.end();
    await Promise.all(pools.map((pool) => pool.end()));
  }
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

// What the server can do to a connection while a request holds it or while it
// waits in the pool. Each case must leave the process standing, the broken
// connection out of the pool and the next caller with its own identity.
describe("a connection that the server ends or cuts short", () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    unhandled.length = 0;
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logged.mockRestore();
  });

  /** Nothing unhandled, and the log holds the error code and nothing else. */
  function expectQuietFailure(code: string) {
    expect(unhandled).toEqual([]);
    expect(logged.mock.calls).toContainEqual(["database connection failed", code]);
    for (const call of logged.mock.calls) {
      expect(call).toHaveLength(2);
      expect(call[0]).toBe("database connection failed");
      expect(call[1]).toMatch(/^([0-9A-Z]{5}|Error)$/);
    }
  }

  /** The pool gives a fresh connection, and it answers for the token it is given. */
  async function expectHealthy(actor: WithActor, deadPids: number[]) {
    const known = await who(actor, token);
    expect(known.user_id).toBe(user);
    expect(deadPids).not.toContain(known.pid);
    expect((await who(actor, null)).user_id).toBeNull();
  }

  const NOT_QUERYABLE = /not queryable/;
  const AFTER_THE_SERVER_CLOSED: [string, (tx: ActorTransaction) => Promise<unknown>, RegExp][] = [
    ["returns, so COMMIT fails", async () => "done", NOT_QUERYABLE],
    ["runs another statement", (tx) => tx.query("SELECT 1"), NOT_QUERYABLE],
    ["throws its own error, so ROLLBACK fails", () => Promise.reject(new Error("fn failed")), /fn failed/],
  ];

  it.each(AFTER_THE_SERVER_CLOSED)(
    "survives the idle-in-transaction limit when fn then %s",
    async (_name, afterwards, failure) => {
      const pool = appPool({ idle_in_transaction_session_timeout: 200 });
      const actor = createWithActor(pool);
      let pid = 0;
      await expect(
        actor(token, async (tx) => {
          pid = (await tx.query<Who>(WHO)).rows[0].pid;
          await pause(200 + SETTLE_MS);
          return afterwards(tx);
        }),
      ).rejects.toThrow(failure);

      expect(pool.totalCount).toBe(0);
      expectQuietFailure("25P03");
      await expectHealthy(actor, [pid]);
    },
  );

  it("keeps the connection after a statement over the statement limit, without the token", async () => {
    const actor = createWithActor(appPool({ statement_timeout: 200 }));
    const before = await who(actor, null);

    await expect(actor(token, (tx) => tx.query("SELECT pg_catalog.pg_sleep(5)"))).rejects.toMatchObject({ code: "57014" });
    // A caller that swallows the cancellation still gets no commit.
    await expect(
      actor(token, async (tx) => {
        await tx.query("SELECT pg_catalog.pg_sleep(5)").catch(() => {});
        return "swallowed";
      }),
    ).rejects.toThrow("rolled back");

    expect(unhandled).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
    // The connection lived: same backend, and nothing of the token stayed on it.
    expect(await who(actor, null)).toEqual({ user_id: null, pid: before.pid });
    expect(await who(actor, token)).toEqual({ user_id: user, pid: before.pid });
  });

  it("survives the server ending a borrowed connection of the application pool", async () => {
    let idlePid = 0;
    await expect(
      withActor(token, async (tx) => {
        idlePid = (await tx.query<Who>(WHO)).rows[0].pid;
        await terminate(idlePid);
        await pause(SETTLE_MS);
        return "done";
      }),
    ).rejects.toThrow(NOT_QUERYABLE);
    expectQuietFailure("57P01");
    await expectHealthy(withActor, [idlePid]);

    // The same while a statement runs: the statement carries the error.
    let busyPid = 0;
    await expect(
      withActor(token, async (tx) => {
        busyPid = (await tx.query<Who>(WHO)).rows[0].pid;
        return Promise.all([tx.query("SELECT pg_catalog.pg_sleep(5)"), pause(100).then(() => terminate(busyPid))]);
      }),
    ).rejects.toMatchObject({ code: "57P01" });
    await pause(SETTLE_MS);
    expect(unhandled).toEqual([]);
    await expectHealthy(withActor, [idlePid, busyPid]);
  });

  it("survives the server ending a connection that waits in the pool", async () => {
    const pool = appPool();
    const actor = createWithActor(pool);
    const { pid } = await who(actor, token);
    expect(pool.idleCount).toBe(1);

    await terminate(pid);
    await pause(SETTLE_MS);

    expect(pool.totalCount).toBe(0);
    expectQuietFailure("57P01");
    await expectHealthy(actor, [pid]);
  });

  it("survives every connection ending at once, as on a restart", async () => {
    const pool = appPool({ max: 3 });
    const actor = createWithActor(pool);
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pids: number[] = [];
    // Two connections stay borrowed, the third goes back to the pool.
    const borrowed = Promise.allSettled(
      [token, null].map((sessionToken) =>
        actor(sessionToken, async (tx) => {
          pids.push((await tx.query<Who>(WHO)).rows[0].pid);
          await gate;
          return tx.query(WHO);
        }),
      ),
    );
    pids.push((await who(actor, token)).pid);
    await vi.waitFor(() => expect(new Set(pids).size).toBe(3));

    await terminate(...pids);
    await pause(SETTLE_MS);
    release();

    expect((await borrowed).map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    expect(pool.totalCount).toBe(0);
    expectQuietFailure("57P01");
    await expectHealthy(actor, pids);
  });

  it("stops waiting for a server that no longer answers and drops the connection", async () => {
    // A relay in front of the database that can swallow every byte, as a
    // frozen server or a dead network does: nothing answers, nothing closes.
    const database = new URL(APP_URL);
    const sockets: net.Socket[] = [];
    let silent = false;
    const relay = net.createServer((near) => {
      const far = net.connect(Number(database.port), database.hostname);
      sockets.push(near, far);
      near.on("data", (bytes) => silent || far.write(bytes));
      far.on("data", (bytes) => silent || near.write(bytes));
      near.on("error", () => {}).on("close", () => far.destroy());
      far.on("error", () => {}).on("close", () => near.destroy());
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const through = new URL(APP_URL);
    through.hostname = "127.0.0.1";
    through.port = String((relay.address() as net.AddressInfo).port);

    const pool = appPool({ connectionString: through.href, query_timeout: 300 });
    const actor = createWithActor(pool);
    const before = await who(actor, token);
    expect(before.user_id).toBe(user);
    try {
      const started = Date.now();
      await expect(
        actor(token, async (tx) => {
          await tx.query(WHO);
          silent = true;
          return tx.query(WHO);
        }),
      ).rejects.toThrow("Query read timeout");
      // The statement, then the ROLLBACK: each waited once, neither for good.
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(pool.totalCount).toBe(0);
      expect(unhandled).toEqual([]);

      // The network is back; what was open across the outage is gone.
      for (const socket of sockets) socket.destroy();
      silent = false;
      await expectHealthy(actor, [before.pid]);
      expect(unhandled).toEqual([]);
    } finally {
      for (const socket of sockets) socket.destroy();
      relay.close();
    }
  });
});
