import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withActor } from "@/server/db";
import { readinessAlarms } from "@/server/alarms/readiness-store";
import { createAlarmTracker, type AlarmStore } from "@/server/alarms/readiness-alarms";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";
import { holdWorkerPresence } from "./worker-presence";

// DAN-184 (contract on #1836, c.6821517800; round 3 c.6867544247): pgTAP runs
// in one transaction and cannot race two alarms. Here real connections raise
// and resolve the same kind at once, as two replicas would, each with its own
// reporter (a random UUID, as a process makes when it starts). The race transactions call the RPCs as
// ductus_app and read the outcome as the owner before they roll back, so no
// other test's alarm write can change what they see. The alarm holds a kind
// and nothing else; there is no person or text in this test. Loopback only.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "The ops alarm race test runs only against a loopback database (DATABASE_URL).",
);
const applicationName = `it_ops_alarm_${randomBytes(5).toString("hex")}`;
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 4, application_name: applicationName });
// Only /api/ready of the database probe ever resolves this kind elsewhere; the
// local stack never raises it.
const KIND = "ready_database";
const QUEUE = "ready_queue";

type Episode = { raise_count: number; open: boolean };

async function begin(): Promise<pg.PoolClient> {
  const client = await admin.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE ductus_app");
  return client;
}
// Two replicas sharing the database.
const A = randomUUID();
const B = randomUUID();

const raise = (client: pg.ClientBase | pg.Pool, reporter: string) =>
  client.query("SELECT identity.raise_ops_alarm($1, $2)", [KIND, reporter]);
const resolve = async (client: pg.ClientBase | pg.Pool, reporter: string) =>
  (await client.query<{ closed: boolean }>("SELECT identity.resolve_ops_alarm($1, $2) AS closed", [KIND, reporter]))
    .rows[0].closed;

/** Forgets every reporter's fault of these kinds and closes their open alarms, as committed. */
async function clear(...kinds: string[]) {
  for (const kind of kinds) {
    await admin.query("DELETE FROM identity.ops_alarm_fault WHERE kind = $1", [kind]);
    await admin.query("SELECT identity.resolve_ops_alarm($1, $2)", [kind, randomUUID()]);
  }
}

/** A replica's store: the RPCs through ductus_app, with that replica's reporter. */
function store(reporter: string): AlarmStore {
  return {
    raise: (kind) => withActor(null, async (tx) => {
      await tx.query("SELECT identity.raise_ops_alarm($1, $2)", [kind, reporter]);
    }),
    resolve: (kind) => withActor(null, async (tx) =>
      (await tx.query<{ closed: boolean }>("SELECT identity.resolve_ops_alarm($1, $2) AS closed", [kind, reporter]))
        .rows[0].closed),
  };
}

/** The episodes of KIND since `since`, oldest first, as this connection sees them. */
async function episodes(client: pg.ClientBase, since: Date, kind: string = KIND): Promise<Episode[]> {
  await client.query("RESET ROLE");
  const result = await client.query<Episode>(
    `SELECT raise_count, resolved_at IS NULL AS open FROM identity.ops_alarm
      WHERE kind = $1 AND first_raised_at >= $2 ORDER BY first_raised_at, resolved_at NULLS LAST`, [kind, since]);
  return result.rows;
}
/** The same, as committed: a write of another test may have closed one meanwhile. */
async function committed(since: Date, kind: string = KIND): Promise<Episode[]> {
  const client = await admin.connect();
  try {
    return await episodes(client, since, kind);
  } finally {
    client.release();
  }
}
const now = async () => (await admin.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0].now;

