import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const RUNTIMES = [".claude", ".agents"];
const skillFile = (runtime: string, name: string) =>
  fileURLToPath(
    new URL(`../../${runtime}/skills/run-ductus/${name}`, import.meta.url),
  );

// The run-ductus skill keeps its port and command guard in a node:test file
// next to the script, outside the vitest include. Run both runtime copies
// here so CI covers them.
test.each(RUNTIMES)("%s run-ductus process-command tests pass", (runtime) => {
  const file = skillFile(runtime, "process-command.test.mjs");
  expect(() =>
    execFileSync(process.execPath, ["--test", file], { stdio: "pipe" }),
  ).not.toThrow();
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

const groupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

// A stand-in pnpm that never answers on the port: the driver stays in its
// ready loop, where an interrupt used to leave the server group running.
test.skipIf(process.platform === "win32").each(RUNTIMES)(
  "%s driver stops the server group when interrupted",
  async (runtime) => {
    const dir = mkdtempSync(join(tmpdir(), "run-ductus-signal-"));
    mkdirSync(join(dir, ".next"));
    const pidFile = join(dir, "server.pid");
    const fakePnpm = join(dir, "pnpm");
    writeFileSync(
      fakePnpm,
      `#!/bin/sh\necho $$ > "${pidFile}"\n"${process.execPath}" -e "setInterval(() => {}, 1000)" &\nwait\n`,
    );
    chmodSync(fakePnpm, 0o755);
    const port = await freePort();
    const driver = spawn(
      process.execPath,
      [
        skillFile(runtime, "driver.mjs"),
        "--port",
        String(port),
        "--skip-build",
      ],
      {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    const exited = new Promise<number | null>((resolve) =>
      driver.once("exit", (code) => resolve(code)),
    );
    for (
      let i = 0;
      !existsSync(pidFile) || !readFileSync(pidFile, "utf8").trim();
      i++
    ) {
      if (i > 100) throw new Error("fake server never started");
      await sleep(50);
    }
    const pgid = Number(readFileSync(pidFile, "utf8").trim());
    try {
      await sleep(300);
      expect(groupAlive(pgid)).toBe(true);
      driver.kill("SIGINT");
      expect(await exited).toBe(130);
      for (let i = 0; groupAlive(pgid) && i < 40; i++) await sleep(50);
      expect(groupAlive(pgid)).toBe(false);
    } finally {
      // Never leave the stand-in running, whatever the assertions found.
      if (groupAlive(pgid)) process.kill(-pgid, "SIGKILL");
    }
  },
  15_000,
);
