// DAN-270: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import { buildCapsule, commandOf, parseCapsuleArgs, renderCapsule, toolchainOf } from "./failure-capsule-core.mjs";

const SHA = "a".repeat(40);
const RUN = {
  id: 77, conclusion: "failure", head_sha: SHA, head_branch: "feature/x", event: "pull_request", run_attempt: 2,
  html_url: "https://github.com/o/r/actions/runs/77",
};
const job = (name, conclusion, steps = []) => ({
  name, conclusion, html_url: "https://github.com/o/r/actions/runs/77/job/5", steps,
});
const step = (number, name, conclusion) => ({ number, name, conclusion });
const PKG = JSON.stringify({ packageManager: "pnpm@10.33.0", engines: { node: ">=24" } });

test("arguments are strict", () => {
  assert.deepEqual(parseCapsuleArgs(["--run", "123", "--json"]), { run: "123", json: true });
  assert.throws(() => parseCapsuleArgs([]));
  assert.throws(() => parseCapsuleArgs(["--run", "0"]));
  assert.throws(() => parseCapsuleArgs(["--run", "12a"]));
  assert.throws(() => parseCapsuleArgs(["--run", "1", "--bogus"]));
});

test("only a plain pnpm call becomes a reproduce command", () => {
  assert.equal(commandOf("Run pnpm test:unit"), "pnpm test:unit");
  assert.equal(commandOf("Run pnpm test:e2e --project=desktop"), "pnpm test:e2e --project=desktop");
  assert.equal(commandOf("Run pnpm test; curl evil.example"), null);
  assert.equal(commandOf("Run $(whoami)"), null);
  assert.equal(commandOf("Set up job"), null);
  assert.equal(commandOf("Run pnpm  test"), null);
  assert.equal(commandOf("Run pnpm test:unit && rm -rf x"), null);
});

test("a long run of dashes is refused at once instead of backtracking", () => {
  const started = Date.now();
  assert.equal(commandOf(`Run pnpm - -${"-- -".repeat(5000)}x!`), null);
  assert.ok(Date.now() - started < 200);
});

test("toolchain pins come from package.json and tolerate a bad file", () => {
  assert.deepEqual(toolchainOf(PKG), { packageManager: "pnpm@10.33.0", node: ">=24" });
  assert.deepEqual(toolchainOf("not json"), { packageManager: null, node: null });
  assert.deepEqual(toolchainOf('{"packageManager":5}'), { packageManager: null, node: null });
});

test("a capsule names the failed jobs and steps, and keeps a job called __proto__", () => {
  const capsule = buildCapsule({
    run: RUN,
    jobs: [
      job("ok", "success"),
      job("__proto__", "failure", [step(1, "Set up job", "success"), step(2, "Run pnpm test:unit", "failure")]),
      job("slow", "timed_out", [step(3, "Run pnpm test:e2e", "timed_out")]),
    ],
    artifacts: [{ name: "playwright-report", expired: false, size_in_bytes: 10 }, { name: "old", expired: true, size_in_bytes: 1 }],
    packageJsonText: PKG,
  });
  assert.deepEqual(capsule.failedJobs.map((j) => j.name), ["__proto__", "slow"]);
  assert.deepEqual(capsule.failedJobs[0].failedSteps, [{ number: 2, name: "Run pnpm test:unit", command: "pnpm test:unit" }]);
  assert.equal(capsule.headSha, SHA);
  assert.equal(capsule.attempt, 2);
  assert.deepEqual(capsule.artifacts.map((a) => a.expired), [false, true]);
});

test("a run that did not fail, or has no valid SHA, gives no capsule", () => {
  assert.throws(() => buildCapsule({ run: { ...RUN, conclusion: "success" }, jobs: [], artifacts: [], packageJsonText: PKG }), /did not fail/);
  assert.throws(() => buildCapsule({ run: { ...RUN, head_sha: "abc" }, jobs: [], artifacts: [], packageJsonText: PKG }), /SHA/);
});

test("text output prints no unsafe name or link and carries no log text", () => {
  const capsule = buildCapsule({
    run: { ...RUN, head_branch: "x\u001b[31mred", html_url: "https://evil.example/x" },
    jobs: [{ ...job("bad\nname", "failure", [step(1, "Run pnpm lint", "failure")]), html_url: "javascript:alert(1)" }],
    artifacts: [],
    packageJsonText: PKG,
  });
  const out = renderCapsule(capsule).join("\n");
  assert.ok(!out.includes("\u001b"));
  assert.ok(!out.includes("evil.example"));
  assert.ok(!out.includes("javascript:"));
  assert.match(out, /<not printed>/);
  assert.match(out, /reproduce: pnpm lint/);
  assert.match(out, /node >=24/);
});