/** Waits until an alarm call is in PostgreSQL and blocked by another transaction. */
async function waitForBlocked(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.application_name = $1 AND a.state = 'active' AND a.query ILIKE '%_ops_alarm(%'
            AND a.wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`, [applicationName]);
    if (result.rows[0]?.blocked) return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error("The second alarm call did not reach PostgreSQL and wait on the first.");
}

async function rollback(...clients: pg.PoolClient[]) {
  for (const client of clients) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

const started = new Date(0);
let releasePresence: (() => Promise<void>) | undefined;
// ready-queue calls the real /api/ready, whose tracker writes these kinds and
// leaves ready_queue open, held by that process's fault record. Wait until
// that file is done, as it waits for the job queue test, and start from no
// fault record and no open alarm of either kind.
beforeAll(async () => {
  releasePresence = await holdWorkerPresence(ADMIN_URL);
  await clear(KIND, QUEUE);
  started.setTime((await now()).getTime());
}, 180_000);
afterAll(async () => {
  try {
    // The closed episodes this file committed; an open one is left to resolve.
    await clear(KIND, QUEUE);
    for (const kind of [KIND, QUEUE]) {
      await admin.query("DELETE FROM identity.ops_alarm WHERE kind = $1 AND first_raised_at >= $2", [kind, started]);
    }
  } finally {
    await admin.end();
    await releasePresence?.();
  }
});

describe("ops alarm deduplication under concurrency (DAN-184)", () => {
  it("makes a second raise wait on the first and count on its alarm", async () => {
    const since = await now();
    const first = await begin();
    const second = await begin();
    try {
      await raise(first, A);
      const waiting = raise(second, B);
      await waitForBlocked();
      await first.query("COMMIT");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 2, open: true }]);
    } finally {
      await rollback(first, second);
      await clear(KIND);
    }
  });

  it("opens the alarm with the second raise when the first rolls back", async () => {
    const since = await now();
    const first = await begin();
    const second = await begin();
    try {
      await raise(first, A);
      const waiting = raise(second, B);
      await waitForBlocked();
      await first.query("ROLLBACK");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 1, open: true }]);
    } finally {
      await rollback(first, second);
    }
  });

  it("leaves one open episode, never two, when a raise meets a resolve", async () => {
    const since = await now();
    const first = await begin();
    const second = await begin();
    try {
      await raise(first, A);
      expect(await resolve(first, A)).toBe(true);
      const waiting = raise(second, B);
      await waitForBlocked();
      await first.query("COMMIT");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 1, open: false }, { raise_count: 1, open: true }]);
    } finally {
      await rollback(first, second);
    }
  });

  // c.6864883871: a replica that sees no fault must not close the alarm of a
  // replica that does. The resolve waits on the raise's lock and then sees its
  // fault record; without the record and the lock it would close the alarm.
  it("keeps the alarm open when a resolve of B waits on an uncommitted raise of A", async () => {
    const since = await now();
    const first = await begin();
    const second = await begin();
    try {
      await raise(first, A);
      const waiting = resolve(second, B);
      await waitForBlocked();
      await first.query("COMMIT");
      expect(await waiting).toBe(false);
      expect(await episodes(second, since)).toEqual([{ raise_count: 1, open: true }]);
    } finally {
      await rollback(first, second);
    }
    expect(await committed(since)).toEqual([{ raise_count: 1, open: true }]);
    expect(await resolve(admin, A)).toBe(true);
    expect(await committed(since)).toEqual([{ raise_count: 1, open: false }]);
  });

  it("opens a new episode when a raise of A waits on a resolve of B that closes", async () => {
    const since = await now();
    await raise(admin, B);
    const first = await begin();
    const second = await begin();
    try {
      expect(await resolve(first, B)).toBe(true);
      const waiting = raise(second, A);
      await waitForBlocked();
      await first.query("COMMIT");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 1, open: false }, { raise_count: 1, open: true }]);
    } finally {
      await rollback(first, second);
    }
  });

  // Two processes, each with its own tracker and reporter: the alarm stays
  // open while either still sees the fault, closes when both recover, and a
  // new fault opens a new episode.
  it("keeps the alarm open while one of two replicas still sees the fault", async () => {
    const since = await now();
    const reachable = (report: unknown) => (report as Record<string, unknown>).database === "ok";
    const replicaA = createAlarmTracker(store(randomUUID()), undefined, reachable);
    const replicaB = createAlarmTracker(store(randomUUID()), undefined, reachable);
    const down = { database: "ok", queue: "nedostupno" };
    const up = { database: "ok", queue: "ok" };

    await replicaA.observe(down);
    await replicaB.observe(up);
    await replicaB.observe(up);
    expect(await committed(since, QUEUE)).toEqual([{ raise_count: 1, open: true }]);

    await replicaA.observe(up);
    expect(await committed(since, QUEUE)).toEqual([{ raise_count: 1, open: false }]);

    await replicaA.observe(down);
    expect(await committed(since, QUEUE)).toEqual([{ raise_count: 1, open: false }, { raise_count: 1, open: true }]);
    await replicaA.observe(up);
    expect((await committed(since, QUEUE)).filter((episode) => episode.open)).toEqual([]);
  });

  // Delivery: the process's tracker reaches the table through ductus_app, and
  // a second replica raising the same fault at once adds a count, not a row.
  // The process writes only while its database probe is "ok", so the fault
  // here is the queue's. The two recover at once: whichever resolves second
  // closes the alarm.
  it("delivers a readiness fault from two replicas as one alarm, and its recovery", async () => {
    const since = await now();
    const down = { database: "ok", queue: "nedostupno" };
    const up = { database: "ok", queue: "ok" };
    const replica = createAlarmTracker(store(randomUUID()));
    await Promise.all([readinessAlarms.observe(down), replica.observe(down), readinessAlarms.observe(down)]);
    const raised = await committed(since, QUEUE);
    expect(raised.filter((episode) => episode.open).length).toBeLessThanOrEqual(1);
    expect(raised.reduce((sum, episode) => sum + episode.raise_count, 0)).toBe(2);

    await Promise.all([readinessAlarms.observe(up), replica.observe(up)]);
    const after = await committed(since, QUEUE);
    expect(after.filter((episode) => episode.open)).toEqual([]);
    expect(after.reduce((sum, episode) => sum + episode.raise_count, 0)).toBe(2);
  });

  // A fault of the database itself is owed while it lasts and delivered, as
  // one closed episode, by the first report in which the database answers.
  it("delivers a database outage once the database answers again", async () => {
    const since = await now();
    const process = createAlarmTracker(
      store(randomUUID()),
      undefined,
      (report) => (report as Record<string, unknown>).database === "ok",
    );
    await process.observe({ database: "nedostupno" });
    await process.observe({ database: "nedostupno" });
    expect(await committed(since)).toEqual([]);
    await process.observe({ database: "ok" });
    expect(await committed(since)).toEqual([{ raise_count: 1, open: false }]);
  });
});
