import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { JobBody, JobDefinition } from "@/application/jobs/job-body";
import type { AttemptFence } from "@/server/attempt-fence";
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

// The real fence ends the process it runs in, so inside the test runner a
// recorder stands in for it: what was armed, and what would have fired. The
// real one runs in the child processes further down.
const fence = { armed: [] as number[], fired: [] as number[] };
function recordingFence(): AttemptFence {
  return {
    arm(ms) {
      fence.armed.push(ms);
      const timer = setTimeout(() => fence.fired.push(ms), ms);
      return () => clearTimeout(timer);
    },
    close: async () => {},
  };
}

function settings(def: JobDefinition, connectionString: string, overrides: Partial<JobQueueSettings>): JobQueueSettings {
  return {
    connectionString, definitions: [def], retryLimit: 2, retryDelaySeconds: 0, deadlineMs: 30_000,
    expireSeconds: 60, deleteAfterSeconds: 3600, sweepSeconds: 1, onError: (code) => errors.push(code),
    fence: recordingFence, ...overrides,
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

function withParameter(name: string, value: string): string {
  const target = new URL(url(`it_jobq_${RUN}_nobody`));
  target.searchParams.set(name, value);
  return target.toString();
}

// A real worker process: plain node, the adapter as it is in src/, the real
// fence. Its settings travel in the environment and are never printed.
const work = mkdtempSync(path.join(tmpdir(), "ductus-jobq-"));
const SRC = `${pathToFileURL(path.resolve(__dirname, "../../src")).href}/`;
type Ending = { code: number | null; signal: NodeJS.Signals | null };
type WorkerProcess = { readonly started: Promise<void>; readonly ended: Promise<Ending>; ending(): Ending | undefined; stdout(): string; kill(): void };

function spawnWorker(def: JobDefinition, timing: Partial<JobQueueSettings>, handlerBody: string): WorkerProcess {
  const file = path.join(work, `${def.name}.mjs`);
  writeFileSync(
    file,
    `import { registerHooks } from "node:module";
const SRC = ${JSON.stringify(SRC)};
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith("@/") ? SRC + specifier.slice(2) + ".ts" : specifier, context) });
const { openJobQueue } = await import(SRC + "server/db/job-queue.ts");
const { name, ...settings } = JSON.parse(process.env.DUCTUS_JOBQ_CASE);
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const queue = await openJobQueue(settings);
const outcome = await queue.runOnce(name, async () => { console.log("started"); ${handlerBody} });
console.log("returned " + outcome.status);
await queue.stop();
`,
  );
  // What cannot travel as text stays behind: the child reports nothing and runs the real fence.
  const plain = { ...settings(def, url(role("workerA")), timing), onError: undefined, fence: undefined };
  const child = spawn(process.execPath, [file], {
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", DUCTUS_JOBQ_CASE: JSON.stringify({ name: def.name, ...plain }) },
    stdio: ["ignore", "pipe", "ignore"],
  });
  let stdout = "";
  let ending: Ending | undefined;
  let begin = (): void => {};
  let refuse: (reason: Error) => void = () => {};
  const started = new Promise<void>((resolve, reject) => { begin = resolve; refuse = reject; });
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.includes("started\n")) begin(); });
  const ended = new Promise<Ending>((resolve) => {
    child.on("close", (code, signal) => {
      ending = { code, signal };
      // Only how it ended: what a failed start wrote may carry text.
      refuse(new Error(`worker process ended before its handler started: ${JSON.stringify(ending)}`));
      resolve(ending);
    });
  });
  return { started, ended, ending: () => ending, stdout: () => stdout, kill: () => void child.kill("SIGKILL") };
}

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
  fence.armed.length = 0;
  fence.fired.length = 0;
});

