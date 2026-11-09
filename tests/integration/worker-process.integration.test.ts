import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { JobDefinition } from "@/application/jobs/job-body";
import { parseWorkerEnvironment, type WorkerSettings } from "@/runtime/worker/environment";
import { SELF_CHECK } from "@/runtime/worker/jobs";
import { openJobQueue, type JobQueue } from "@/server/db/job-queue";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";
import { holdWorkerPresence } from "./worker-presence";

// DAN-517, attack plan #1826 (W-1, W-3, W-12, W-13): the worker as real node
// processes against the real queue schema, under a login made and dropped
// here. Every identifier is invented; a job body carries identifiers only.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "DATABASE_URL must point at this machine",
);
const RUN = randomBytes(3).toString("hex");
const ROLE = `it_wproc_${RUN}`;
const MARKER = "synthetic essay sentence that must stay out of the log";
const ENTRY = path.resolve(__dirname, "../../scripts/worker/start.mjs");

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const password = randomBytes(24).toString("hex");
const work = mkdtempSync(path.join(tmpdir(), "ductus-worker-"));
const children: ChildProcess[] = [];
const opened: JobQueue[] = [];
const selfChecks: string[] = [];
let releasePresence: (() => Promise<void>) | undefined;
let queues = 0;

function workerUrl(): string {
  const target = new URL(ADMIN_URL);
  target.username = ROLE;
  target.password = password;
  return target.toString();
}

// The worker's own start, with handlers the test names: the entry takes its
// kinds from the code, so a slow or throwing job needs this second door.
type Handler = "ok" | "slow" | "hang" | "throws";
type Config = { settings: WorkerSettings; kinds: Array<{ definition: JobDefinition; handler: Handler }>; graceMs: number; slowMs: number; marker: string };
const driver = path.join(work, "driver.mjs");
writeFileSync(
  driver,
  `import ${JSON.stringify(pathToFileURL(path.resolve(__dirname, "../../scripts/worker/resolve.mjs")).href)};
const { startWorker } = await import(${JSON.stringify(pathToFileURL(path.resolve(__dirname, "../../src/runtime/worker/worker.ts")).href)});
const config = JSON.parse(process.env.IT_WORKER_CONFIG);
const handlers = {
  ok: async () => ({ ok: true }),
  slow: async () => { await new Promise((resolve) => setTimeout(resolve, config.slowMs)); return { ok: true }; },
  hang: () => new Promise(() => {}),
  throws: async () => { throw new Error(config.marker); },
};
await startWorker(config.settings, config.kinds.map((kind) => ({ definition: kind.definition, handler: handlers[kind.handler] })), { graceMs: config.graceMs });
`,
);

function definition(): JobDefinition {
  queues += 1;
  return { name: `it_wp_${RUN}_${queues}`, fields: ["checkId"], subject: "checkId" };
}

function settings(overrides: Partial<WorkerSettings["queue"]> = {}): WorkerSettings {
  const queue = { connectionString: workerUrl(), retryLimit: 2, retryDelaySeconds: 0, expireSeconds: 60, deadlineMs: 30_000, deleteAfterSeconds: 3600, sweepSeconds: 1, ...overrides };
  return { pollMs: 50, queue };
}

type Exit = { code: number | null; signal: NodeJS.Signals | null };
type Line = { level: string; event: string; fields?: Record<string, unknown> };

