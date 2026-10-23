import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { expect, it } from "vitest";

it("qa606web1: independent native report and CLI adversarial probes", () => {
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "tests/fixtures/qa606-metrics/probes.mjs"], {
    cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8", timeout: 180_000,
  });
  console.log(run.stdout);
  console.error(run.stderr);
  expect(run.error).toBeUndefined();
  expect(run.status, run.stdout + run.stderr).toBe(0);
}, 190_000);