afterAll(async () => {
  await admin.query("DELETE FROM pgboss.job WHERE name LIKE $1", [`it_jobq_${RUN}_%`]);
  await admin.query("DELETE FROM pgboss.queue WHERE name LIKE $1", [`it_jobq_${RUN}_%`]);
  for (const login of Object.keys(LOGINS) as Login[]) await admin.query(`DROP ROLE IF EXISTS ${role(login)}`);
  await admin.end();
  await releasePresence?.();
  rmSync(work, { recursive: true, force: true });
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
    // Every take, the idle one too, ran fenced at the midpoint between the deadline and expiry, and was released.
    expect(fence).toEqual({ armed: [45_000, 45_000], fired: [] });
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

  // The thread is held right after the job was asked for: the take lasts at least that long.
  const hold = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  it("W-4: after a slow take the handler is still told to stop before the fence fires", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0, expireSeconds: 2, deadlineMs: 1000 });
    await queue.enqueue(def.name, body(41));
    const waited: number[] = [];
    const stopped: JobHandler = (_job, signal) => {
      const from = Date.now();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { waited.push(Date.now() - from); reject(new Error("aborted")); }));
    };
    const run = queue.runOnce(def.name, stopped);
    hold(600);
    expect(await run).toEqual({ status: "failed", code: "timeout" });
    // The deadline counted from before the take, so the fence (armed for 1500 ms) had not fired.
    expect(fence).toEqual({ armed: [1500], fired: [] });
    expect(waited).toHaveLength(1);
    expect(waited[0]).toBeLessThan(900);
  });

  it("W-4: a take that lasted longer than the deadline is stored as timeout and its handler is not run", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0, expireSeconds: 1, deadlineMs: 300 });
    await queue.enqueue(def.name, body(42));
    let runs = 0;
    const run = queue.runOnce(def.name, async () => { runs += 1; return { ok: true }; });
    hold(350);
    expect(await run).toEqual({ status: "failed", code: "timeout" });
    expect(runs).toBe(0);
    expect(await jobs(def.name)).toEqual([{ state: "failed", retry_count: 0, output: { code: "timeout" }, data: body(42) }]);
    expect(fence).toEqual({ armed: [650], fired: [] });
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
    // The fence of the first attempt had fired before the job could be taken again: outside a test that ends its process.
    expect(fence).toEqual({ armed: [650], fired: [650] });
    expect(await jobs(def.name)).toEqual([{ state: "retry", retry_count: 0, output: { code: "expired" }, data: body(70) }]);
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

  it("W-3, W-12: an attempt the sweep took back for good is stored as the code expired, never as the package's sentence", async () => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0, expireSeconds: 1, deadlineMs: 300 });
    await queue.enqueue(def.name, body(71));
    const started = gate();
    const release = gate();
    const first = queue.runOnce(def.name, async () => { started.open(); await release.wait; return { ok: true }; });
    await started.wait;
    await expect.poll(async () => { await queue.sweep(def.name); return (await jobs(def.name))[0].state; }, { timeout: 20_000, interval: 250 }).toBe("failed");
    const rows = await jobs(def.name);
    expect(rows).toEqual([{ state: "failed", retry_count: 0, output: { code: "expired" }, data: body(71) }]);
    expect(JSON.stringify(rows)).not.toContain("timed out");
    release.open();
    expect(await first).toEqual({ status: "lost" });
    expect(await jobs(def.name)).toEqual(rows);
  });

  it.each<[string, number, string]>([
    ["for good", 0, "failed"],
    ["for another attempt", 1, "retry"],
  ])("W-3, W-12 (Istodobnost, negative): a sweep cut off right after it took an attempt back %s has already stored the code expired", async (_label, retryLimit, state) => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit, expireSeconds: 1, deadlineMs: 300 });
    // The cut: once a job of this queue carries an outcome, every later write to
    // it fails. Whatever a sweep meant to do after taking the attempt back is lost.
    const cut = `it_jobq_${RUN}_cut_${retryLimit}`;
    await admin.query(`CREATE FUNCTION public.${cut}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.name = TG_ARGV[0] AND OLD.output IS NOT NULL THEN RAISE EXCEPTION 'synthetic interruption'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER ${cut} BEFORE UPDATE ON pgboss.job_common FOR EACH ROW EXECUTE FUNCTION public.${cut}('${def.name}')`);
    const release = gate();
    let first: Promise<unknown> = Promise.resolve();
    try {
      await queue.enqueue(def.name, body(72));
      const started = gate();
      first = queue.runOnce(def.name, async () => { started.open(); await release.wait; return { ok: true }; });
      await started.wait;
      const cutOff: unknown[] = [];
      await expect.poll(async () => {
        await queue.sweep(def.name).catch((error: unknown) => cutOff.push(error));
        return (await jobs(def.name))[0].state;
      }, { timeout: 20_000, interval: 250 }).toBe(state);
      const rows = await jobs(def.name);
      expect(rows).toEqual([{ state, retry_count: 0, output: { code: "expired" }, data: body(72) }]);
      expect(JSON.stringify(rows)).not.toContain("timed out");
      // Nothing was left to write after the attempt was taken back, so nothing was cut off.
      expect(cutOff).toEqual([]);
      // Control: the cut is real. A second write to this job is refused.
      await expect(admin.query("UPDATE pgboss.job SET output = output WHERE name = $1", [def.name])).rejects.toThrow("synthetic interruption");
      release.open();
      expect(await first).toEqual({ status: "lost" });
      expect(await jobs(def.name)).toEqual(rows);
    } finally {
      release.open();
      await first.catch(() => {});
      await admin.query(`DROP TRIGGER ${cut} ON pgboss.job_common`);
      await admin.query(`DROP FUNCTION public.${cut}()`);
    }
  });

  type Seed = { key: string; state: string; startedSecondsAgo: number | null; retryCount: number; output: string | null };
  async function seed(name: string, row: Seed): Promise<void> {
    await admin.query(
      `INSERT INTO pgboss.job (name, data, singleton_key, policy, state, retry_limit, retry_count, expire_seconds, deletion_seconds, started_on, completed_on, output)
       VALUES ($1, $2::jsonb, $3, 'exclusive', $4::text::pgboss.job_state, 2, $5, 60, 3600, now() - $6::int * interval '1s',
               CASE WHEN $4::text IN ('completed', 'failed') THEN now() END, $7::jsonb)`,
      [name, JSON.stringify(body(73)), row.key, row.state, row.retryCount, row.startedSecondsAgo, row.output],
    );
  }
  type Swept = { key: string; state: string; retry_count: number; output: unknown; ended: boolean };
  async function swept(name: string): Promise<Swept[]> {
    return (await admin.query<Swept>(
      "SELECT singleton_key AS key, state::text, retry_count, output, completed_on IS NOT NULL AS ended FROM pgboss.job WHERE name = $1 ORDER BY created_on, singleton_key", [name],
    )).rows;
  }
  const refusedBefore = '{"code":"synthetic_refusal"}';

  it("W-3: one sweep takes back exactly the attempts past their expiry in its own queue, and leaves every other job as it was", async () => {
    const def = definition();
    const other = definition();
    const queue = await open(def);
    await open(other);
    // Every class of job a sweep can meet, as [what was stored, what one sweep leaves].
    const classes: [Seed, Omit<Swept, "key">][] = [
      [{ key: "expired-first-attempt", state: "active", startedSecondsAgo: 61, retryCount: 0, output: null }, { state: "retry", retry_count: 0, output: { code: "expired" }, ended: false }],
      [{ key: "expired-one-attempt-left", state: "active", startedSecondsAgo: 61, retryCount: 1, output: null }, { state: "retry", retry_count: 1, output: { code: "expired" }, ended: false }],
      [{ key: "expired-last-attempt", state: "active", startedSecondsAgo: 61, retryCount: 2, output: null }, { state: "failed", retry_count: 2, output: { code: "expired" }, ended: true }],
      [{ key: "within-its-expiry", state: "active", startedSecondsAgo: 30, retryCount: 0, output: null }, { state: "active", retry_count: 0, output: null, ended: false }],
      [{ key: "waiting", state: "created", startedSecondsAgo: null, retryCount: 0, output: null }, { state: "created", retry_count: 0, output: null, ended: false }],
      [{ key: "waiting-to-retry", state: "retry", startedSecondsAgo: 300, retryCount: 1, output: refusedBefore }, { state: "retry", retry_count: 1, output: { code: "synthetic_refusal" }, ended: false }],
      [{ key: "completed", state: "completed", startedSecondsAgo: 300, retryCount: 0, output: null }, { state: "completed", retry_count: 0, output: null, ended: true }],
      [{ key: "failed", state: "failed", startedSecondsAgo: 300, retryCount: 2, output: refusedBefore }, { state: "failed", retry_count: 2, output: { code: "synthetic_refusal" }, ended: true }],
    ];
    for (const [row] of classes) await seed(def.name, row);
    await seed(other.name, { key: "expired-in-another-queue", state: "active", startedSecondsAgo: 300, retryCount: 0, output: null });
    await queue.sweep(def.name);
    expect(await swept(def.name)).toEqual(classes.map(([row, after]) => ({ key: row.key, ...after })));
    expect(await swept(other.name)).toEqual([{ key: "expired-in-another-queue", state: "active", retry_count: 0, output: null, ended: false }]);
    // A job taken back for another attempt is handed out again.
    const again: string[] = [];
    await drain(queue, def.name, async () => { again.push("ran"); return { ok: true }; });
    expect(again).toHaveLength(4);
  });

  it("W-3 (Istodobnost): a second sweep inside the sweep interval, whoever asks, changes nothing", async () => {
    const def = definition();
    const [a, b] = await Promise.all([open(def, "workerA", { sweepSeconds: 3600 }), open(def, "workerB", { sweepSeconds: 3600 })]);
    await a.sweep(def.name);
    await seed(def.name, { key: "expired-after-the-sweep", state: "active", startedSecondsAgo: 61, retryCount: 0, output: null });
    await Promise.all([a.sweep(def.name), b.sweep(def.name)]);
    expect(await swept(def.name)).toEqual([{ key: "expired-after-the-sweep", state: "active", retry_count: 0, output: null, ended: false }]);
  });

  it.each<[string, string]>([
    ["ignores the stop signal", `setInterval(() => {}, 1000); await new Promise(() => {});`],
    ["blocks the thread", `for (;;) {}`],
    ["finishes after its time", `await later(6000); return { ok: true };`],
  ])("W-3, W-4 (Istodobnost, negative): a worker process whose handler %s is gone before its job is handed out again", async (_label, handlerBody) => {
    const def = definition();
    const timing = { expireSeconds: 2, deadlineMs: 200 };
    const b = await open(def, "workerB", timing);
    await b.enqueue(def.name, body(75));
    const child = spawnWorker(def, timing, handlerBody);
    try {
      await child.started;
      // The first attempt is running in the other process. Before every sweep: is that process still there?
      const alive: boolean[] = [];
      await expect.poll(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        alive.push(child.ending() === undefined);
        await b.sweep(def.name);
        return (await jobs(def.name))[0].state;
      }, { timeout: 20_000, interval: 100 }).toBe("retry");
      expect(alive.at(-1)).toBe(false);
      expect(alive[0]).toBe(true);
      expect(await child.ended).toEqual({ code: null, signal: "SIGKILL" });
      expect(child.stdout()).toBe("started\n");
      let second = 0;
      expect(await b.runOnce(def.name, async () => { second += 1; return { ok: true }; })).toEqual({ status: "completed" });
      expect(second).toBe(1);
      expect(await jobs(def.name)).toEqual([{ state: "completed", retry_count: 1, output: null, data: body(75) }]);
    } finally {
      child.kill();
    }
  });

  it("W-3 (control): a worker process whose handler finishes in time lives on, records the job and exits 0", async () => {
    const def = definition();
    const timing = { expireSeconds: 2, deadlineMs: 200 };
    const b = await open(def, "workerB", timing);
    await b.enqueue(def.name, body(76));
    const child = spawnWorker(def, timing, `await later(50); return { ok: true };`);
    try {
      expect(await child.ended).toEqual({ code: 0, signal: null });
      expect(child.stdout()).toBe("started\nreturned completed\n");
      expect(await jobs(def.name)).toEqual([{ state: "completed", retry_count: 0, output: null, data: body(76) }]);
    } finally {
      child.kill();
    }
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
    ["a deadline closer than half a second to expiry", () => ({ expireSeconds: 1, deadlineMs: 501 }), "settings_invalid"],
    ["a connection string that names a certificate file that is not there", () => ({ connectionString: withParameter("sslrootcert", "/nonexistent/synthetic-root.crt") }), "settings_invalid"],
    ["a negative retry limit", () => ({ retryLimit: -1 }), "settings_invalid"],
    ["a fractional retry delay", () => ({ retryDelaySeconds: 0.5 }), "settings_invalid"],
    ["a sweep interval of zero", () => ({ sweepSeconds: 0 }), "settings_invalid"],
    ["an empty connection string", () => ({ connectionString: "" }), "settings_invalid"],
  ])("W-14: refuses %s before it connects", async (_label, overrides, code) => {
    const def = definition();
    // The login does not exist: a refusal by code proves nothing was sent to the database.
    expect(await refusal(openJobQueue(settings(def, url(`it_jobq_${RUN}_nobody`), overrides(def))))).toEqual(refused(code));
  });

  it("W-14: a fence that cannot be started refuses the queue by code, without the cause", async () => {
    const outcome = await refusal(open(definition(), "workerA", { fence: () => { throw new Error("synthetic marker 5c1d"); } }));
    expect(outcome).toEqual(refused("settings_invalid"));
    expect(JSON.stringify(outcome)).not.toContain("5c1d");
  });

  it("W-14: a deadline exactly half a second before expiry passes the settings check", async () => {
    const outcome = await refusal(openJobQueue(settings(definition(), url(`it_jobq_${RUN}_nobody`), { expireSeconds: 1, deadlineMs: 500 })));
    expect(outcome).toEqual(refused("queue_unreachable"));
  });

  it("W-9: refuses a queue that exists with other settings, and a queue name it was not opened for", async () => {
    const def = definition();
    const queue = await open(def);
    expect(await refusal(open(def, "workerB", { retryLimit: 3 }))).toEqual(refused("queue_mismatch"));
    expect(await refusal(open(def, "workerB", { expireSeconds: 61 }))).toEqual(refused("queue_mismatch"));
    // A queue that expects a heartbeat would take running jobs back: nothing here renews one.
    await admin.query("UPDATE pgboss.queue SET heartbeat_seconds = 30 WHERE name = $1", [def.name]);
    expect(await refusal(open(def, "workerB"))).toEqual(refused("queue_mismatch"));
    await admin.query("UPDATE pgboss.queue SET heartbeat_seconds = NULL WHERE name = $1", [def.name]);
    await open(def, "workerB");
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

  it.each<[string, string]>([
    ["a heartbeat nothing here renews", "heartbeat_seconds = 30"],
    ["an expiry shorter than the queue's", "expire_seconds = 1"],
    ["an expiry longer than the queue's", "expire_seconds = 600"],
  ])("W-3: a job that carries %s is not run and is stored as invalid_lease", async (_label, change) => {
    const def = definition();
    const queue = await open(def, "workerA", { retryLimit: 0 });
    await queue.enqueue(def.name, body(92));
    await admin.query(`UPDATE pgboss.job SET ${change} WHERE name = $1`, [def.name]);
    let ran = 0;
    expect(await queue.runOnce(def.name, async () => { ran += 1; return { ok: true }; })).toEqual({ status: "failed", code: "invalid_lease" });
    expect(ran).toBe(0);
    expect(await jobs(def.name)).toEqual([{ state: "failed", retry_count: 0, output: { code: "invalid_lease" }, data: body(92) }]);
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
