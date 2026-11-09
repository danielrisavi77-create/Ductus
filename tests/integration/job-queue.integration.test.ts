import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { JobBody, JobDefinition } from "@/application/jobs/job-body";
import { openJobQueue, type JobHandler, type JobQueue, type JobQueueSettings } from "@/server/db/job-queue";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";
import { holdWorkerPresence } from "./worker-presence";

// DAN-517, attack plan #1826: the worker's side of the queue against the real
// schema the migrations install, under logins made and dropped here. Every
// identifier is invented; a job body carries identifiers only.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "DATABASE_URL must point at this machine",
);
const RUN = randomBytes(3).toString("hex");
const LOGINS = {
  workerA: ["ductus_worker"],
  workerB: ["ductus_worker"],
  workerGone: ["ductus_worker"],
  web: ["ductus_app"],
  workerAndWeb: ["ductus_worker", "ductus_app"],
  workerAndOwner: ["ductus_worker", "ductus_queue"],
} as const;
type Login = keyof typeof LOGINS;
const RELATIONS_SQL =
  "SELECT c.relname::text AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pgboss' ORDER BY 1";

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const password = randomBytes(24).toString("hex");
const errors: string[] = [];
const opened: JobQueue[] = [];
let relations: string[] = [];
let releasePresence: (() => Promise<void>) | undefined;
let queues = 0;

const role = (login: Login): string => `it_jobq_${RUN}_${login.toLowerCase()}`;

function url(user: string, secret = password): string {
  const target = new URL(ADMIN_URL);
  target.username = user;
  target.password = secret;
  return target.toString();
}

function definition(): JobDefinition {
  queues += 1;
  return { name: `it_jobq_${RUN}_${queues}`, fields: ["domainId", "packageId"], subject: "packageId" };
}

const id = (k: number): string => `00000000-0000-4000-8000-${k.toString(16).padStart(12, "0")}`;
const body = (k: number): JobBody => ({ domainId: id(1), packageId: id(k) });

function settings(def: JobDefinition, connectionString: string, overrides: Partial<JobQueueSettings>): JobQueueSettings {
  return {
    connectionString, definitions: [def], retryLimit: 2, retryDelaySeconds: 0, deadlineMs: 30_000,
    expireSeconds: 60, deleteAfterSeconds: 3600, sweepSeconds: 1, onError: (code) => errors.push(code), ...overrides,
  };
}

async function open(def: JobDefinition, login: Login = "workerA", overrides: Partial<JobQueueSettings> = {}): Promise<JobQueue> {
  const queue = await openJobQueue(settings(def, url(role(login)), overrides));
  opened.push(queue);
  return queue;
}

type Row = { state: string; retry_count: number; output: unknown; data: unknown };
async function jobs(name: string): Promise<Row[]> {
  return (await admin.query<Row>("SELECT state::text, retry_count, output, data FROM pgboss.job WHERE name = $1 ORDER BY created_on", [name])).rows;
}

function gate(): { readonly wait: Promise<void>; open(): void } {
  let open = (): void => {};
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

const ok: JobHandler = async () => ({ ok: true });

async function drain(queue: JobQueue, name: string, handler: JobHandler): Promise<void> {
  while ((await queue.runOnce(name, handler)).status !== "idle") { /* next job */ }
}

async function refusal(run: Promise<unknown>): Promise<unknown> {
  return run.then(() => "opened", (error: unknown) => (error instanceof Error ? { name: error.name, message: error.message } : error));
}
const refused = (code: string): object => ({ name: "JobQueueError", message: code });

beforeAll(async () => {
  // /api/ready counts any connected worker login: its test and this file take turns.
  releasePresence = await holdWorkerPresence(ADMIN_URL);
  for (const login of Object.keys(LOGINS) as Login[]) {
    const ddl = await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ' || $3::text, $1::text, $2::text) AS ddl",
      [role(login), password, LOGINS[login].join(", ")],
    );
    await admin.query(ddl.rows[0].ddl);
  }
  relations = (await admin.query<{ name: string }>(RELATIONS_SQL)).rows.map((row) => row.name);
}, 180_000);

afterEach(async () => {
  await Promise.all(opened.splice(0).map((queue) => queue.stop().catch(() => {})));
});

afterAll(async () => {
  await admin.query("DELETE FROM pgboss.job WHERE name LIKE $1", [`it_jobq_${RUN}_%`]);
  await admin.query("DELETE FROM pgboss.queue WHERE name LIKE $1", [`it_jobq_${RUN}_%`]);
  for (const login of Object.keys(LOGINS) as Login[]) await admin.query(`DROP ROLE IF EXISTS ${role(login)}`);
  await admin.end();
  await releasePresence?.();
});

