// DAN-517 (D-71, D-74; docs/backend/poslovi-i-predaja.md 4.5): the worker's
// side of the pg-boss queue. The only file that imports pg-boss. It opens the
// queue for a login that is a worker and nothing more, puts identifiers only
// into a job, takes one job at a time and settles exactly the attempt it took.
// An attempt that is still running when the queue could hand its job out again
// ends this process (attempt-fence.ts), so two attempts of one job never run at
// once. The schema is the one the migrations installed: nothing here builds a table.
import pg from "pg";
import { PgBoss } from "pg-boss";

import { isJobDefinition, parseJobBody, type JobBody, type JobDefinition } from "@/application/jobs/job-body";
import { startAttemptFence, type AttemptFence } from "@/server/attempt-fence";

export type JobQueueErrorCode =
  | "definition_invalid"
  | "settings_invalid"
  | "queue_unreachable"
  | "role_not_worker"
  | "queue_mismatch"
  | "definition_unknown"
  | "queue_failed";

/** The message is the code: no connection string and no driver text leaves this file. */
export class JobQueueError extends Error {
  readonly code: JobQueueErrorCode;
  constructor(code: JobQueueErrorCode) {
    super(code);
    this.name = "JobQueueError";
    this.code = code;
  }
}

export type JobQueueSettings = {
  readonly connectionString: string;
  readonly definitions: readonly JobDefinition[];
  /** Attempts after the first one. */
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  /** The handler is asked to stop this long after the job was asked for; at least half a second before the queue takes it back. */
  readonly deadlineMs: number;
  /** A job active this long belongs to a worker that is gone; the sweep hands it out again. */
  readonly expireSeconds: number;
  readonly deleteAfterSeconds: number;
  /** Least time between two sweeps of one queue, whoever asks. */
  readonly sweepSeconds: number;
  /** A failure of the queue's own background work. Only that it happened is reported. */
  readonly onError?: (code: "queue_error") => void;
  /** What ends an attempt that outlives its time. Left out, it is the process fence; a test replaces it. */
  readonly fence?: () => AttemptFence;
};

/** Refuses with a short code (`[a-z][a-z0-9_]*`); anything else is stored as `handler_failed`. */
export type JobHandler = (body: JobBody, signal: AbortSignal) => Promise<{ ok: true } | { ok: false; code: string }>;

/** `lost`: the attempt was taken back before it was settled, so nothing was written for it. */
export type JobOutcome =
  | { readonly status: "idle" | "completed" | "lost" }
  | { readonly status: "failed"; readonly code: string };

export type JobQueue = {
  /** `duplicate`: a job for the same subject is already waiting or running. */
  enqueue(name: string, input: unknown): Promise<"queued" | "duplicate" | "rejected">;
  runOnce(name: string, handler: JobHandler): Promise<JobOutcome>;
  sweep(name: string): Promise<void>;
  /** Jobs waiting, waiting for a retry or running. */
  depth(name: string): Promise<number>;
  stop(): Promise<void>;
};

const CODE = /^[a-z][a-z0-9_]{0,39}$/;
const DAY = 86_400;
const DEPTH_SQL =
  "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry', 'active')";
// The whole sweep of one queue, as one statement: either all of it happens or
// none. `due` claims the queue for this sweep, and a second sweep that asks
// inside the interval waits for the claim and then changes nothing. `expired`
// takes back every attempt past its expiry and stores its outcome in the same
// row update, so no instant exists in which the attempt is taken back and its
// outcome is anything but the one code. The last line removes what is past
// its keep time. The package's own sweep is never run: it would store a
// sentence as the outcome first. Both conditions are the ones it uses; the
// step back to a retry is its plain one, which is why opening refuses a
// queue with a growing retry delay or a dead letter queue.
const SWEEP_SQL = `
  WITH due AS (
    UPDATE pgboss.queue SET maintain_on = pgboss.job_now()
    WHERE name = $1 AND (maintain_on IS NULL OR maintain_on + $2::int * interval '1s' <= pgboss.job_now())
    RETURNING name
  ), expired AS (
    UPDATE pgboss.job SET
      state = CASE WHEN retry_count < retry_limit THEN 'retry' ELSE 'failed' END::pgboss.job_state,
      completed_on = CASE WHEN retry_count < retry_limit THEN NULL ELSE pgboss.job_now() END,
      start_after = CASE WHEN retry_count < retry_limit THEN pgboss.job_now() + retry_delay * interval '1s' ELSE start_after END,
      heartbeat_on = NULL,
      output = '{"code":"expired"}'::jsonb
    WHERE name = $1 AND EXISTS (SELECT 1 FROM due)
      AND state = 'active' AND started_on + expire_seconds * interval '1s' < pgboss.job_now()
  )
  DELETE FROM pgboss.job
  WHERE name = $1 AND EXISTS (SELECT 1 FROM due)
    AND ((deletion_seconds > 0 AND completed_on + deletion_seconds * interval '1s' < pgboss.job_now())
         OR (state < 'active' AND keep_until < pgboss.job_now()))`;
