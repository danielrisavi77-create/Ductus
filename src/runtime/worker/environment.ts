// DAN-517 (plan #1826 W-14): what the worker process reads from its
// environment. A problem names a variable and never its value, as in
// src/server/env.ts: the address carries a password.
import type { JobQueueSettings } from "@/server/db/job-queue";

type Env = Readonly<Record<string, string | undefined>>;

export type WorkerSettings = {
  readonly queue: Omit<JobQueueSettings, "definitions" | "onError">;
  /** Wait between two looks at an empty queue. */
  readonly pollMs: number;
};

export type WorkerEnvironment =
  | { readonly ok: true; readonly settings: WorkerSettings }
  | { readonly ok: false; readonly problems: readonly string[] };

const DAY = 86_400;
/** [default, least, most]. The limits of the queue settings are those of openJobQueue. */
export const WORKER_NUMBERS = {
  WORKER_POLL_MS: [1000, 50, 60_000],
  WORKER_RETRY_LIMIT: [3, 0, 20],
  WORKER_RETRY_DELAY_SECONDS: [30, 0, 3600],
  WORKER_JOB_EXPIRE_SECONDS: [120, 1, 3600],
  WORKER_JOB_DEADLINE_MS: [60_000, 1, 3_599_999],
  WORKER_KEEP_SECONDS: [7 * DAY, 1, 365 * DAY],
  WORKER_SWEEP_SECONDS: [10, 1, 3600],
} as const;

const PROTOCOLS = new Set(["postgres:", "postgresql:"]);
// Digits only, no sign, no leading zero: a value is never guessed at.
const WHOLE = /^(0|[1-9][0-9]{0,8})$/;

function addressProblem(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return "is not set";
  if (/\s/.test(value)) return "is not a URL";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "is not a URL";
  }
  if (!PROTOCOLS.has(parsed.protocol)) return "is not a postgres URL";
  return parsed.hostname === "" ? "names no host" : null;
}

/** Reads every variable and reports every problem at once; a variable that is set but wrong is never replaced by its default. */
export function parseWorkerEnvironment(env: Env): WorkerEnvironment {
  const problems: string[] = [];
  const address = addressProblem(env.WORKER_DATABASE_URL);
  if (address !== null) problems.push(`WORKER_DATABASE_URL ${address}`);

  const read = (name: keyof typeof WORKER_NUMBERS): number => {
    const [fallback, min, max] = WORKER_NUMBERS[name];
    const value = env[name];
    if (value === undefined) return fallback;
    if (!WHOLE.test(value)) problems.push(`${name} is not a whole number`);
    else if (Number(value) < min || Number(value) > max) problems.push(`${name} is out of range`);
    else return Number(value);
    return Number.NaN;
  };
  const pollMs = read("WORKER_POLL_MS");
  const retryLimit = read("WORKER_RETRY_LIMIT");
  const retryDelaySeconds = read("WORKER_RETRY_DELAY_SECONDS");
  const expireSeconds = read("WORKER_JOB_EXPIRE_SECONDS");
  const deadlineMs = read("WORKER_JOB_DEADLINE_MS");
  const deleteAfterSeconds = read("WORKER_KEEP_SECONDS");
  const sweepSeconds = read("WORKER_SWEEP_SECONDS");
  // NaN (a problem already reported) compares false, so this adds nothing then.
  if (deadlineMs >= expireSeconds * 1000) problems.push("WORKER_JOB_DEADLINE_MS is not below WORKER_JOB_EXPIRE_SECONDS");

  if (problems.length > 0) return { ok: false, problems };
  const connectionString = env.WORKER_DATABASE_URL as string;
  return {
    ok: true,
    settings: { pollMs, queue: { connectionString, retryLimit, retryDelaySeconds, expireSeconds, deadlineMs, deleteAfterSeconds, sweepSeconds } },
  };
}
