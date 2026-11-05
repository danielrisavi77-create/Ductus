// D-91 (3), DAN-71: dbmate does not lock, so two runs against one database
// could apply migrations at the same time. This runner holds a session-level
// pg_advisory_lock on its own connection for the whole dbmate run and stops
// dbmate when that connection is lost (error, close or a heartbeat that fails
// or hangs). dbmate runs each migration in a transaction, so a stopped run
// rolls back the migration it was in. A lost lock always ends with exit 1,
// even when dbmate itself finished with 0. The child is the dbmate binary
// itself, not the npm wrapper (dist/cli.js runs it with spawnSync and would
// not pass a signal on). SIGINT or SIGTERM before dbmate starts cancels the
// run; the lock release and the closing of the connection are bounded too.
//
//   node scripts/db/migrate-locked.mjs --url <postgres-url>
//
// The URL is never printed. dbmate gets `up --strict` (D-91 (2)).
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { resolveBinary } from "dbmate";

import { connectLockClient } from "../../src/server/db/migration-lock.ts";

/** The one lock key of the Ductus migration runner (a fixed bigint). */
export const LOCK_KEY = "4207120261031";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The dbmate binary for this platform (@dbmate/<platform>-<arch>), not the Node wrapper. */
export function dbmateBinary() {
  return resolveBinary();
}

/** The dbmate argv, program first: always `up --strict`, schema dump off, waiting for the server. */
export function dbmateArgs(url) {
  return [dbmateBinary(), "--url", url, "--no-dump-schema", "--wait", "up", "--strict"];
}

/** Starts dbmate as the runner's direct child, so a signal sent to the child reaches dbmate. */
export function startDbmate(url, options = {}) {
  const [file, ...args] = dbmateArgs(url);
  return spawn(file, args, { cwd: ROOT, stdio: "inherit", windowsHide: true, ...options });
}

/** Resolves to true when `promise` fulfils within `ms`, false when it rejects or is still pending. */
function within(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(
      () => true,
      () => false,
    ),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms, false);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Takes the lock on `connect()`'s client, then runs `start()` (a child process)
 * and returns its exit code, or 1 when the lock was not taken or was lost, the
 * release did not finish in time, or `signal` cancelled the run.
 */
export async function runLocked({ connect, start, signal, heartbeatMs = 5000, lockTimeoutMs = 600_000, killGraceMs = 10_000, log = console.error }) {
  if (signal?.aborted) {
    log("Migration run cancelled before dbmate started.");
    return 1;
  }
  let client;
  try {
    client = await connect();
  } catch {
    log(signal?.aborted ? "Migration run cancelled before dbmate started." : "Migration lock: could not open the lock connection.");
    return 1;
  }
  let failed = false;
  let done = false;
  let child = null;
  let exited = false;
  const stopChild = () => {
    if (!child || exited) return;
    child.kill("SIGTERM");
    setTimeout(() => !exited && child.kill("SIGKILL"), killGraceMs).unref?.();
  };
  const lose = (why) => {
    if (failed || done) return;
    failed = true;
    log(`Migration lock lost (${why}); stopping dbmate.`);
    stopChild();
  };
  // Cancelling while the lock is awaited ends the connection, which fails the
  // pending pg_advisory_lock; once dbmate runs, it is stopped like on a loss.
  const cancel = () => {
    if (failed || done) return;
    failed = true;
    log(child ? "Migration run cancelled; stopping dbmate." : "Migration run cancelled before dbmate started.");
    if (child) stopChild();
    else client.end().catch(() => {});
  };
  client.on("error", () => lose("connection error"));
  client.on("end", () => lose("connection closed"));
  signal?.addEventListener("abort", cancel, { once: true });
  const finish = async () => {
    done = true;
    signal?.removeEventListener("abort", cancel);
    // The session is gone either way once the process exits; the server then
    // releases the lock with it.
    await within(client.end(), killGraceMs);
  };

  try {
    await client.query(`SET lock_timeout = ${Math.max(1, Math.trunc(Number(lockTimeoutMs)))}`);
    await client.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [LOCK_KEY]);
  } catch {
    if (!failed) log("Migration lock: could not take the lock (another run holds it, or the server refused).");
    await finish();
    return 1;
  }
  if (failed) {
    await finish();
    return 1;
  }

  child = start();
  let pending = null;
  const timer = setInterval(() => {
    if (pending) {
      if (Date.now() - pending > heartbeatMs * 3) lose("heartbeat timed out");
      return;
    }
    pending = Date.now();
    client.query("SELECT 1").then(
      () => {
        pending = null;
      },
      () => lose("heartbeat failed"),
    );
  }, heartbeatMs);
  const code = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  exited = true;
  clearInterval(timer);
  if (failed) {
    await finish();
    return 1;
  }
  // A connection that hangs now would hang the release; it gets the same
  // bound as a heartbeat, and a release that does not finish fails the run.
  const released = await within(client.query("SELECT pg_catalog.pg_advisory_unlock($1::bigint)", [LOCK_KEY]), heartbeatMs * 3);
  if (!released && !failed) {
    failed = true;
    log("Migration lock: the release did not finish (connection lost or hung).");
  }
  await finish();
  if (failed) return 1;
  return code === 0 ? 0 : code || 1;
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--url" || !argv[1]) {
    console.error("usage: migrate-locked.mjs --url <postgres-url>");
    return 1;
  }
  const url = argv[1];
  const controller = new AbortController();
  let child = null;
  // Before dbmate starts, a signal cancels the run (the runner must not start
  // migrations later); afterwards it goes to dbmate.
  const forward = (signal) => (child ? child.kill(signal) : controller.abort());
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  return runLocked({
    connect: () => connectLockClient(url, { signal: controller.signal }),
    signal: controller.signal,
    start: () => {
      child = startDbmate(url);
      return child;
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