describe("job queue: one job, one attempt at a time", () => {
  it("W-6: hands a queued job to the handler once, as a frozen record of its fields, and records completion", async () => {
    const def = definition();
    const queue = await open(def);
    const seen: JobBody[] = [];
    expect(await queue.enqueue(def.name, body(10))).toBe("queued");
    expect(await queue.runOnce(def.name, async (job) => { seen.push(job); return { ok: true }; })).toEqual({ status: "completed" });
    expect(await queue.runOnce(def.name, ok)).toEqual({ status: "idle" });
    expect(seen).toEqual([body(10)]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(await jobs(def.name)).toEqual([{ state: "completed", retry_count: 0, output: null, data: body(10) }]);
  });

  it("W-7: a refused job is retried retryLimit times and then stays failed, with the code as its only output", async () => {
    const def = definition();
    const queue = await open(def);
    await queue.enqueue(def.name, body(20));
    const refuse: JobHandler = async () => ({ ok: false, code: "synthetic_refusal" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await queue.runOnce(def.name, refuse)).toEqual({ status: "failed", code: "synthetic_refusal" });
    }
    expect(await queue.runOnce(def.name, refuse)).toEqual({ status: "idle" });
    expect(await jobs(def.name)).toEqual([{ state: "failed", retry_count: 2, output: { code: "synthetic_refusal" }, data: body(20) }]);
    expect(await queue.depth(def.name)).toBe(0);
  });

  it("W-7: a job that fails twice and then succeeds ran three times and is completed", async () => {
    const def = definition();
    const queue = await open(def);
    await queue.enqueue(def.name, body(25));
    let runs = 0;
    const flaky: JobHandler = async () => {
      runs += 1;
      if (runs === 1) throw new Error("synthetic failure");
      return runs === 2 ? { ok: false, code: "synthetic_refusal" } : { ok: true };
    };
    await drain(queue, def.name, flaky);
    expect(runs).toBe(3);
    expect(await jobs(def.name)).toMatchObject([{ state: "completed", retry_count: 2 }]);
  });

  it("W-12: what a handler throws or returns as a code never reaches the table as text", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0 });
    const marker = "synthetic marker 7f3a: not an identifier";
    await queue.enqueue(def.name, body(30));
    expect(await queue.runOnce(def.name, async () => { throw new Error(marker); })).toEqual({ status: "failed", code: "handler_threw" });
    await queue.enqueue(def.name, body(31));
    expect(await queue.runOnce(def.name, async () => ({ ok: false, code: marker }))).toEqual({ status: "failed", code: "handler_failed" });
    const rows = await jobs(def.name);
    expect(rows.map((row) => row.output)).toEqual([{ code: "handler_threw" }, { code: "handler_failed" }]);
    expect(JSON.stringify(rows)).not.toContain("7f3a");
  });

  it("W-4: a handler past its deadline is told to stop and the attempt is stored as timeout", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0, deadlineMs: 100 });
    await queue.enqueue(def.name, body(40));
    const stopped: JobHandler = (_job, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await queue.runOnce(def.name, stopped)).toEqual({ status: "failed", code: "timeout" });
    expect((await jobs(def.name))[0].output).toEqual({ code: "timeout" });
  });

  it("W-5: twenty enqueues of one subject from two workers leave one job", async () => {
    const def = definition();
    const [a, b] = await Promise.all([open(def, "workerA"), open(def, "workerB")]);
    const results = await Promise.all(Array.from({ length: 20 }, (_unused, n) => (n % 2 === 0 ? a : b).enqueue(def.name, body(50))));
    expect(results.filter((result) => result === "queued")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(19);
    expect(await jobs(def.name)).toHaveLength(1);
    expect(await a.depth(def.name)).toBe(1);
  });

  it("W-1 (Istodobnost): four loops on two logins run every subject exactly once", async () => {
    const def = definition();
    const [a, b] = await Promise.all([open(def, "workerA"), open(def, "workerB")]);
    const subjects = Array.from({ length: 24 }, (_unused, n) => 100 + n);
    for (const k of subjects) expect(await a.enqueue(def.name, body(k))).toBe("queued");
    const runs = new Map<string, number>();
    const handler: JobHandler = async (job) => {
      runs.set(job.packageId, (runs.get(job.packageId) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true };
    };
    await Promise.all([a, a, b, b].map((queue) => drain(queue, def.name, handler)));
    expect([...runs.entries()].sort()).toEqual(subjects.map((k) => [id(k), 1]));
    const rows = await jobs(def.name);
    expect(rows).toHaveLength(subjects.length);
    expect(rows.every((row) => row.state === "completed" && row.retry_count === 0)).toBe(true);
  });

  it("W-1, W-2 (negative): while one worker holds a job, the other cannot take it or queue its subject again", async () => {
    const def = definition();
    const [a, b] = await Promise.all([open(def, "workerA"), open(def, "workerB")]);
    await a.enqueue(def.name, body(60));
    const started = gate();
    const release = gate();
    const held = a.runOnce(def.name, async () => { started.open(); await release.wait; return { ok: true }; });
    await started.wait;
    let second = 0;
    expect(await b.runOnce(def.name, async () => { second += 1; return { ok: true }; })).toEqual({ status: "idle" });
    expect(second).toBe(0);
    expect(await b.enqueue(def.name, body(60))).toBe("duplicate");
    // Control: another subject is not held back by this one.
    expect(await b.enqueue(def.name, body(61))).toBe("queued");
    expect(await b.runOnce(def.name, ok)).toEqual({ status: "completed" });
    release.open();
    expect(await held).toEqual({ status: "completed" });
    expect(await b.enqueue(def.name, body(60))).toBe("queued");
  });

  it("W-3: a job whose worker went silent is handed out again, and the first attempt's late result changes nothing", async () => {
    const def = definition();
    const timing = { expireSeconds: 1, deadlineMs: 300 };
    const [a, b] = await Promise.all([open(def, "workerA", timing), open(def, "workerB", timing)]);
    await a.enqueue(def.name, body(70));
    const startedA = gate();
    const releaseA = gate();
    // This handler ignores the stop signal: the worst case for the first attempt.
    const first = a.runOnce(def.name, async () => { startedA.open(); await releaseA.wait; return { ok: true }; });
    await startedA.wait;
    await expect.poll(async () => { await b.sweep(def.name); return (await jobs(def.name))[0].state; }, { timeout: 20_000, interval: 250 }).toBe("retry");
    expect(await b.enqueue(def.name, body(70))).toBe("duplicate");
    const startedB = gate();
    const releaseB = gate();
    const second = b.runOnce(def.name, async () => { startedB.open(); await releaseB.wait; return { ok: true }; });
    await startedB.wait;
    releaseA.open();
    expect(await first).toEqual({ status: "lost" });
    expect(await jobs(def.name)).toMatchObject([{ state: "active", retry_count: 1 }]);
    releaseB.open();
    expect(await second).toEqual({ status: "completed" });
    expect(await jobs(def.name)).toMatchObject([{ state: "completed", retry_count: 1 }]);
  });
});

