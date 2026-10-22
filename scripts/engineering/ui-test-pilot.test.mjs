import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { classifyUiDiff, uiPlan, compareReport, runPilot, UI_PATH, UI_SPECS } from "./ui-test-pilot.mjs";

const root = resolve(import.meta.dirname, "../..");
const record = (path = UI_PATH, modes = "100644 100644", status = "M") =>
  `:${modes} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\0${path}\0`;
const candidate = classifyUiDiff(record());
const options = { cwd: root };
function report() {
  const specs = [...UI_SPECS, "e2e/auth.spec.ts"].map((file, i) => ({ file: file.slice(4), id: `test-${i}`,
    tests: ["desktop", "mobile"].map((projectName) => ({ projectName, expectedStatus: "passed", status: "expected",
      results: [{ status: "passed", duration: 10 }] })) }));
  return { config: { rootDir: join(root, "e2e"), projects: ["desktop", "mobile", "firefox", "webkit"] },
    suites: [{ specs: [], suites: [{ specs }] }], errors: [],
    stats: { expected: 12, unexpected: 0, flaky: 0, skipped: 0, duration: 80 } };
}
const specs = (r) => r.suites[0].suites[0].specs;
function fail(r, index = 5, project = 1) {
  const t = specs(r)[index].tests[project];
  t.status = "unexpected"; t.results[0].status = "failed";
  r.stats.expected--; r.stats.unexpected++;
}

test("only an ordinary modification of the exact CSS path is a candidate", () => {
  assert.equal(candidate.selection, "candidate");
  assert.deepEqual(candidate.specs, UI_SPECS);
  for (const path of ["app/page.tsx", "src/components/landing/Landing.tsx", "app/globals.css", "README.md",
    "./" + UI_PATH, UI_PATH + "\nother", "src/lib/auth.ts", "$(touch marker)"]) {
    assert.equal(classifyUiDiff(record() + record(path)).selection, "full", path);
  }
  for (const [modes, status] of [["000000 100644", "A"], ["100644 000000", "D"],
    ["100644 100755", "M"], ["100644 120000", "T"], ["100644 160000", "T"], ["100644 100644", "R100"]]) {
    assert.equal(classifyUiDiff(record(UI_PATH, modes, status)).selection, "full");
  }
  for (const raw of ["", "broken", record().slice(0, -1), record() + ":unfinished\0", ":bad\0path\0"]) {
    assert.equal(classifyUiDiff(raw).selection, "full");
  }
});

test("immutable real Git diff, rename, external diff and missing evidence stay conservative", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "ductus-ui-pilot-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet"); git("config", "user.name", "Synthetic fixture"); git("config", "user.email", "ci@example.invalid");
  mkdirSync(dirname(join(cwd, UI_PATH)), { recursive: true });
  writeFileSync(join(cwd, UI_PATH), "before\n"); git("add", "--", UI_PATH); git("commit", "-qm", "fixture base");
  const baseSha = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, UI_PATH), "after\n"); git("add", "--", UI_PATH); git("commit", "-qm", "fixture change");
  const input = { eventName: "pull_request", baseRef: "main", baseSha, headSha: git("rev-parse", "HEAD"), cwd };
  git("config", "diff.external", "this-command-must-not-run");
  assert.equal(uiPlan(input).selection, "candidate");
  for (const eventName of ["push", "schedule", "", undefined]) assert.equal(uiPlan({ ...input, eventName }).selection, "full");
  assert.equal(uiPlan({ ...input, baseRef: "feature" }).selection, "full");
  for (const headSha of [baseSha, "f".repeat(40), "--output=bad", "a".repeat(39), undefined]) {
    assert.equal(uiPlan({ ...input, headSha }).selection, "full");
  }
  git("mv", UI_PATH, UI_PATH + ".renamed"); git("commit", "-qm", "fixture rename");
  assert.equal(uiPlan({ ...input, headSha: git("rev-parse", "HEAD") }).selection, "full");
});

test("native JSON paths and nested suites count test/browser instances, not config projects", () => {
  const actual = compareReport(candidate, report(), options);
  assert.equal(actual.comparison, "no-miss-observed");
  assert.equal(actual.full.count, 12); assert.equal(actual.selected.count, 10); assert.equal(actual.excluded.count, 2);
  assert.equal(actual.selected.testWorkMs, 100); assert.equal(actual.fullRunDurationMs, 80);
  assert.deepEqual(actual.byProject.map((p) => [p.project, p.selected.count]), [["desktop", 5], ["mobile", 5]]);
  const fallback = compareReport(classifyUiDiff(record("app/page.tsx")), report(), options);
  assert.equal(fallback.comparison, "not-applicable"); assert.equal(fallback.selected.count, 12);
  assert.equal(fallback.candidateInventory.count, 10);
});

