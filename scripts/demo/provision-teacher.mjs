// K-3 / DAN-88: explicit local operator command, never a server import.
// Uses only Docker Compose's local PostgreSQL socket and a fixed SQL file.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sql = readFileSync(new URL("../../db/local/provision-demo-teacher.sql", import.meta.url), "utf8");
const args = ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "ductus", "-d", "ductus"];
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
