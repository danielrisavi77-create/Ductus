// K-3 / DAN-88: explicit local operator command, never a server import.
// Uses only a local PostgreSQL socket and a fixed SQL file: by default the one
// of Docker Compose's container; with `--native` (DAN-346) the one of the
// native runner (`pnpm local:up:native`), through its pinned psql.
// No account argument grants "Demo nastavnik"; `demo-teacher-2` grants "Demo
// nastavnica" (K-4d, #655). Any other argument fails before anything runs.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nativePsqlTarget } from "../../db/local/psql-target.mjs";
import { layout, psqlTarget } from "./native/up.mjs";
import { TOOLS, ductusHome, toolDir, treeHash } from "./native/tools.mjs";

export const TEACHER_ACCOUNTS = Object.freeze(["demo-teacher", "demo-teacher-2"]);
export const NATIVE_FLAG = "--native";

const PSQL_OPTIONS = ["-X", "-q", "-v", "ON_ERROR_STOP=1"];
// psql reads these as well; the native target keeps none but its own PSQLRC.
const PSQL_STEERING = /^PSQL/i;

/** The psql arguments for the one fixed teacher named by `argv`, or null for anything else. */
export function psqlArgs(argv) {
  if (argv.length > 1) return null;
  const account = argv[0] ?? "demo-teacher";
  if (!TEACHER_ACCOUNTS.includes(account)) return null;
  return ["compose", "exec", "-T", "postgres", "psql", ...PSQL_OPTIONS,
    "-v", `account=${account}`, "-U", "ductus", "-d", "ductus"];
}

/** `[--native] [demo-teacher-2]`: the target and the account, or null for anything else. */
export function parseProvisionArgs(argv) {
  const native = argv[0] === NATIVE_FLAG;
  const rest = native ? argv.slice(1) : argv;
  if (rest.includes(NATIVE_FLAG) || psqlArgs(rest) === null) return null;
  return { native, account: rest[0] ?? "demo-teacher" };
}

/**
 * The native runner's psql on its local socket, for `account`. The pinned
 * PostgreSQL folder must be there and match its tree hash; nothing is
 * downloaded. Throws when it cannot be used.
 */
export async function nativeCommand(account, env, { platform = process.platform, exists = existsSync, hash = treeHash } = {}) {
  if (platform !== "win32") throw new Error("--native runs only on Windows, as the native runner does");
  const home = ductusHome(env);
  const dir = toolDir(home, "postgres");
  if (!exists(dir) || (await hash(dir)) !== TOOLS.postgres.tree) {
    throw new Error("the native PostgreSQL folder is missing or changed; start pnpm local:up:native first");
  }
  const paths = layout(home);
  const target = nativePsqlTarget(psqlTarget(join(dir, "bin"), paths.socket), env);
  const kept = Object.fromEntries(Object.entries(target.env).filter(([name]) => !PSQL_STEERING.test(name)));
  return {
    command: target.command,
    args: [...target.args, ...PSQL_OPTIONS, "-v", `account=${account}`],
    env: { ...kept, PSQLRC: paths.psqlrc },
  };
}

/** Runs the provision for `argv`; returns the exit code. Every dependency is injectable for tests. */
export async function provision(argv, {
  env = process.env, platform = process.platform, spawn = spawnSync, exists = existsSync, hash = treeHash,
  log = console.log, error = console.error,
} = {}) {
  const parsed = parseProvisionArgs(argv);
  if (!parsed) {
    error(`Teacher provision accepts no argument or one of: ${TEACHER_ACCOUNTS.slice(1).join(", ")}; ${NATIVE_FLAG} may come first.`);
    return 1;
  }
  let command = "docker";
  // Without --native the arguments are exactly the Docker ones of before.
  let args = parsed.native ? [] : psqlArgs(argv);
  let childEnv;
  if (parsed.native) {
    try {
      ({ command, args, env: childEnv } = await nativeCommand(parsed.account, env, { platform, exists, hash }));
    } catch (failure) {
      error(`Teacher provision refused: ${failure.message}.`);
      return 1;
    }
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sql = readFileSync(new URL("../../db/local/provision-demo-teacher.sql", import.meta.url), "utf8");
  const result = spawn(command, args, {
    cwd: root,
    input: sql,
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
    ...(childEnv ? { env: childEnv } : {}),
  });
  if (result.error || result.status !== 0) {
    // No credentials or SQL text are echoed. Manual follow-up: confirm the
    // local stack is running and the synthetic teacher has signed in once.
    error(parsed.native
      ? "Teacher provision failed: native database or identity prerequisite unavailable."
      : "Teacher provision failed: local compose/identity prerequisite unavailable.");
    return 1;
  }
  log("Local synthetic teacher role confirmed (or already confirmed).");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  provision(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