function start(script: string, env: Record<string, string>) {
  // Only what the test names: no variable of the host reaches the process.
  const clean: Record<string, string | undefined> = { PATH: process.env.PATH ?? "", ...env };
  const child = spawn(process.execPath, [script], { env: clean as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<Exit>((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const lines = (): Line[] => output.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Line);
  const ready = () => expect.poll(() => lines().map((line) => line.event), { timeout: 20_000, interval: 25 }).toContain("worker_started");
  return { child, exited, lines, output: () => output, ready };
}

function drive(def: JobDefinition, handler: Handler, extra: Partial<Config> = {}) {
  const config: Config = { settings: settings(), kinds: [{ definition: def, handler }], graceMs: 5_000, slowMs: 600, marker: MARKER, ...extra };
  return start(driver, { IT_WORKER_CONFIG: JSON.stringify(config) });
}

/** The test's own door to the queue: it only puts jobs there. */
async function open(def: JobDefinition, from: WorkerSettings): Promise<JobQueue> {
  const queue = await openJobQueue({ ...from.queue, definitions: [def] });
  opened.push(queue);
  return queue;
}

type Row = { state: string; retry_count: number; output: unknown; subject: string };
async function jobs(name: string): Promise<Row[]> {
  const sql = "SELECT state::text, retry_count, output, data->>'checkId' AS subject FROM pgboss.job WHERE name = $1 ORDER BY created_on";
  return (await admin.query<Row>(sql, [name])).rows;
}
const states = async (name: string): Promise<string[]> => (await jobs(name)).map((row) => row.state).sort();
const events = (lines: Line[], event: string) => lines.filter((line) => line.event === event).map((line) => line.fields);

beforeAll(async () => {
  // /api/ready counts any connected worker login: its test and this file take turns.
  releasePresence = await holdWorkerPresence(ADMIN_URL);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_worker', $1::text, $2::text) AS ddl",
    [ROLE, password],
  );
  await admin.query(ddl.rows[0].ddl);
}, 180_000);

afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.all(opened.splice(0).map((queue) => queue.stop().catch(() => {})));
});

afterAll(async () => {
  await admin.query("DELETE FROM pgboss.job WHERE name LIKE $1", [`it_wp_${RUN}_%`]);
  await admin.query("DELETE FROM pgboss.queue WHERE name LIKE $1", [`it_wp_${RUN}_%`]);
  // The self-check queue is the worker's own and stays; only this run's jobs go.
  await admin.query("DELETE FROM pgboss.job WHERE name = $1 AND data->>'checkId' = ANY($2::text[])", [SELF_CHECK.name, selfChecks]);
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await admin.end();
  await releasePresence?.();
  rmSync(work, { recursive: true, force: true });
});

describe("worker process: the entry the stack starts", () => {
  it("takes a queued job, completes it, and leaves with 0 on SIGTERM", async () => {
    const environment = parseWorkerEnvironment({ WORKER_DATABASE_URL: workerUrl(), WORKER_POLL_MS: "50" });
    if (!environment.ok) throw new Error("the environment of the test was refused");
    const queue = await open(SELF_CHECK, environment.settings);
    const checkId = randomUUID();
    selfChecks.push(checkId);
    expect(await queue.enqueue(SELF_CHECK.name, { checkId })).toBe("queued");

    const worker = start(ENTRY, { WORKER_DATABASE_URL: workerUrl(), WORKER_POLL_MS: "50" });
    await worker.ready();
    const mine = async () => (await jobs(SELF_CHECK.name)).filter((row) => row.subject === checkId);
    await expect.poll(mine, { timeout: 20_000, interval: 50 }).toMatchObject([{ state: "completed", retry_count: 0 }]);

    worker.child.kill("SIGTERM");
    expect(await worker.exited).toEqual({ code: 0, signal: null });
    expect(events(worker.lines(), "worker_started")).toEqual([{ jobs: ["worker_selfcheck"] }]);
    expect(events(worker.lines(), "worker_job")).toContainEqual({ job: "worker_selfcheck", status: "completed" });
    expect(worker.output()).not.toContain(password);
  });
});

