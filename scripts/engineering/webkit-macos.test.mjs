import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { classify, exitCode, KNOWN_FAILURES, KNOWN_ISSUE, playwrightArgs, reportedTests, summary } from "./webkit-macos.mjs";

// DAN-114 (#1040): the advisory WebKit job on a macOS runner.
const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const workflow = await read(".github/workflows/webkit-macos.yml");
const JOB = "WebKit E2E (macOS)";

test("the job runs on macOS, read-only, without secrets and without a soft failure", () => {
  assert.match(workflow, /^ {4}name: WebKit E2E \(macOS\)$/m);
  assert.match(workflow, /^ {4}runs-on: macos-latest$/m);
  assert.match(workflow, /^permissions:\n {2}contents: read\n\n/m);
  assert.equal(workflow.match(/permissions:/g).length, 1);
  assert.doesNotMatch(workflow, /secrets\.|pull_request_target|continue-on-error|workflow_run/);
  assert.match(workflow, /^ {6}- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}persist-credentials: false$/m);
  for (const [, ref] of workflow.matchAll(/uses: ([^\s#]+)/g)) assert.match(ref, /@[0-9a-f]{40}$/, ref);
});

test("the job runs the whole webkit project through the script against the build", () => {
  assert.match(workflow, /^ {6}- run: pnpm build$/m);
  assert.match(workflow, /^ {8}run: pnpm exec playwright install webkit$/m);
  assert.match(workflow, /^ {10}E2E_NO_BUILD: "1"\n {8}run: node scripts\/engineering\/webkit-macos\.mjs$/m);
});

test("it is advisory: neither branch protection's list nor Mergify names it", async () => {
  const engineering = await read("docs/ENGINEERING_SYSTEM.md");
  const required = engineering.split("- obvezni statusi:\n")[1]?.split("\n- merge metoda")[0] ?? "";
  assert.ok(required.includes("`Engineering review gate`"), "the required list is where it was");
  assert.ok(!required.includes(JOB));
  assert.ok(!(await read(".github/mergify.yml")).includes(JOB));
});

test("it runs on main, nightly, by hand, and on a pull request only for its own files", () => {
  const on = workflow.match(/^on:\n((?: {2}.+\n)+)/m)?.[1] ?? "";
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"$/m);
  assert.match(on, /^ {2}workflow_dispatch:$/m);
  assert.match(on, /^ {2}pull_request:\n {4}paths:\n/m);
  for (const path of [".github/workflows/webkit-macos.yml", "scripts/engineering/webkit-macos.mjs", "playwright.config.ts"]) {
    assert.ok(on.includes(`      - "${path}"\n`), path);
  }
});

test("every known failure names a test that exists, once, and the issue that tracks it", async () => {
  assert.equal(KNOWN_ISSUE, 1046);
  const keys = KNOWN_FAILURES.map(({ file, title }) => `${file}|${title}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const { file, title } of KNOWN_FAILURES) {
    assert.match(file, /^e2e\/[\w-]+\.spec\.ts$/, file);
    const source = await read(file);
    // The summary names a listed test that did not run; this catches a rename earlier.
    assert.ok(source.includes(title), title);
  }
});

test("nothing is left out: the whole project runs and the exit code is Playwright's", async () => {
  const args = playwrightArgs();
  assert.ok(args.includes("--project=webkit"));
  for (const arg of args) {
    assert.doesNotMatch(arg, /^--(grep|grep-invert|pass-with-no-tests|last-failed|only-changed|shard)\b/, arg);
  }
  const source = await read("scripts/engineering/webkit-macos.mjs");
  assert.doesNotMatch(source, /grep-invert|"--grep"|\.skip\(|\.fixme\(|\.fail\(/);
  assert.doesNotMatch(workflow, /--grep|--shard|\.skip\(/);
  assert.equal(exitCode(0), 0);
  for (const status of [1, 2, 130]) assert.equal(exitCode(status), status);
  assert.equal(exitCode(null), 1, "a killed run is red");
});

const spec = (title, ...statuses) => ({ title, file: "a.spec.ts", tests: statuses.map((status) => ({ status })) });
const report = (specs) => ({ suites: [{ file: "a.spec.ts", specs: [], suites: [{ specs }] }] });

test("the summary splits failures into tracked and new and names listed tests that passed or did not run", () => {
  const list = ["known", "fixed", "gone"].map((title) => ({ file: "e2e/a.spec.ts", title }));
  const tests = reportedTests(
    report([spec("known", "unexpected"), spec("fixed", "expected"), spec("new", "unexpected"), spec("ok", "expected", "flaky")]),
  );
  assert.equal(tests.length, 5, "one entry per test of a spec");
  const result = classify(tests, list);
  assert.deepEqual(result, {
    known: ["e2e/a.spec.ts › known"],
    fresh: ["e2e/a.spec.ts › new"],
    fixed: ["e2e/a.spec.ts › fixed"],
    missing: ["e2e/a.spec.ts › gone"],
  });
  const text = summary(result);
  assert.ok(text.includes("**New failures** (1), not tracked in #1046:\n- e2e/a.spec.ts › new\n"));
  assert.ok(text.includes("Known failures (1), tracked in #1046:\n- e2e/a.spec.ts › known\n"));
  assert.ok(text.includes("take them off KNOWN_FAILURES:\n- e2e/a.spec.ts › fixed\n"));
  assert.ok(text.includes("did not run (renamed or removed?):\n- e2e/a.spec.ts › gone\n"));
  assert.match(summary(classify(reportedTests(report([spec("ok", "expected")])), [])), /No failures\.$/);
});
