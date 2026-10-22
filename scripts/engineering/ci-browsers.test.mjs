import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Guards owner decision D-108 d in .github/workflows/ci.yml: runs on main are
// never cancelled, pull requests run Chromium, main and the nightly run all
// three engines.
const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const playwright = await readFile(new URL("../../playwright.config.ts", import.meta.url), "utf8");

const ALL = `\${{ github.event_name != 'pull_request' }}`;

function step(name) {
  const start = ci.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `step "${name}" exists`);
  const rest = ci.slice(start + 1);
  const next = rest.search(/\n {6}- |\n {2}[\w-]+:\n/);
  return rest.slice(0, next < 0 ? undefined : next);
}

test("only a pull request run cancels an older one; main runs never share a group", () => {
  const block = ci.match(/^concurrency:\n((?: {2}.+\n)+)/m)?.[1];
  assert.ok(block, "top-level concurrency block");
  assert.match(block, /^ {2}group: ci-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}$/m);
  assert.match(block, /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m);
  // no job-level concurrency that could cancel a main run another way
  assert.equal(ci.match(/concurrency:/g).length, 1);
});

test("CI runs on push to main, on pull requests and nightly", () => {
  const on = ci.match(/^on:\n((?: {2}.+\n|\n)+?)(?=^\S)/m)?.[1] ?? "";
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}pull_request:$/m);
  assert.match(on, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"$/m);
});

test("outside a pull request all three engines are installed and every project runs", () => {
  const install = step("Install browsers");
  const e2e = step("E2E tests");
  for (const s of [install, e2e]) {
    assert.ok(s.includes(`          ALL_ENGINES: ${ALL}\n`), "ALL_ENGINES is true for every event but pull_request");
    // Only the trusted docs classification can exempt a PR; main/nightly
    // always produce full (ci-docs-scope.test.mjs also attacks the job guard).
    assert.match(s, /^ {8}if: success\(\) && !cancelled\(\) && needs\.scope\.outputs\.profile == 'full'$/m);
    assert.doesNotMatch(s, /continue-on-error/);
  }
  assert.match(install, /if \[ "\$ALL_ENGINES" = "true" \]; then\n {12}pnpm exec playwright install --with-deps chromium firefox webkit\n {10}else\n {12}pnpm exec playwright install --with-deps chromium\n {10}fi/);
  // all engines: the plain suite with no --project filter, so every project runs
  assert.match(e2e, /if \[ "\$ALL_ENGINES" = "true" \]; then\n {12}pnpm test:e2e\n {10}else\n {12}pnpm test:e2e --project=desktop --project=mobile\n {10}fi/);
});

test("the pull request projects are Chromium and the full run includes Firefox and WebKit", () => {
  const projects = Object.fromEntries(
    [...playwright.matchAll(/\{ name: "(\w+)", use: \{ \.\.\.devices\["([^"]+)"\] \} \}/g)].map((m) => [m[1], m[2]]),
  );
  assert.equal(projects.desktop, "Desktop Chrome");
  assert.equal(projects.mobile, "Pixel 7");
  assert.equal(projects.firefox, "Desktop Firefox");
  assert.equal(projects.webkit, "Desktop Safari");
});
