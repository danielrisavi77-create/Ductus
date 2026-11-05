import { EventEmitter } from "node:events";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { LOCK_KEY, runLocked, type LockedChild } from "../../scripts/db/migrate-locked.mjs";
import { connectLockClient } from "../../src/server/db/migration-lock";

// D-91 (3), DAN-71: the migration runner's advisory lock against the compose
// PostgreSQL (pnpm stack:up, pnpm db:migrate). A fake child stands in for
// dbmate, so nothing is migrated here; only the lock and its loss are real.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
afterAll(() => admin.end());

class FakeDbmate extends EventEmitter implements LockedChild {
  exitCode: number | null = null;
  signals: string[] = [];
  kill(signal?: NodeJS.Signals) {
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }
  exit(code: number) {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

async function lockClient() {
  const client = new pg.Client({ connectionString: ADMIN_URL, application_name: "it-migrate-lock" });
  await client.connect();
  return client;
}

const holders = () =>
  admin
    .query<{ pid: number }>(
      `SELECT pid FROM pg_catalog.pg_locks
        WHERE locktype = 'advisory' AND granted
          AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
      [LOCK_KEY],
    )
    .then((r) => r.rows.map((row) => row.pid));

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe("migration lock (D-91 (3))", () => {
  it("holds the advisory lock for the whole run and releases it afterwards", async () => {
    const child = new FakeDbmate();
    let started = false;
    // The runner's own connection, with dbmate's role parameter on the URL.
    const url = new URL(ADMIN_URL);
    url.searchParams.set("role", "ductus_migrator");
    const connect = () => connectLockClient(url.href, { attempts: 1 });
    const done = runLocked({ connect, start: () => ((started = true), child), log: () => {} });
    await until(() => started);
    expect(await holders()).toHaveLength(1);
    child.exit(0);
    expect(await done).toBe(0);
    expect(await holders()).toEqual([]);
  });

  it("does not start dbmate while another run holds the lock", async () => {
    const other = await lockClient();
    try {
      await other.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [LOCK_KEY]);
      let started = false;
      const code = await runLocked({
        connect: lockClient,
        start: () => ((started = true), new FakeDbmate()),
        lockTimeoutMs: 300,
        log: () => {},
      });
      expect(code).toBe(1);
      expect(started).toBe(false);
    } finally {
      await other.end();
    }
  });

  it("a run cancelled while it waits for the lock never starts dbmate", async () => {
    // #1051 Codex P2: SIGINT/SIGTERM in that window must not let the run
    // start migrations once the other run releases the lock.
    const other = await lockClient();
    try {
      await other.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [LOCK_KEY]);
      const controller = new AbortController();
      let started = false;
      let waiter: pg.Client | null = null;
      const done = runLocked({
        connect: async () => (waiter = await lockClient()),
        start: () => ((started = true), new FakeDbmate()),
        signal: controller.signal,
        log: () => {},
      });
      await until(() => waiter !== null);
      await new Promise((resolve) => setTimeout(resolve, 200));
      controller.abort();
      expect(await done).toBe(1);
      await other.query("SELECT pg_catalog.pg_advisory_unlock($1::bigint)", [LOCK_KEY]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(started).toBe(false);
    } finally {
      await other.end();
    }
    expect(await holders()).toEqual([]);
  });

  it("two runs started together never run dbmate at the same time", async () => {
    // Istodobnost: the second run waits on pg_advisory_lock; its dbmate may
    // start only after the first dbmate has exited and the lock was released.
    const events: string[] = [];
    let running = 0;
    let overlapped = false;
    const children: FakeDbmate[] = [];
    const start = (name: string) => () => {
      running += 1;
      if (running > 1) overlapped = true;
      events.push(`start ${name}`);
      const child = new FakeDbmate();
      child.once("exit", () => {
        running -= 1;
        events.push(`exit ${name}`);
      });
      children.push(child);
      return child;
    };
    const a = runLocked({ connect: lockClient, start: start("a"), log: () => {} });
    const b = runLocked({ connect: lockClient, start: start("b"), log: () => {} });
    await until(() => children.length === 1);
    // The other run must still be waiting on the lock, not running dbmate.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(children).toHaveLength(1);
    expect(await holders()).toHaveLength(1);
    children[0]!.exit(0);
    await until(() => children.length === 2);
    expect(await holders()).toHaveLength(1);
    children[1]!.exit(0);
    expect(await Promise.all([a, b])).toEqual([0, 0]);
    expect(overlapped).toBe(false);
    const first = events[0]!.slice("start ".length);
    const second = first === "a" ? "b" : "a";
    expect(events).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`, `exit ${second}`]);
    expect(await holders()).toEqual([]);
  });

  it("stops dbmate and fails when the lock session is terminated", async () => {
    const child = new FakeDbmate();
    let started = false;
    const done = runLocked({ connect: lockClient, start: () => ((started = true), child), heartbeatMs: 50, log: () => {} });
    await until(() => started);
    const [pid] = await holders();
    await admin.query("SELECT pg_catalog.pg_terminate_backend($1)", [pid]);
    await until(() => child.signals.length > 0);
    expect(child.signals[0]).toBe("SIGTERM");
    child.exit(0);
    expect(await done).toBe(1);
    expect(await holders()).toEqual([]);
  });
});
