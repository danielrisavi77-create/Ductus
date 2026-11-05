import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planLoginProjects, LOGIN_SHARDS } from "./login-shard-plan.mjs";
import { verifyLoginShards } from "./login-shards.mjs";

test("DAN-232: WebKit includes the original demo-flow acceptance", () => {
  const specs = JSON.parse(readFileSync(new URL("./login-webkit-specs.json", import.meta.url), "utf8"));
  assert.ok(specs.includes("login.spec.ts"));
  assert.ok(specs.includes("demo-flow.spec.ts"), "WebKit must execute the original #1223 walk-through");
});

test("the real Playwright config selects the full WebKit demo-flow and plans it alone", { timeout: 150_000 }, () => {
  const env = { ...process.env };
  for (const name of ["E2E_REUSE_SERVER", "LOGIN_E2E_JSON", "PLAYWRIGHT_JSON_OUTPUT_FILE", "PLAYWRIGHT_JSON_OUTPUT_NAME"]) delete env[name];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/@playwright/test/cli.js", import.meta.url)),
    "test", "--config", "playwright.login.config.ts", "--list", "--reporter=json"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env, encoding: "utf8", timeout: 120_000, windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const plan = planLoginProjects(report, weights);
  assert.deepEqual(plan.at(-1), { project: "login-webkit", files: ["demo-flow.spec.ts", "login.spec.ts"] });
});

const inventory = () => ({ suites: [
  ...Array.from({ length: 8 }, (_, i) => ({ specs: [{ file: `c${i}.spec.ts`, title: "runs", tests: [{ projectName: "login-chromium" }] }] })),
  ...["demo-flow.spec.ts", "login.spec.ts"].map((file) => ({ specs: [{ file, title: "runs", tests: [
    { projectName: "login-chromium" }, { projectName: "login-webkit" },
  ] }] })),
] });
const weights = { "demo-flow.spec.ts": 125, "login.spec.ts": 8 };
function shards() {
  const inv = inventory();
  return planLoginProjects(inv, weights).map((plan, i) => ({
    inventory: inv, shardPlan: { shard: i + 1, total: LOGIN_SHARDS, ...plan },
    report: { suites: inv.suites.map((suite) => ({ specs: suite.specs
      .filter((spec) => plan.files.includes(spec.file))
      .map((spec) => ({ ...spec, tests: spec.tests.filter((t) => t.projectName === plan.project)
        .map((t) => ({ ...t, status: "expected", results: [{ status: "passed" }] })) })) })) },
  }));
}

test("engines have separate databases within six runners, with no lost Chromium file", () => {
  const plan = planLoginProjects(inventory(), weights);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.at(-1), { project: "login-webkit", files: ["demo-flow.spec.ts", "login.spec.ts"] });
  assert.ok(plan.slice(0, -1).every((s) => s.project === "login-chromium"));
  assert.deepEqual(plan.slice(0, -1).flatMap((s) => s.files).sort(), [
    ...Array.from({ length: 8 }, (_, i) => `c${i}.spec.ts`), "demo-flow.spec.ts", "login.spec.ts",
  ].sort());
  assert.equal(verifyLoginShards(shards(), weights).count, 12);
});

test("wrong engine on a planned file and missing WebKit execution fail reconciliation", () => {
  const mixed = shards();
  mixed[0].report.suites.find((s) => s.specs.length).specs[0].tests[0].projectName = "login-webkit";
  assert.throws(() => verifyLoginShards(mixed, weights), /project outside its plan/);
  const missing = shards();
  missing.at(-1).report.suites = [];
  assert.throws(() => verifyLoginShards(missing, weights), /Listed but never run/);
  const skipped = shards();
  skipped.at(-1).report.suites.find((s) => s.specs[0]?.file === "demo-flow.spec.ts").specs[0].tests[0].status = "skipped";
  assert.throws(() => verifyLoginShards(skipped, weights), /must execute, not skip/);
  const unknown = inventory();
  unknown.suites[0].specs[0].tests[0].projectName = "injected";
  assert.throws(() => planLoginProjects(unknown, weights), /Unexpected login project/);
});
