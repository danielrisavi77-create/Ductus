import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { checkSelection, KNOWN_FAILURES, KNOWN_ISSUE, knownPattern, listedTests } from "./webkit-macos.mjs";

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

test("the job runs the webkit project through the known-failure script against the build", () => {
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
    // The CI list check proves Playwright selects it; this catches a rename early.
    assert.ok(source.includes(title), title);
  }
});

test("the pattern matches each listed title at the end of a title path and nothing else", () => {
  const pattern = new RegExp(knownPattern());
  for (const { file, title } of KNOWN_FAILURES) {
    assert.ok(pattern.test(`webkit ${file.slice(4)} describe ${title}`), title);
    assert.ok(!pattern.test(`webkit ${file.slice(4)} describe ${title} more`), `${title} is anchored`);
  }
  assert.ok(!pattern.test("webkit quote.spec.ts quote paragraph (E1) a quote keeps its id"));
  assert.ok(!pattern.test("webkit x.spec.ts ' ', Enter and Backspace at the edges of a quote"), "special characters are literal");
  assert.equal(knownPattern([]), null);
});

const report = (specs) => ({ suites: [{ file: "a.spec.ts", specs: [], suites: [{ specs }] }] });

test("the selection check passes only for exactly the listed tests", () => {
  const list = [{ file: "e2e/a.spec.ts", title: "one" }, { file: "e2e/a.spec.ts", title: "two" }];
  const spec = (title, tests = 1) => ({ title, file: "a.spec.ts", tests: Array.from({ length: tests }, () => ({})) });
  assert.deepEqual(checkSelection(listedTests(report([spec("one"), spec("two")])), list), []);
  assert.equal(checkSelection(listedTests(report([spec("one")])), list).length, 1, "one missing");
  assert.equal(checkSelection(listedTests(report([spec("one"), spec("two"), spec("three")])), list).length, 1, "one too many");
  assert.equal(checkSelection(listedTests(report([spec("one", 2), spec("two")])), list).length, 1, "selected twice");
});