describe("job queue: what it refuses", () => {
  it.each<[string, () => string]>([
    ["the web role", () => url(role("web"))],
    ["a superuser", () => ADMIN_URL],
    ["a login that is both the worker and the web role", () => url(role("workerAndWeb"))],
    ["a login that is both the worker and the queue owner", () => url(role("workerAndOwner"))],
  ])("W-10: does not open for %s", async (_label, connectionString) => {
    expect(await refusal(openJobQueue(settings(definition(), connectionString(), {})))).toEqual(refused("role_not_worker"));
  });

  it("W-10: reports an unreachable database by code, without the connection string", async () => {
    const secret = `synthetic-${randomBytes(6).toString("hex")}`;
    const outcome = await refusal(openJobQueue(settings(definition(), url(`it_jobq_${RUN}_nobody`, secret), {})));
    expect(outcome).toEqual(refused("queue_unreachable"));
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it.each<[string, (def: JobDefinition) => Partial<JobQueueSettings>, string]>([
    ["a queue name outside the pattern", (def) => ({ definitions: [{ ...def, name: "It.Jobq" }] }), "definition_invalid"],
    ["two definitions of one queue", (def) => ({ definitions: [def, def] }), "definition_invalid"],
    ["no definitions", () => ({ definitions: [] }), "definition_invalid"],
    ["a deadline that is not before expiry", () => ({ expireSeconds: 5, deadlineMs: 5000 }), "settings_invalid"],
    ["a negative retry limit", () => ({ retryLimit: -1 }), "settings_invalid"],
    ["a fractional retry delay", () => ({ retryDelaySeconds: 0.5 }), "settings_invalid"],
    ["a sweep interval of zero", () => ({ sweepSeconds: 0 }), "settings_invalid"],
    ["an empty connection string", () => ({ connectionString: "" }), "settings_invalid"],
  ])("W-14: refuses %s before it connects", async (_label, overrides, code) => {
    const def = definition();
    // The login does not exist: a refusal by code proves nothing was sent to the database.
    expect(await refusal(openJobQueue(settings(def, url(`it_jobq_${RUN}_nobody`), overrides(def))))).toEqual(refused(code));
  });

  it("W-9: refuses a queue that exists with other settings, and a queue name it was not opened for", async () => {
    const def = definition();
    const queue = await open(def);
    expect(await refusal(open(def, "workerB", { retryLimit: 3 }))).toEqual(refused("queue_mismatch"));
    expect(await refusal(open(def, "workerB", { expireSeconds: 61 }))).toEqual(refused("queue_mismatch"));
    const other = definition().name;
    expect(await queue.enqueue(other, body(80))).toBe("rejected");
    const runs = [queue.runOnce(other, ok), queue.sweep(other), queue.depth(other)];
    expect(await Promise.all(runs.map(refusal))).toEqual(runs.map(() => refused("definition_unknown")));
    expect(await jobs(other)).toEqual([]);
  });

  it("W-12: a failure of the database after opening leaves as a code, without the driver's text", async () => {
    const def = definition();
    const queue = await open(def, "workerGone");
    expect(await queue.enqueue(def.name, body(95))).toBe("queued");
    // The login loses its rights mid-flight: every statement of the queue now fails in the driver.
    await admin.query(`REVOKE ductus_worker FROM ${role("workerGone")}`);
    let ran = 0;
    const handler: JobHandler = async () => { ran += 1; return { ok: true }; };
    const runs = [queue.enqueue(def.name, body(96)), queue.runOnce(def.name, handler), queue.depth(def.name), queue.sweep(def.name)];
    expect(await Promise.all(runs.map(refusal))).toEqual(runs.map(() => refused("queue_failed")));
    expect(ran).toBe(0);
    expect(await jobs(def.name)).toMatchObject([{ state: "created", retry_count: 0 }]);
  });

  it("W-11: a body that is not identifiers only is not queued, and one put there by another writer is not run", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0 });
    const text = "synthetic note, not an identifier";
    for (const input of [{ ...body(90), packageId: text }, { ...body(90), note: id(2) }, { packageId: id(90) }, null, text]) {
      expect(await queue.enqueue(def.name, input)).toBe("rejected");
    }
    expect(await jobs(def.name)).toEqual([]);
    await admin.query("INSERT INTO pgboss.job (name, data, retry_limit) VALUES ($1, $2::jsonb, 0)", [def.name, JSON.stringify({ ...body(91), note: text })]);
    let ran = 0;
    expect(await queue.runOnce(def.name, async () => { ran += 1; return { ok: true }; })).toEqual({ status: "failed", code: "invalid_body" });
    expect(ran).toBe(0);
    expect(await jobs(def.name)).toMatchObject([{ state: "failed", output: { code: "invalid_body" } }]);
  });
});

