import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

// DAN-587: a real node process with a real http.Server and a real SIGTERM.
// The child closes its server on SIGTERM and exits 0 once it is closed, as the
// Next.js standalone server does; the shutdown signals add the deadline.
const work = mkdtempSync(path.join(tmpdir(), "ductus-shutdown-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const shutdownModule = pathToFileURL(path.resolve(__dirname, "../../src/server/shutdown.ts")).href;
const server = path.join(work, "server.mjs");
writeFileSync(
  server,
  `import { createServer } from "node:http";
import { createShutdownCoordinator, installShutdownSignals } from ${JSON.stringify(shutdownModule)};
const shutdown = createShutdownCoordinator({ graceMs: Number(process.argv[2]) });
const http = createServer((req, res) => {
  const ticket = shutdown.begin("request");
  console.log("accepted");
  if (req.url === "/hang") return;
  setTimeout(() => { res.end("done"); ticket?.release(); }, 300);
});
process.on("SIGTERM", () => http.close(() => process.exit(0)));
installShutdownSignals(process, shutdown, { exit: process.exit, exitWhenDrained: false });
http.listen(0, "127.0.0.1", () => console.log("port " + http.address().port));
`,
);

async function run(url: string, graceMs: number) {
  const child = spawn(process.execPath, [server, String(graceMs)], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const port = await new Promise<number>((resolve) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /port (\d+)/.exec(stdout);
      if (match) resolve(Number(match[1]));
    });
  });
  const answer = new Promise<{ status?: number; body: string } | "aborted">((resolve) => {
    const req = request({ host: "127.0.0.1", port, path: url }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode, body }));
      res.on("error", () => resolve("aborted"));
    });
    req.on("error", () => resolve("aborted"));
    req.end();
  });
  await new Promise<void>((resolve) => {
    const check = () => (stdout.includes("accepted") ? resolve() : setTimeout(check, 10));
    check();
  });
  const signalled = Date.now();
  child.kill("SIGTERM");
  return { code: await exited, answer: await answer, stderr, elapsed: Date.now() - signalled };
}

describe("graceful shutdown of a real process", () => {
  it("K1: a request in flight at SIGTERM is answered and the process exits 0", async () => {
    const result = await run("/slow", 5_000);
    expect(result.answer).toEqual({ status: 200, body: "done" });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.elapsed).toBeLessThan(5_000);
  });

  it("K5: a request that hangs past the deadline ends the process with 1 and a closed code", async () => {
    const result = await run("/hang", 400);
    expect(result.code).toBe(1);
    expect(result.answer).toBe("aborted");
    expect(result.stderr).toContain("SHUTDOWN_DEADLINE");
    expect(result.stderr).toMatch(/request: 1/);
    expect(result.stderr).not.toContain("/hang");
  });
});
