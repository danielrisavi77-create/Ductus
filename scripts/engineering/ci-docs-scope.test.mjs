import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classifyDiff, ciProfile } from "./ci-docs-scope.mjs";

const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const full = "needs.scope.outputs.profile == 'full'";
const runtime = `success() && !cancelled() && ${full}`;
const record = (path, modes = "100644 100644", status = "M") =>
  `:${modes} ${"a".repeat(40)} ${"b".repeat(40)} ${status}\0${path}\0`;

function repository(t, files = { "README.md": "before\n" }) {
  const cwd = mkdtempSync(join(tmpdir(), "ductus-ci-scope-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Synthetic CI fixture");
  git("config", "user.email", "ci-fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  const put = (path, value) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
  };
  const commit = (paths) => {
    if (paths.length) git("add", "--", ...paths);
    git("commit", "--quiet", "--message", "Synthetic fixture");
    return git("rev-parse", "HEAD");
  };
  for (const [path, value] of Object.entries(files)) put(path, value);
  const baseSha = commit(Object.keys(files));
  const profile = (headSha) => ciProfile({ eventName: "pull_request", baseRef: "main", baseSha, headSha, cwd });
  return { cwd, git, put, commit, baseSha, profile };
}

test("real git additions, modifications and deletions of allowed docs use docs mode", (t) => {
  const r = repository(t, { "README.md": "before\n", "docs/UX-EVAL.md": "old\n" });
  r.put("README.md", "after\n");
  r.put("docs/privacy/README.md", "new\n");
  rmSync(join(r.cwd, "docs/UX-EVAL.md"));
  assert.equal(r.profile(r.commit(["README.md", "docs/privacy/README.md", "docs/UX-EVAL.md"])), "docs");
});

test("ordinary docs cannot conceal runtime, governance, fixtures or unknown paths", () => {
  for (const path of ["src/ui.ts", "AGENTS.md", "STATE.md", "docs/PRODUCT.md", "docs/DECISIONS.md",
    "docs/ENGINEERING_SYSTEM.md", ".agents/skills/a/SKILL.md", ".github/workflows/ci.yml",
    "tests/fixture.md", "docs/new.md", "docs/design/demo.html", "readme.md", "./README.md",
    "README.md\nother", "docs\\UX-EVAL.md", "README.mdx", "$(touch marker).md"]) {
    assert.equal(classifyDiff(record("README.md") + record(path)), "full", path);
  }
  assert.equal(classifyDiff(record("README.md").repeat(4000) + record("src/ui.ts")), "full");
});

test("real git moves from code to docs and docs to code retain both sides", (t) => {
  for (const [from, to] of [["src/code.ts", "README.md"], ["README.md", "src/code.ts"]]) {
    const r = repository(t, { [from]: "identical content\n" });
    mkdirSync(dirname(join(r.cwd, to)), { recursive: true });
    r.git("mv", "--", from, to);
    assert.equal(r.profile(r.commit([])), "full");
  }
});

test("real git executable, symlink and gitlink docs never use docs mode", (t) => {
  for (const mode of ["100755", "120000", "160000"]) {
    const r = repository(t);
    const object = mode === "160000" ? r.baseSha : r.git("rev-parse", `${r.baseSha}:README.md`);
    r.git("update-index", "--cacheinfo", `${mode},${object},README.md`);
    assert.equal(r.profile(r.commit([])), "full", mode);
  }
});

test("empty, malformed or incomplete evidence never yields docs", () => {
  assert.equal(classifyDiff(""), "full");
  for (const raw of ["truncated", record("README.md").slice(0, -1), ":broken\0README.md\0",
    record("README.md") + ":unfinished\0"]) assert.throws(() => classifyDiff(raw));
  for (const [modes, status] of [["100644 100755", "M"], ["120000 100644", "T"],
    ["100644 100644", "R100"], ["000000 100644", "M"], ["100644 100644", "D"]]) {
    assert.equal(classifyDiff(record("README.md", modes, status)), "full");
  }
});

test("main, nightly, unknown events and untrusted PR bases always run full", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch", "", undefined]) {
    assert.equal(ciProfile({ eventName }), "full");
  }
  for (const baseRef of ["feature/base", "MAIN", "", undefined]) {
    assert.equal(ciProfile({ eventName: "pull_request", baseRef }), "full");
  }
});