describe("worker process: jobs in flight", () => {
  it("W-13: SIGTERM during a job lets it finish, takes no other job, and the process leaves with 0", async () => {
    const def = definition();
    const queue = await open(def, settings());
    for (const checkId of [randomUUID(), randomUUID()]) expect(await queue.enqueue(def.name, { checkId })).toBe("queued");

    const worker = drive(def, "slow");
    await expect.poll(() => states(def.name), { timeout: 20_000, interval: 20 }).toEqual(["active", "created"]);
    const signalled = Date.now();
    worker.child.kill("SIGTERM");
    expect(await worker.exited).toEqual({ code: 0, signal: null });
    expect(Date.now() - signalled).toBeLessThan(5_000);
    expect(await jobs(def.name)).toMatchObject([{ state: "completed", retry_count: 0 }, { state: "created", retry_count: 0 }]);
    expect(events(worker.lines(), "worker_job")).toHaveLength(1);
  });

  it("W-13: a job that outlives the grace period ends the process with 1 and stays the queue's to hand out again", async () => {
    const def = definition();
    const queue = await open(def, settings());
    expect(await queue.enqueue(def.name, { checkId: randomUUID() })).toBe("queued");

    const worker = drive(def, "hang", { graceMs: 300 });
    await expect.poll(() => states(def.name), { timeout: 20_000, interval: 20 }).toEqual(["active"]);
    worker.child.kill("SIGTERM");
    expect(await worker.exited).toEqual({ code: 1, signal: null });
    expect(events(worker.lines(), "shutdown")).toEqual([{ code: "SHUTDOWN_DEADLINE", request: 0, job: 1 }]);
    // Nothing recorded the attempt as done: the expiry gives it to the next worker.
    expect(await jobs(def.name)).toMatchObject([{ state: "active", retry_count: 0 }]);
  });

  it.each<[string, boolean]>([
    ["was killed", true],
    ["was ended by the fence because its handler ignored the deadline", false],
  ])("W-3, W-4: a job whose process %s is completed by the next process, as a second attempt", async (_label, kill) => {
    const def = definition();
    const timing = settings({ expireSeconds: 2, deadlineMs: 1_000 });
    const queue = await open(def, timing);
    expect(await queue.enqueue(def.name, { checkId: randomUUID() })).toBe("queued");

    const first = drive(def, "hang", { settings: timing });
    await expect.poll(() => states(def.name), { timeout: 20_000, interval: 20 }).toEqual(["active"]);
    const seen = Date.now();
    if (kill) first.child.kill("SIGKILL");
    // Nobody else ends it in the second row: the fence does, before the queue's two seconds are over.
    expect(await first.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(Date.now() - seen).toBeLessThan(2_000);
    expect(events(first.lines(), "worker_job")).toEqual([]);
    expect(await jobs(def.name)).toMatchObject([{ state: "active", retry_count: 0 }]);

    const second = drive(def, "ok", { settings: timing });
    await expect.poll(() => jobs(def.name), { timeout: 40_000, interval: 100 }).toMatchObject([{ state: "completed", retry_count: 1 }]);
    second.child.kill("SIGTERM");
    expect(await second.exited).toEqual({ code: 0, signal: null });
    expect(events(second.lines(), "worker_job")).toEqual([{ job: def.name, status: "completed" }]);
  }, 90_000);

  it("W-1 (negative): two processes on one queue run every job exactly once", async () => {
    const def = definition();
    const queue = await open(def, settings());
    const subjects = Array.from({ length: 8 }, () => randomUUID());
    for (const checkId of subjects) expect(await queue.enqueue(def.name, { checkId })).toBe("queued");

    const workers = [drive(def, "slow", { slowMs: 80 }), drive(def, "slow", { slowMs: 80 })];
    await expect.poll(() => states(def.name), { timeout: 30_000, interval: 50 }).toEqual(subjects.map(() => "completed"));
    for (const worker of workers) worker.child.kill("SIGTERM");
    expect(await Promise.all(workers.map((worker) => worker.exited))).toEqual([{ code: 0, signal: null }, { code: 0, signal: null }]);

    // Eight jobs, eight attempts: none was taken back, none was reported twice or lost.
    expect((await jobs(def.name)).map((row) => row.retry_count)).toEqual(subjects.map(() => 0));
    const reported = workers.flatMap((worker) => events(worker.lines(), "worker_job"));
    expect(reported).toEqual(subjects.map(() => ({ job: def.name, status: "completed" })));
  }, 60_000);

  it("W-12: what a handler throws reaches neither the output of the process nor the table", async () => {
    const def = definition();
    const once = settings({ retryLimit: 0 });
    const queue = await open(def, once);
    expect(await queue.enqueue(def.name, { checkId: randomUUID() })).toBe("queued");

    const worker = drive(def, "throws", { settings: once });
    await expect.poll(() => states(def.name), { timeout: 20_000, interval: 50 }).toEqual(["failed"]);
    worker.child.kill("SIGTERM");
    expect(await worker.exited).toEqual({ code: 0, signal: null });
    expect(events(worker.lines(), "worker_job")).toEqual([{ job: def.name, status: "failed", code: "handler_threw" }]);
    expect(await jobs(def.name)).toMatchObject([{ state: "failed", output: { code: "handler_threw" } }]);
    expect(worker.output() + JSON.stringify(await jobs(def.name))).not.toContain(MARKER);
  });
});
