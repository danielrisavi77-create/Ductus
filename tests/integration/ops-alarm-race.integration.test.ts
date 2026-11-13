import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withActor } from "@/server/db";
import { readinessAlarms } from "@/server/alarms/readiness-store";
import { createAlarmTracker } from "@/server/alarms/readiness-alarms";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";
import { holdWorkerPresence } from "./worker-presence";

// DAN-184 (contract on #1836, c.6821517800): pgTAP runs in one transaction and
// cannot race two alarms. Here real connections raise and resolve the same
// kind at once, as two replicas would. The race transactions call the RPCs as
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
const raise = (client: pg.ClientBase) => client.query("SELECT identity.raise_ops_alarm($1)", [KIND]);
const resolve = (client: pg.ClientBase) => client.query("SELECT identity.resolve_ops_alarm($1)", [KIND]);

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
// leaves ready_queue open. Wait until that file is done, as it waits for the
// job queue test, and start from no open alarm of either kind.
beforeAll(async () => {
  releasePresence = await holdWorkerPresence(ADMIN_URL);
  for (const kind of [KIND, QUEUE]) await admin.query("SELECT identity.resolve_ops_alarm($1)", [kind]);
  started.setTime((await now()).getTime());
}, 180_000);
afterAll(async () => {
  try {
    // The closed episodes this file committed; an open one is left to resolve.
    for (const kind of [KIND, QUEUE]) {
      await admin.query("SELECT identity.resolve_ops_alarm($1)", [kind]);
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
      await raise(first);
      const waiting = raise(second);
      await waitForBlocked();
      await first.query("COMMIT");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 2, open: true }]);
    } finally {
      await rollback(first, second);
      await admin.query("SELECT identity.resolve_ops_alarm($1)", [KIND]);
    }
  });

  it("opens the alarm with the second raise when the first rolls back", async () => {
    const since = await now();
    const first = await begin();
    const second = await begin();
    try {
      await raise(first);
      const waiting = raise(second);
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
      await raise(first);
      await resolve(first);
      const waiting = raise(second);
      await waitForBlocked();
      await first.query("COMMIT");
      await waiting;
      expect(await episodes(second, since)).toEqual([{ raise_count: 1, open: false }, { raise_count: 1, open: true }]);
    } finally {
      await rollback(first, second);
    }
  });

  // Delivery: the process's tracker reaches the table through ductus_app, and
  // a second replica raising the same fault at once adds a count, not a row.
  // The process writes only while its database probe is "ok", so the fault
  // here is the queue's.
  it("delivers a readiness fault from two replicas as one alarm, and its recovery", async () => {
    const since = await now();
    const down = { database: "ok", queue: "nedostupno" };
    const up = { database: "ok", queue: "ok" };
    const replica = createAlarmTracker({
      raise: (kind) => withActor(null, async (tx) => { await tx.query("SELECT identity.raise_ops_alarm($1)", [kind]); }),
      resolve: (kind) => withActor(null, async (tx) => { await tx.query("SELECT identity.resolve_ops_alarm($1)", [kind]); }),
    });
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
      {
        raise: (kind) => withActor(null, async (tx) => { await tx.query("SELECT identity.raise_ops_alarm($1)", [kind]); }),
        resolve: (kind) => withActor(null, async (tx) => { await tx.query("SELECT identity.resolve_ops_alarm($1)", [kind]); }),
      },
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