test("real git errors, bad SHAs and empty diffs cannot bypass the stack", (t) => {
  const r = repository(t);
  assert.equal(r.profile(r.baseSha), "full");
  for (const headSha of [undefined, "main", "--output=bad", "a".repeat(39), "f".repeat(40)]) {
    assert.throws(() => r.profile(headSha));
  }
  r.put("README.md", "changed\n");
  const headSha = r.commit(["README.md"]);
  assert.throws(() => ciProfile({ eventName: "pull_request", baseRef: "main", baseSha: "main", headSha, cwd: r.cwd }));
  // Repository configuration must not hide a change using an external diff.
  r.git("config", "diff.external", "this-command-must-not-be-executed");
  assert.equal(r.profile(headSha), "docs");
});

function job(name) {
  const marker = `\n  ${name}:\n`;
  const start = ci.indexOf(marker);
  assert.ok(start >= 0, `${name} job exists`);
  return ci.slice(start + marker.length).split(/^ {2}[\w-]+:\n/m)[0];
}

function step(block, name) {
  const start = block.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `${name} step exists`);
  return block.slice(start).split(/\n(?= {6}- )/)[0];
}

function shell(stepText) {
  const source = stepText.split("        run: |\n")[1];
  assert.ok(source, "shell script exists");
  return source.split("\n").filter((line) => line.startsWith("          ")).map((line) => line.slice(10)).join("\n");
}

test("scope uses only protected main and immutable objects with read permissions", () => {
  const scope = job("scope");
  assert.match(scope, /ref: \$\{\{ github.event.pull_request.base.ref == 'main' && github.event.pull_request.base.sha \|\| 'main' \}\}/);
  assert.match(scope, /persist-credentials: false/);
  assert.match(scope, /PR_BASE: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(scope, /PR_BASE_REF: \$\{\{ github.event.pull_request.base.ref \}\}/);
  assert.match(scope, /PR_HEAD: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(scope, /git fetch --no-tags --depth=1 origin "\$PR_HEAD"/);
  assert.doesNotMatch(scope, /pnpm install|pull_request_target|continue-on-error/);
  assert.doesNotMatch(scope, /^ {4}if:/m);
});

test("scope bootstrap and non-PR events select full without running PR code", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "ductus-ci-bootstrap-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const script = shell(step(job("scope"), "Classify immutable diff"));
  for (const [eventName, baseRef] of [["pull_request", "main"], ["pull_request", "feature/base"], ["push", ""], ["schedule", ""]]) {
    const output = join(cwd, `output-${eventName}-${baseRef.replaceAll("/", "-")}`);
    const run = spawnSync("bash", ["-e", "-c", script], { cwd, encoding: "utf8", env: {
      ...process.env, EVENT_NAME: eventName, PR_BASE_REF: baseRef,
      PR_BASE: "a".repeat(40), PR_HEAD: "b".repeat(40), GITHUB_OUTPUT: output,
    } });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(output, "utf8"), "profile=full\n");
    // After bootstrap, even an existing classifier must never execute on a
    // non-main PR base or a non-PR event.
    mkdirSync(join(cwd, "scripts/engineering"), { recursive: true });
    writeFileSync(join(cwd, "scripts/engineering/ci-docs-scope.mjs"), "throw new Error('must not execute');\n");
  }
});