// True only for a login with no elevated attribute whose one role is
// ductus_worker and which cannot build in the queue schema: a login that is
// also the web role, the queue owner or the migrator must not run jobs. The
// login checked is the one that authenticated (session_user; the server does
// not let a connection's start-up settings change it), and the session must
// run as that login: a role set when the connection starts (`options`) would
// otherwise let an elevated login pass as a worker.
const ROLE_SQL = `
  SELECT CASE
    WHEN session_user IS DISTINCT FROM current_user THEN false
    WHEN r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication THEN false
    WHEN (SELECT pg_catalog.array_agg(g.rolname::text ORDER BY g.rolname) FROM pg_catalog.pg_roles g
           WHERE g.oid <> r.oid AND pg_catalog.pg_has_role(r.oid, g.oid, 'MEMBER'))
         IS DISTINCT FROM ARRAY['ductus_worker'] THEN false
    WHEN pg_catalog.has_schema_privilege(r.oid, 'pgboss', 'CREATE') THEN false
    ELSE NOT pg_catalog.has_table_privilege(r.oid, 'pgboss.version', 'UPDATE')
  END AS ok
  FROM pg_catalog.pg_roles r WHERE r.rolname = session_user`;

function whole(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validSettings(s: JobQueueSettings): boolean {
  return (
    typeof s.connectionString === "string" && s.connectionString !== "" &&
    whole(s.retryLimit, 0, 20) && whole(s.retryDelaySeconds, 0, 3600) && whole(s.expireSeconds, 1, 3600) &&
    whole(s.deadlineMs, 1, s.expireSeconds * 1000 - 500) && whole(s.deleteAfterSeconds, 1, 365 * DAY) &&
    whole(s.sweepSeconds, 1, 3600)
  );
}

async function requireWorkerLogin(connectionString: string): Promise<void> {
  let client: pg.Client;
  try {
    // The driver reads files the connection string names while it is built, and throws their paths.
    client = new pg.Client({ connectionString, application_name: "ductus-worker-guard", connectionTimeoutMillis: 10_000 });
  } catch {
    throw new JobQueueError("settings_invalid");
  }
  client.on("error", () => {});
  try {
    await client.connect();
  } catch {
    await client.end().catch(() => {});
    throw new JobQueueError("queue_unreachable");
  }
  try {
    const { rows } = await client.query<{ ok: boolean }>(ROLE_SQL);
    if (rows.length !== 1 || rows[0].ok !== true) throw new JobQueueError("role_not_worker");
  } catch {
    throw new JobQueueError("role_not_worker");
  } finally {
    await client.end().catch(() => {});
  }
}

/** Runs the handler once and returns null when it succeeded, else the code to store. */
async function attempt(handler: JobHandler, body: JobBody, deadlineMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const result = await handler(body, controller.signal);
    // Work that finished is recorded even past the deadline; the queue itself
    // refuses the record if the attempt has been taken back meanwhile.
    if (result.ok === true) return null;
    if (controller.signal.aborted) return "timeout";
    const code: unknown = result.code;
    return typeof code === "string" && CODE.test(code) ? code : "handler_failed";
  } catch {
    // What was thrown is not kept: it may carry text.
    return controller.signal.aborted ? "timeout" : "handler_threw";
  } finally {
    clearTimeout(timer);
  }
}

function affected(response: unknown): number {
  const value = typeof response === "object" && response !== null ? (response as { affected?: unknown }).affected : undefined;
  return typeof value === "number" ? value : 0;
}

/**
 * Opens the queue for the given job definitions. Throws a JobQueueError when
 * the settings are wrong, the database cannot be reached, the login is not a
 * plain worker login, or a queue exists with other settings than these. Every
 * later failure of the queue is a JobQueueError too (`queue_failed`).
 */
