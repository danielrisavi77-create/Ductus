import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

// DAN-517, plan #1826 W-12, W-14: the worker's true entry as a real node
// process, with no database. Every value is invented; the password below is
// a marker that must never reach the output.
const ENTRY = path.resolve(__dirname, "../../scripts/worker/start.mjs");
const SECRET = "synthetic-pass";

type Line = { level: string; event: string; fields?: Record<string, unknown> };

/** The process sees only what the test gives it: a WORKER_* variable of the host changes nothing. */
async function run(env: Record<string, string>) {
  const clean: Record<string, string | undefined> = { PATH: process.env.PATH ?? "", ...env };
  const child = spawn(process.execPath, [ENTRY], { env: clean as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.once("exit", (exit) => resolve(exit)));
  const lines = stderr
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Line);
  return { code, stdout, stderr, lines };
}

describe("worker process: what it does before any job", () => {
  it("with no address it names the variable, exits 1 and says nothing else", async () => {
    const result = await run({});
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.lines.map(({ level, event, fields }) => ({ level, event, fields }))).toEqual([
      { level: "error", event: "worker_environment_invalid", fields: { problems: ["WORKER_DATABASE_URL is not set"] } },
    ]);
  });

  it("every wrong variable is named at once and no value is repeated (W-14)", async () => {
    const result = await run({
      WORKER_DATABASE_URL: `http://synthetic_worker:${SECRET}@db.example/ductus`,
      WORKER_POLL_MS: SECRET,
      WORKER_SWEEP_SECONDS: "0",
    });
    expect(result.code).toBe(1);
    expect(result.lines.map((line) => line.fields)).toEqual([
      { problems: ["WORKER_DATABASE_URL is not a postgres URL", "WORKER_POLL_MS is not a whole number", "WORKER_SWEEP_SECONDS is out of range"] },
    ]);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });

  it("a queue that cannot be reached ends the process with 1 and a closed code only (W-12)", async () => {
    // Port 1 on this machine: nothing listens there.
    const result = await run({ WORKER_DATABASE_URL: `postgres://synthetic_worker:${SECRET}@127.0.0.1:1/ductus` });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.lines.map(({ level, event, fields }) => ({ level, event, fields }))).toEqual([
      { level: "error", event: "worker_start_failed", fields: { code: "queue_unreachable" } },
    ]);
    expect(result.stdout + result.stderr).not.toContain(SECRET);
  });
});
