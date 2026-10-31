// D-91 (3), DAN-71: dbmate does not lock, so two runs against one database
// could apply migrations at the same time. This runner holds a session-level
// pg_advisory_lock on its own connection for the whole dbmate run and stops
// dbmate when that connection is lost (error, close or a heartbeat that fails
// or hangs). dbmate runs each migration in a transaction, so a stopped run
// rolls back the migration it was in. A lost lock always ends with exit 1,
// even when dbmate itself finished with 0.
//
//   node scripts/db/migrate-locked.mjs --url <postgres-url>
//
// The URL is never printed. dbmate gets `up --strict` (D-91 (2)).
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

/** The one lock key of the Ductus migration runner (a fixed bigint). */
export const LOCK_KEY = "4207120261031";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DBMATE = path.join(ROOT, "node_modules", "dbmate", "dist", "cli.js");

/** The dbmate argv: always `up --strict`, schema dump off, waiting for the server. */
export function dbmateArgs(url) {
  return [DBMATE, "--url", url, "--no-dump-schema", "--wait", "up", "--strict"];
}

/**
 * Takes the lock on `connect()`'s client, then runs `start()` (a child process)
 * and returns its exit code, or 1 when the lock was not taken or was lost.
 */
export async function runLocked({ connect, start, heartbeatMs = 5000, lockTimeoutMs = 600_000, killGraceMs = 10_000, log = console.error }) {
  let client;
  try {
    client = await connect();
  } catch {
    log("Migration lock: could not open the lock connection.");
    return 1;
  }
  let lost = false;
  let done = false;
  let child = null;
  const lose = (why) => {
    if (lost || done) return;
    lost = true;
    log(`Migration lock lost (${why}); stopping dbmate.`);
    if (child) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), killGraceMs).unref?.();
    }
  };
  client.on("error", () => lose("connection error"));
  client.on("end", () => lose("connection closed"));
  const finish = async () => {
    done = true;
    try {
      await client.end();
    } catch {
      // The session is gone either way; the server released the lock with it.
    }
  };

  try {
    await client.query(`SET lock_timeout = ${Math.max(1, Math.trunc(Number(lockTimeoutMs)))}`);
    await client.query("SELECT pg_catalog.pg_advisory_lock($1::bigint)", [LOCK_KEY]);
  } catch {
    log("Migration lock: could not take the lock (another run holds it, or the server refused).");
    await finish();
    return 1;
  }
  if (lost) {
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
  clearInterval(timer);
  if (lost) {
    await finish();
    return 1;
  }
  try {
    await client.query("SELECT pg_catalog.pg_advisory_unlock($1::bigint)", [LOCK_KEY]);
  } catch {
    // Ending the session below releases the lock as well.
  }
  await finish();
  return code === 0 ? 0 : code || 1;
}

/** Opens the lock connection, retrying while the server starts (as dbmate --wait does). */
async function connectWithWait(url, { attempts = 60, delayMs = 1000 } = {}) {
  const lockUrl = new URL(url);
  lockUrl.searchParams.delete("role");
  for (let attempt = 1; ; attempt += 1) {
    const client = new pg.Client({ connectionString: lockUrl.href, keepAlive: true, application_name: "ductus-migrate-lock" });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--url" || !argv[1]) {
    console.error("usage: migrate-locked.mjs --url <postgres-url>");
    return 1;
  }
  const url = argv[1];
  let child = null;
  const forward = (signal) => child?.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  return runLocked({
    connect: () => connectWithWait(url),
    start: () => {
      child = spawn(process.execPath, dbmateArgs(url), { cwd: ROOT, stdio: "inherit", windowsHide: true });
      return child;
    },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