describe("job queue: a queue that grows", () => {
  it("W-8: depth counts what waits or runs, and the sweep removes finished jobs after their keep time", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { deleteAfterSeconds: 1 });
    for (const k of [200, 201, 202]) await queue.enqueue(def.name, body(k));
    expect(await queue.depth(def.name)).toBe(3);
    expect(await queue.runOnce(def.name, ok)).toEqual({ status: "completed" });
    expect(await queue.depth(def.name)).toBe(2);
    await expect.poll(async () => { await queue.sweep(def.name); return (await jobs(def.name)).map((row) => row.state); }, { timeout: 20_000, interval: 250 })
      .toEqual(["created", "created"]);
    expect(await queue.depth(def.name)).toBe(2);
  });

  it("W-9: opening and running built nothing in the queue schema, and the queue's own background work reported no failure", async () => {
    const def = definition();
    await open(def);
    expect((await admin.query<{ name: string }>(RELATIONS_SQL)).rows.map((row) => row.name)).toEqual(relations);
    const made = await admin.query<{ partition: boolean }>("SELECT partition FROM pgboss.queue WHERE name LIKE $1", [`it_jobq_${RUN}_%`]);
    expect(made.rows.length).toBeGreaterThan(0);
    expect(made.rows.every((row) => row.partition === false)).toBe(true);
    expect(errors).toEqual([]);
  });
});
