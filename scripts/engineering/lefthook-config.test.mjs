// DAN-432: the git hooks get faster only by running the pre-push checks side by
// side. Every check stays, with the same command, and each one still blocks.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lefthook = path.join(root, "node_modules/lefthook/bin/index.js");
// Git and lefthook variables from a surrounding hook (GIT_DIR, LEFTHOOK=0)
// would point the fixture elsewhere or skip the run.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|LEFTHOOK)/.test(key)));
const git = (dir, ...args) =>
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: dir, env, stdio: "pipe" });

function repo(t, config) {
  const dir = mkdtempSync(path.join(tmpdir(), "ductus-lefthook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  if (config) writeFileSync(path.join(dir, "lefthook.yml"), config);
  else copyFileSync(path.join(root, "lefthook.yml"), path.join(dir, "lefthook.yml"));
  return dir;
}

// The merged config as lefthook reads it, from a copy of lefthook.yml alone,
// so a developer's lefthook-local.yml cannot change the answer.
function dump(t) {
  const dir = repo(t);
  return JSON.parse(execFileSync(process.execPath, [lefthook, "dump", "--format", "json"], { cwd: dir, env, encoding: "utf8" }));
}

const secrets = (run) => run.includes("gitleaks stdin") && run.includes("ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:") && /\n\s*exit 1\n/.test(run);

// One row per check: the hook, the check, its exact keys, and what its command must be.
const CHECKS = [
  ["pre-commit", "lint", ["env", "glob", "run"], (run) => run === "pnpm exec eslint {staged_files}"],
  ["pre-commit", "secrets", ["run"], secrets],
  ["pre-push", "lint", ["env", "run"], (run) => run === "pnpm lint"],
  ["pre-push", "typecheck", ["env", "run"], (run) => run === "pnpm typecheck"],
  ["pre-push", "test", ["env", "run", "use_stdin"], (run) => run === "node scripts/engineering/pre-push-tests.mjs"],
];

test("DAN-432: every check stays, with its command and no skip", (t) => {
  const config = dump(t);
  assert.deepEqual(Object.keys(config).sort(), ["pre-commit", "pre-push"]);
  for (const hook of ["pre-commit", "pre-push"]) {
    assert.deepEqual(Object.keys(config[hook]).sort(), ["commands", "parallel"], hook);
    assert.deepEqual(
      Object.keys(config[hook].commands).sort(),
      CHECKS.filter(([h]) => h === hook).map(([, name]) => name).sort(),
      hook,
    );
  }
  for (const [hook, name, keys, runOk] of CHECKS) {
    const command = config[hook].commands[name];
    assert.deepEqual(Object.keys(command).sort(), keys, `${hook} ${name}`);
    assert.ok(runOk(command.run), `${hook} ${name}: ${command.run.slice(0, 80)}`);
    if (command.env) assert.deepEqual(command.env, { CI: "true" }, `${hook} ${name}`);
  }
  assert.equal(config["pre-push"].commands.test.use_stdin, true);
});

test("DAN-432: both hooks run their checks in parallel", (t) => {
  const config = dump(t);
  assert.equal(config["pre-commit"].parallel, true);
  assert.equal(config["pre-push"].parallel, true);
});

// The real pre-push entry with each command replaced by a stub. Every stub
// waits until all three have started, so a sequential run fails here.
const STUB = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const [name, names] = [process.argv[2], process.argv[3].split(",")];
const input = process.env.READ_STDIN === name ? readFileSync(0, "utf8") : "";
writeFileSync(name + ".started", "");
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let waited = 0; !names.every((other) => existsSync(other + ".started")); waited += 20) {
  if (waited > 15000) process.exit(3);
  Atomics.wait(pause, 0, 0, 20);
}
appendFileSync("ran.jsonl", JSON.stringify({ name, input, ci: process.env.CI }) + "\\n");
process.exit(process.env.FAIL === name ? 1 : 0);
`;

function prePushFixture(t) {
  const prePush = structuredClone(dump(t)["pre-push"]);
  const names = Object.keys(prePush.commands);
  for (const name of names) prePush.commands[name].run = `node stub.mjs ${name} ${names.join(",")}`;
  // JSON is valid YAML, and lefthook reads it as lefthook.yml.
  const dir = repo(t, JSON.stringify({ "pre-push": prePush }));
  writeFileSync(path.join(dir, "stub.mjs"), STUB);
  git(dir, "add", "lefthook.yml", "stub.mjs");
  git(dir, "commit", "-qm", "fixture");
  return { dir, names };
}

const refs = "refs/heads/feature 1111111111111111111111111111111111111111 refs/heads/feature 0000000000000000000000000000000000000000\n";
const runPrePush = (dir, fail) =>
  spawnSync(process.execPath, [lefthook, "run", "pre-push"], {
    cwd: dir,
    input: refs,
    encoding: "utf8",
    env: { ...env, FAIL: fail, READ_STDIN: "test", NO_COLOR: "1" },
    timeout: 60_000,
  });

test("DAN-432: the parallel pre-push runs all checks and gives the pushed refs to the test check", (t) => {
  const { dir, names } = prePushFixture(t);
  const result = runPrePush(dir, "");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const ran = readFileSync(path.join(dir, "ran.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(ran.map((entry) => entry.name).sort(), [...names].sort());
  assert.equal(ran.find((entry) => entry.name === "test").input, refs);
  for (const entry of ran) assert.equal(entry.ci, "true", entry.name);
});

for (const check of ["lint", "typecheck", "test"]) {
  test(`DAN-432: a failing ${check} still blocks the push`, (t) => {
    const { dir } = prePushFixture(t);
    const result = runPrePush(dir, check);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes("exit status 3"), "a stub waited in vain: the checks did not run side by side");
  });
}