export async function openJobQueue(settings: JobQueueSettings): Promise<JobQueue> {
  const definitions = new Map<string, JobDefinition>();
  for (const definition of settings.definitions) {
    if (!isJobDefinition(definition) || definitions.has(definition.name)) throw new JobQueueError("definition_invalid");
    definitions.set(definition.name, definition);
  }
  if (definitions.size === 0) throw new JobQueueError("definition_invalid");
  if (!validSettings(settings)) throw new JobQueueError("settings_invalid");
  await requireWorkerLogin(settings.connectionString);

  const expected = {
    policy: "exclusive",
    retryLimit: settings.retryLimit,
    retryDelay: settings.retryDelaySeconds,
    expireInSeconds: settings.expireSeconds,
    deleteAfterSeconds: settings.deleteAfterSeconds,
  } as const;
  // The fence fires after the handler was asked to stop and before the queue takes the job back.
  const fenceMs = settings.deadlineMs + Math.floor((settings.expireSeconds * 1000 - settings.deadlineMs) / 2);
  let boss: PgBoss;
  let fence: AttemptFence;
  try {
    // No background work of the package runs: the caller sweeps, and what
    // needs rights the worker does not have (migration, reindex) is off.
    boss = new PgBoss({
      connectionString: settings.connectionString, application_name: "ductus-worker", max: 4,
      schema: "pgboss", migrate: false, supervise: false, schedule: false, monitorVacuum: false, reindex: false,
    });
    fence = (settings.fence ?? startAttemptFence)();
  } catch {
    throw new JobQueueError("settings_invalid");
  }
  boss.on("error", () => settings.onError?.("queue_error"));
  try {
    await boss.start();
    for (const name of definitions.keys()) {
      await boss.createQueue(name, expected);
      const queue = await boss.getQueue(name);
      // Nothing here renews a heartbeat, so a queue that expects one would take running jobs back.
      // The sweep neither grows a retry delay nor copies a failed job to a dead letter queue.
      const same = queue !== null && queue.partition !== true && queue.heartbeatSeconds === null &&
        queue.retryBackoff !== true && (queue.deadLetter ?? null) === null &&
        (Object.keys(expected) as Array<keyof typeof expected>).every((key) => queue[key] === expected[key]);
      if (!same) throw new JobQueueError("queue_mismatch");
    }
  } catch (error) {
    await boss.stop({ timeout: 1000 }).catch(() => {});
    await fence.close().catch(() => {});
    throw error instanceof JobQueueError ? error : new JobQueueError("queue_unreachable");
  }

  function known(name: string): JobDefinition {
    const definition = definitions.get(name);
    if (definition === undefined) throw new JobQueueError("definition_unknown");
    return definition;
  }

  /** What the driver or the package throws stops here as a code: it may carry text. */
  async function closed<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw error instanceof JobQueueError ? error : new JobQueueError("queue_failed");
    }
  }

  /**
   * Runs the work with the fence armed. It is armed before the job is taken, so
   * its time is never later than the queue's, and released before the outcome
   * is settled: settling is guarded by the queue's own check of the attempt.
   */
  async function fenced<T>(work: () => Promise<T>): Promise<T> {
    const release = fence.arm(fenceMs);
    try {
      return await work();
    } finally {
      release();
    }
  }

  return {
    enqueue: (name, input) => closed(async () => {
      const definition = definitions.get(name);
      const parsed = definition === undefined ? undefined : parseJobBody(input, definition.fields);
      if (definition === undefined || parsed === undefined || !parsed.ok) return "rejected";
      const id = await boss.send(name, parsed.body, { singletonKey: parsed.body[definition.subject] });
      return id === null ? "duplicate" : "queued";
    }),
    runOnce: (name, handler) => closed(async () => {
      const definition = known(name);
      const from = performance.now();
      const taken = await fenced(async () => {
        const [job] = await boss.fetch(name, { batchSize: 1 });
        if (job === undefined) return null;
        // The row is read again as untrusted: another writer of the table is not this code.
        const parsed = parseJobBody(job.data, definition.fields);
        if (!parsed.ok) return { job, code: "invalid_body" };
        // One that carries its own expiry or a heartbeat is not run: the fence is set for this queue's expiry.
        const leased = job.expireInSeconds === settings.expireSeconds && job.heartbeatSeconds === null;
        if (!leased) return { job, code: "invalid_lease" };
        // The handler's time counts from before the fence was armed, so it is asked to stop before the
        // fence fires however long the take lasted. A take that used the time up is not run.
        const left = settings.deadlineMs - Math.ceil(performance.now() - from);
        return { job, code: left < 1 ? "timeout" : await attempt(handler, parsed.body, left) };
      });
      if (taken === null) return { status: "idle" };
      const { job, code } = taken;
      // Settled by attempt (id and retry count), not by id alone: an attempt
      // the sweep has taken back changes nothing.
      const response = code === null ? await boss.complete(name, job) : await boss.fail(name, job, { code });
      if (affected(response) !== 1) return { status: "lost" };
      return code === null ? { status: "completed" } : { status: "failed", code };
    }),
    sweep: (name) => closed(async () => {
      known(name);
      await boss.getDb().executeSql(SWEEP_SQL, [name, settings.sweepSeconds]);
    }),
    depth: (name) => closed(async () => {
      known(name);
      const { rows } = await boss.getDb().executeSql(DEPTH_SQL, [name]);
      return Number(rows[0].n);
    }),
    stop: () => closed(async () => {
      try {
        await boss.stop({ timeout: 5000 });
      } finally {
        await fence.close();
      }
    }),
  };
}
