import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LOGIN_SHARDS } from "./login-shard-plan.mjs";
import { E2E_PROJECTS } from "./ui-test-pilot.mjs";

// Guards .github/workflows/ci.yml: runs on main are never cancelled (D-108 d),
// and every run, pull requests included, runs all three engines (M0.3).
const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const playwright = await readFile(new URL("../../playwright.config.ts", import.meta.url), "utf8");
const shardsScript = await readFile(new URL("./e2e-shards.mjs", import.meta.url), "utf8");
const pilotScript = await readFile(new URL("./ui-test-pilot.mjs", import.meta.url), "utf8");

function step(name, job = "stack-e2e") {
  const block = ci.split(`\n  ${job}:\n`)[1]?.split(/^ {2}[\w-]+:\n/m)[0] ?? "";
  const start = block.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `step "${name}" exists`);
  const rest = block.slice(start + 1);
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

test("every run, pull requests included, installs all three engines and runs every project (M0.3)", () => {
  const install = step("Install browsers");
  const inventory = step("UI pilot expected test inventory");
  const e2e = step("E2E tests");
  for (const s of [install, inventory, e2e]) {
    // Only the trusted docs classification can exempt a PR; main/nightly
    // always produce full (ci-docs-scope.test.mjs also attacks the job guard).
    assert.match(s, /^ {8}if: success\(\) && !cancelled\(\) && needs\.scope\.outputs\.profile == 'full'$/m);
    // No branch by event, no project filter, no softened failure.
    assert.doesNotMatch(s, /event_name|ALL_ENGINES|--project|--grep|--retries|--last-failed|continue-on-error|\|\| true/);
  }
  assert.match(install, /^ {8}run: bash scripts\/engineering\/playwright-install\.sh chromium firefox webkit$/m);
  assert.match(inventory, /^ {10}pnpm exec playwright test --list --reporter=json$/m);
  assert.match(e2e, /^ {8}run: pnpm test:e2e --shard="\$E2E_SHARD\/3"$/m);
  // The browser cache key no longer depends on the event either.
  assert.match(step("Restore Playwright browsers"), /^ {10}key: pw-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('pnpm-lock\.yaml'\) \}\}-all$/m);
  // Flaky passes are not passes (docs/TESTING.md 2).
  assert.match(playwright, /^ {2}retries: 0,$/m);
});

test("the isolated login job runs the full Chromium suite and preserves both reports", () => {
  assert.match(step("Install login browser", "stack-login"), /^ {8}run: bash scripts\/engineering\/playwright-install\.sh chromium$/m);
  const login = step("Full login E2E", "stack-login");
  // The whole suite, split over the matrix by the duration plan (DAN-375); the
  // inventory job (login-shards.mjs) proves each shard ran its plan and the
  // shards together ran every listed test.
  assert.match(login, /^ {8}run: pnpm test:e2e:login --test-list \.ci-reports\/test-list\.txt$/m);
  assert.doesNotMatch(login, /--shard|--grep|LOGIN_SHARD/);
  const plan = step("Plan login shard", "stack-login");
  assert.match(plan, /^ {8}run: node scripts\/engineering\/login-shard-plan\.mjs "\$LOGIN_SHARD"$/m);
  assert.match(plan, /^ {10}LOGIN_SHARD: \$\{\{ matrix\.shard \}\}$/m);
  assert.match(plan, /^ {8}if: success\(\) && !cancelled\(\) && needs\.scope\.outputs\.profile == 'full'$/m);
  // The plan runs after the full listing and before the run it feeds.
  const order = ["Login E2E inventory", "Plan login shard", "Full login E2E"].map((n) => ci.indexOf(`      - name: ${n}\n`, ci.indexOf("\n  stack-login:\n")));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const shards = Array.from({ length: LOGIN_SHARDS }, (_, i) => i + 1).join(", ");
  assert.match(ci, new RegExp(`^ {2}stack-login:\\n {4}name: Login E2E \\(\\$\\{\\{ matrix\\.shard \\}\\}/${LOGIN_SHARDS}\\)\\n(?: {4}.*\\n)*? {6}matrix:\\n {8}shard: \\[${shards}\\]$`, "m"));
  assert.match(step("Login E2E inventory", "stack-login"), /^ {8}run: pnpm exec playwright test --config playwright\.login\.config\.ts --list --reporter=json$/m);
  assert.match(step("Verify complete login E2E inventory", "stack-login-results"), /^ {8}run: node scripts\/engineering\/login-shards\.mjs$/m);
  assert.match(login, /^ {8}if: success\(\) && !cancelled\(\) && needs\.scope\.outputs\.profile == 'full'$/m);
  assert.doesNotMatch(login, /continue-on-error/);
  for (const [job, label, report] of [
    ["stack-e2e", "Upload Playwright report", "playwright-report"],
    ["stack-login", "Upload login Playwright report", "playwright-report-login"],
  ]) {
    const upload = step(label, job);
    assert.ok(upload.includes(`          name: ${report}-\${{ matrix.shard }}\n`));
    assert.ok(upload.includes(`          path: ${report}/\n`));
    assert.match(upload, /^ {10}retention-days: 14$/m);
  }
});

test("the projects are Chromium desktop and mobile, Firefox and WebKit, and the shard checks expect all four", () => {
  const projects = Object.fromEntries(
    [...playwright.matchAll(/\{ name: "(\w+)", use: \{ \.\.\.devices\["([^"]+)"\] \} \}/g)].map((m) => [m[1], m[2]]),
  );
  assert.equal(projects.desktop, "Desktop Chrome");
  assert.equal(projects.mobile, "Pixel 7");
  assert.equal(projects.firefox, "Desktop Firefox");
  assert.equal(projects.webkit, "Desktop Safari");
  assert.deepEqual(Object.keys(projects), [...E2E_PROJECTS]);
  // Neither shard check may pick the projects by event again.
  for (const script of [shardsScript, pilotScript]) {
    assert.match(script, /projects: E2E_PROJECTS/);
    assert.doesNotMatch(script, /projects: env\.EVENT_NAME/);
  }
});