test("a mobile-only excluded failure is a miss; selected failures remain visible", () => {
  const r = report(); fail(r);
  let actual = compareReport(candidate, r, options);
  assert.equal(actual.comparison, "miss-observed"); assert.deepEqual(actual.missed, ["test-5/mobile"]);
  assert.equal(actual.complete, true); assert.equal(actual.excluded.failures, 1);
  specs(r)[0].tests[0].results = [];
  actual = compareReport(candidate, r, options);
  assert.equal(actual.comparison, "miss-observed"); assert.equal(actual.complete, false);
  const selected = report(); fail(selected, 0);
  actual = compareReport(candidate, selected, options);
  assert.equal(actual.comparison, "no-miss-observed"); assert.equal(actual.selected.failures, 1);
});

test("missing, corrupt, partial, skipped, interrupted or inconsistent reports never validate selection", () => {
  for (const change of [
    (r) => { r.errors.push({ message: "synthetic global error" }); },
    (r) => { r.stats.expected--; },
    (r) => { specs(r)[0].tests[0].results = []; },
    (r) => { specs(r)[0].tests[0].results[0].status = "interrupted"; },
    (r) => { specs(r)[0].tests[0].results[0].duration = -1; },
    (r) => { specs(r)[0].tests[0].status = "unknown"; },
    (r) => { specs(r)[0].tests[0].results.push({ status: "passed", duration: 1 }); },
    (r) => { specs(r)[0].tests[0].results[0].status = "skipped"; },
    (r) => { specs(r)[0].file = "../../outside.spec.ts"; },
    (r) => { specs(r)[0].file = "login/login.spec.ts"; },
    (r) => { r.config.rootDir = "/different/e2e"; },
    (r) => { specs(r).push(specs(r)[0]); r.stats.expected += 2; },
    (r) => { for (const s of specs(r)) s.tests.pop(); r.stats.expected = 6; },
    (r) => { specs(r)[0].tests.pop(); r.stats.expected--; },
  ]) {
    const r = report(); change(r);
    assert.equal(compareReport(candidate, r, options).comparison, "inconclusive", change.toString());
  }
  for (const r of [null, {}, { suites: [] }]) assert.equal(compareReport(candidate, r, options).comparison, "inconclusive");
});

test("CLI records inconclusive for missing/corrupt reports without masking the runtime outcome", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "ductus-ui-report-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { EVENT_NAME: "pull_request", GITHUB_STEP_SUMMARY: join(cwd, "summary.md") };
  for (const content of [null, "{invalid"]) {
    if (content !== null) { mkdirSync(join(cwd, "test-results")); writeFileSync(join(cwd, "test-results/ui-pilot-full.json"), content); }
    assert.equal(runPilot(env, cwd).comparison, "inconclusive");
    const saved = JSON.parse(readFileSync(join(cwd, "playwright-report/ui-test-pilot.json"), "utf8"));
    assert.equal(saved.mode, "shadow"); assert.equal(saved.selection, "full");
  }
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), /not a wall-clock speedup estimate/);
});

test("CI pilot only observes the unfiltered full run and survives E2E failure", () => {
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const config = readFileSync(join(root, "playwright.config.ts"), "utf8");
  const step = ci.split("      - name: UI test selection pilot\n")[1]?.split(/\n(?= {6}- )/)[0];
  assert.ok(step);
  assert.match(step, /if: \$\{\{ needs.scope.outputs.profile == 'full' && !cancelled\(\) \}\}/);
  assert.match(step, /run: node scripts\/engineering\/ui-test-pilot.mjs/);
  assert.doesNotMatch(step, /id:|outputs:|continue-on-error/);
  for (const key of ["PR_BASE", "PR_HEAD", "PR_BASE_REF", "EVENT_NAME"]) assert.match(step, new RegExp(`${key}: \\$\\{\\{ github\\.`));
  assert.match(ci, /persist-credentials: false\n(?: +#.*\n)+ +fetch-depth: 2/);
  const e2e = ci.split("      - name: E2E tests\n")[1].split("      - name: UI test selection pilot")[0];
  assert.match(e2e, /UI_TEST_PILOT: "1"/);
  assert.match(e2e, /pnpm test:e2e\n {10}else\n {12}pnpm test:e2e --project=desktop --project=mobile\n {10}fi/);
  assert.doesNotMatch(e2e, /--grep|--shard|--only-changed|steps\..*outputs/);
  assert.match(config, /\[playwrightConsoleReporter\(process.env\)\], \["html", \{ open: "never" \}\]/);
  assert.match(config, /process.env.UI_TEST_PILOT === "1"\n +\? \[\["json", \{ outputFile: "test-results\/ui-pilot-full.json" \}\]/);
  assert.ok(ci.indexOf("      - name: Upload Playwright report") > ci.indexOf("      - name: UI test selection pilot"));
});