test("required stack accepts only both full successes or both trusted docs skips", () => {
  const stack = job("stack");
  assert.match(stack, /^ {4}name: Local stack \(compose.yaml\)$/m);
  assert.match(stack, /^ {4}needs: \[scope, stack-e2e, stack-login, stack-e2e-results, stack-login-results\]$/m);
  assert.match(stack, /^ {4}if: always\(\)$/m);
  assert.doesNotMatch(stack, /continue-on-error|uses:|pnpm |git /);
  const guard = step(stack, "Validate stack results");
  assert.match(guard, /^ {8}if: always\(\)$/m);
  assert.match(guard, /SCOPE_RESULT: \$\{\{ needs.scope.result \}\}/);
  assert.match(guard, /PROFILE: \$\{\{ needs.scope.outputs.profile \}\}/);
  assert.match(guard, /E2E_RESULT: \$\{\{ needs.stack-e2e.result \}\}/);
  assert.match(guard, /LOGIN_RESULT: \$\{\{ needs.stack-login.result \}\}/);
  assert.match(guard, /EVIDENCE_RESULT: \$\{\{ needs.stack-e2e-results.result \}\}/);
  assert.match(guard, /LOGIN_EVIDENCE_RESULT: \$\{\{ needs.stack-login-results.result \}\}/);
  const script = shell(guard);
  const cases = [
    [true, "success", "full", "success", "success"],
    [true, "success", "docs", "skipped", "skipped"],
  ];
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    cases.push([false, result, "full", "success", "success"]);
    cases.push([false, result, "docs", "skipped", "skipped"]);
    cases.push([false, "success", "full", result, "success"]);
    cases.push([false, "success", "full", "success", result]);
  }
  for (const profile of ["", "unknown", "docs\nfull"]) {
    cases.push([false, "success", profile, "success", "success"]);
  }
  for (const result of ["failure", "cancelled", "success", ""]) {
    cases.push([false, "success", "docs", result, "skipped"]);
    cases.push([false, "success", "docs", "skipped", result]);
  }
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    cases.push([false, "success", "full", "success", "success", result]);
  }
  for (const result of ["failure", "cancelled", "success", ""]) {
    cases.push([false, "success", "docs", "skipped", "skipped", result]);
  }
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    cases.push([false, "success", "full", "success", "success", "success", result]);
  }
  for (const result of ["failure", "cancelled", "success", ""]) {
    cases.push([false, "success", "docs", "skipped", "skipped", "skipped", result]);
  }
  for (const [ok, result, profile, e2e, login, evidence = profile === "docs" ? "skipped" : "success", loginEvidence = profile === "docs" ? "skipped" : "success"] of cases) {
    const run = spawnSync("bash", ["-e", "-c", script], { encoding: "utf8", env: {
      ...process.env, SCOPE_RESULT: result, PROFILE: profile, E2E_RESULT: e2e,
      LOGIN_RESULT: login, EVIDENCE_RESULT: evidence, LOGIN_EVIDENCE_RESULT: loginEvidence,
      GITHUB_STEP_SUMMARY: process.platform === "win32" ? "NUL" : "/dev/null",
    } });
    assert.equal(run.status === 0, ok, `${result}/${profile}/${e2e}/${login}/${evidence}/${loginEvidence}: ${run.stderr}`);
  }
  const reject = step(stack, "Reject cancelled stack");
  assert.match(reject, /^ {8}if: cancelled\(\)$/m);
  assert.equal(spawnSync("bash", ["-c", reject.split("        run: ")[1].trim()]).status, 1);
});

test("both runtime suites are independent, full-only and keep their own setup and cleanup", () => {
  for (const name of ["stack-e2e", "stack-login"]) {
    const stack = job(name);
    assert.match(stack, /^ {4}needs: scope$/m);
    assert.match(stack, /^ {4}runs-on: ubuntu-latest$/m);
    assert.ok(stack.includes(`    if: \${{ !cancelled() && needs.scope.result == 'success' && ${full} }}\n`));
    assert.doesNotMatch(stack, /continue-on-error/);
    for (const command of ["pnpm install --frozen-lockfile", "pnpm stack:up", "pnpm db:migrate", "pnpm local:prepare", "pnpm stack:down"]) {
      assert.ok(stack.includes(`run: ${command}\n`), `${name}: ${command}`);
    }
    assert.match(step(stack, "Local auth login password"), /openssl rand -hex 24/);
    // Every runtime step remains cancellable and needs full scope; cleanup
    // still runs after failure/cancellation, which the required guard rejects.
    for (const block of stack.split(/\n(?= {6}- )/).slice(1)) {
      const condition = block.match(/^(?: {8}| {6}- )if: (.+)$/m)?.[1];
      if (block.startsWith("      - name: Reject cancelled stack")) {
        assert.equal(condition, "cancelled()");
        assert.equal(spawnSync("bash", ["-c", block.split("        run: ")[1].trim()]).status, 1);
        continue;
      }
      const status = block.includes("uses: actions/upload-artifact@") ||
        block.startsWith("      - name: Collect shard evidence\n") ? "!cancelled()"
        : block.includes("run: docker compose logs") ? "failure()"
          : block.includes("run: pnpm stack:down") ? "always()" : null;
      assert.equal(condition, status ? `\${{ ${full} && ${status} }}` : runtime, `${name}: ${block.split("\n")[0]}`);
    }
    assert.ok(stack.includes("      - name: Reject cancelled stack\n"));
    assert.match(stack, /if: \$\{\{ needs.scope.outputs.profile == 'full' && always\(\) \}\}/);
  }
  for (const command of ["pnpm test:db", "pnpm test:integration", "pnpm build"]) {
    assert.ok(job("stack-e2e").includes(`run: ${command}\n`), command);
    assert.ok(!job("stack-login").includes(`run: ${command}\n`), `${command} must not be duplicated`);
  }
});
