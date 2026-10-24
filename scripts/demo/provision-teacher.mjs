// K-3 / DAN-88: explicit local operator command, never a server import.
// Uses only Docker Compose's local PostgreSQL socket and a fixed SQL file.
// No argument grants "Demo nastavnik"; `demo-teacher-2` grants "Demo
// nastavnica" (K-4d, #655). Any other argument fails before Docker runs.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO_TEACHERS = Object.freeze(["demo-teacher", "demo-teacher-2"]);

/** The psql arguments for the one fixed teacher named by `argv`, or null for anything else. */
export function psqlArgs(argv) {
  if (argv.length > 1) return null;
  const account = argv[0] ?? "demo-teacher";
  if (!DEMO_TEACHERS.includes(account)) return null;
  return ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
    "-v", `account=${account}`, "-U", "ductus", "-d", "ductus"];
}

function main() {
  const args = psqlArgs(process.argv.slice(2));
  if (!args) {
    console.error(`Demo teacher provision accepts no argument or one of: ${DEMO_TEACHERS.slice(1).join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sql = readFileSync(new URL("../../db/local/provision-demo-teacher.sql", import.meta.url), "utf8");
  const result = spawnSync("docker", args, {
    cwd: root,
    input: sql,
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    // No credentials or SQL text are echoed. Manual follow-up: confirm the
    // compose stack is running and the synthetic teacher has signed in once.
    console.error("Demo teacher provision failed: local compose/identity prerequisite unavailable.");
    process.exitCode = 1;
  } else {
    console.log("Local synthetic teacher role confirmed (or already confirmed).");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
