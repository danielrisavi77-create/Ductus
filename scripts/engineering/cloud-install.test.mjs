// DAN-521 (#1516): the cloud SessionStart install hook; F-214 hardening.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_REF, cloudInstall, INSTALL_INPUTS, INSTALL_TIMEOUT_MS, installEnv, isCloud } from "./cloud-install.mjs";
import { packageProblem } from "../hooks/safety-net.mjs";
import { isD97Path } from "./protected-paths.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
const SCRIPT = "${CLAUDE_PROJECT_DIR}/scripts/engineering/cloud-install.mjs";
const MISSING = "cc-safety-net is not installed or incomplete";
const CLOUD = Object.freeze({ CLAUDE_CODE_REMOTE: "true" });
const SAME = Object.freeze({ "package.json": "{}", "pnpm-lock.yaml": "lock", "lefthook.yml": "hooks" });
const INSTALL = ["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"];

/**
 * A fake checkout: `base` is origin/main's files, `local` the working tree.
 * git answers from `base`; every other command records its call and answers
 * from `results` in order.
 */
function checkout({ base = SAME, local = SAME, hasBase = true, results = [] } = {}) {
  const calls = [];
  const gitCalls = [];
  const run = (command, args, options) => {
    if (command === "git") {
      gitCalls.push({ args, env: options.env });
      if (args[0] === "rev-parse") return { status: hasBase ? 0 : 1 };
      const name = args.at(-1).slice(`${BASE_REF}:`.length);
      if (!(name in base)) return { status: 128 };
      return args[1] === "-e" ? { status: 0 } : { status: 0, stdout: Buffer.from(base[name]) };
    }
    calls.push({ command, args, cwd: options.root, env: options.env });
    return results.shift() ?? { status: 0 };
  };
  const readFile = (file) => {
    const name = path.basename(file);
    return name in local ? Buffer.from(local[name]) : null;
  };
  return { calls, gitCalls, run, readFile };
}

/** problem() answers from `states` in order: a string is a missing package, null a complete one. */
const sequence = (states) => () => (states.length > 1 ? states.shift() : states[0]);
const installs = (calls) => calls.filter(({ command }) => command !== process.execPath);

test("only CLAUDE_CODE_REMOTE=true is a cloud session", () => {
  for (const value of [undefined, "", "false", "1", "TRUE", "True", " true", "true "]) {
    assert.equal(isCloud({ CLAUDE_CODE_REMOTE: value }), false, `value ${JSON.stringify(value)}`);
  }
  assert.equal(isCloud({}), false);
  assert.equal(isCloud(CLOUD), true);
});

test("outside the cloud nothing is checked or run, even with node_modules missing", () => {
  const fake = checkout();
  let checked = false;
  const problem = () => ((checked = true), MISSING);
  assert.equal(cloudInstall({ env: {}, root: "/r", problem, ...fake }), "");
  assert.equal(cloudInstall({ env: { CLAUDE_CODE_REMOTE: "false" }, root: "/r", problem, ...fake }), "");
  assert.equal(checked, false);
  assert.deepEqual([...fake.calls, ...fake.gitCalls], []);
});

test("in the cloud a complete package means no install", () => {
  const fake = checkout();
  assert.equal(cloudInstall({ env: CLOUD, root: "/r", problem: () => null, ...fake }), "");
  assert.deepEqual([...fake.calls, ...fake.gitCalls], []);
});

test("F-214: the install never runs lifecycle scripts or the pnpmfile", () => {
  const fake = checkout();
  const message = cloudInstall({ env: CLOUD, root: "/r", problem: sequence([MISSING, null]), ...fake });
  assert.deepEqual(installs(fake.calls).map(({ command, args, cwd }) => ({ command, args, cwd })), [{ command: "pnpm", args: INSTALL, cwd: "/r" }]);
  assert.match(message, /package is now complete/);
});

test("F-214: no token or other credential reaches git, the installer or lefthook", () => {
  const env = {
    ...CLOUD, PATH: "/usr/bin", HOME: "/home/u", LANG: "C.UTF-8", HTTPS_PROXY: "http://proxy:3128",
    GH_TOKEN: "x", GITHUB_TOKEN: "x", OWNER_COMMAND_TOKEN: "x", NPM_TOKEN: "x", ANTHROPIC_API_KEY: "x",
    DATABASE_PASSWORD: "x", AWS_SECRET_ACCESS_KEY: "x", NODE_OPTIONS: "--require /evil.js", npm_config_registry: "http://x",
  };
  const clean = installEnv(env);
  assert.deepEqual(Object.keys(clean).sort(), ["HOME", "HTTPS_PROXY", "LANG", "PATH"]);
  const fake = checkout();
  cloudInstall({ env, root: "/r", problem: sequence([MISSING, null]), ...fake });
  const seen = [...fake.calls, ...fake.gitCalls].map(({ env: childEnv }) => childEnv);
  assert.ok(seen.length >= 3);
  for (const childEnv of seen) assert.deepEqual(childEnv, clean);
});

test("F-214: a checkout whose install inputs differ from origin/main is not installed and only gets the advice", () => {
  const cases = [
    { local: { ...SAME, "pnpm-lock.yaml": "other" }, why: /pnpm-lock\.yaml differs/ },
    { local: { ...SAME, "package.json": '{"scripts":{"preinstall":"x"}}' }, why: /package\.json differs/ },
    { local: { ...SAME, ".npmrc": "registry=http://x" }, why: /\.npmrc is not on origin\/main/ },
    { local: { ...SAME, ".pnpmfile.cjs": "x" }, why: /\.pnpmfile\.cjs is not on origin\/main/ },
    { local: { "package.json": "{}" }, why: /pnpm-lock\.yaml is missing/ },
    { hasBase: false, why: /origin\/main is not available/ },
  ];
  for (const { why, ...shape } of cases) {
    const fake = checkout(shape);
    const message = cloudInstall({ env: CLOUD, root: "/r", problem: () => MISSING, ...fake });
    assert.deepEqual(fake.calls, [], String(why));
    assert.match(message, why);
    assert.match(message, /never on a head it reviews or tests/);
  }
  assert.ok(INSTALL_INPUTS.includes(".pnpmfile.cjs") && INSTALL_INPUTS.includes("pnpm-workspace.yaml"));
});

test("F-214: git hooks are installed only when lefthook.yml also matches origin/main", () => {
  const same = checkout();
  const ok = cloudInstall({ env: CLOUD, root: "/r", problem: sequence([MISSING, null]), ...same });
  const hook = same.calls.filter(({ command }) => command === process.execPath);
  assert.equal(hook.length, 1);
  assert.deepEqual(hook[0].args, [path.join("/r", "node_modules", "lefthook", "bin", "index.js"), "install"]);
  assert.match(ok, /Git hooks installed/);
  const other = checkout({ local: { ...SAME, "lefthook.yml": "changed" } });
  const skipped = cloudInstall({ env: CLOUD, root: "/r", problem: sequence([MISSING, null]), ...other });
  assert.equal(other.calls.filter(({ command }) => command === process.execPath).length, 0);
  assert.match(skipped, /Git hooks not installed because lefthook\.yml differs/);
});

test("without pnpm on PATH it falls back to corepack pnpm, and to a message when neither exists", () => {
  const enoent = { error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) };
  const first = checkout({ results: [enoent, { status: 0 }] });
  cloudInstall({ env: CLOUD, root: "/r", problem: sequence([MISSING, null]), ...first });
  assert.deepEqual(installs(first.calls).map(({ command, args }) => [command, ...args]), [
    ["pnpm", ...INSTALL],
    ["corepack", "pnpm", ...INSTALL],
  ]);
  const none = checkout({ results: [enoent, enoent] });
  const message = cloudInstall({ env: CLOUD, root: "/r", problem: () => MISSING, ...none });
  assert.match(message, /neither pnpm nor corepack/);
  assert.match(message, /keeps blocking/);
});

test("F-214: a failed install is reported as one line without the installer's output", () => {
  const cases = [
    { status: 1, stdout: "SECRET-OUT", stderr: "ERR_PNPM_OUTDATED_LOCKFILE SECRET-ERR" },
    { status: null, error: Object.assign(new Error("spawnSync pnpm ETIMEDOUT SECRET-ERR"), { code: "ETIMEDOUT" }) },
    // Exit 0 but the safety hook's package is still incomplete: the hook's own check decides.
    { status: 0, stdout: "SECRET-OUT" },
  ];
  for (const result of cases) {
    const fake = checkout({ results: [result] });
    const message = cloudInstall({ env: CLOUD, root: "/r", problem: () => MISSING, ...fake });
    assert.equal(fake.calls.length, 1);
    assert.match(message, /locked install \(pnpm\) failed/);
    assert.match(message, /keeps blocking/);
    assert.doesNotMatch(message, /SECRET|ERR_PNPM|now complete/);
    assert.equal(message.split("\n").length, 1);
  }
});

test("installed means what the safety hook needs: a half-installed package still counts as missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-cloud-install-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "cc-safety-net": "1.0.0" } }));
    const dir = path.join(root, "node_modules", "cc-safety-net");
    fs.mkdirSync(path.join(dir, "dist", "bin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.0.0" }));
    fs.writeFileSync(path.join(dir, "dist", "bin", "cc-safety-net.js"), "x");
    const fake = checkout({ results: [{ status: 1 }] });
    cloudInstall({ env: CLOUD, root, problem: packageProblem, ...fake });
    assert.equal(fake.calls.length, 1, "hook.js is missing, so the install runs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("F-214: against a real git repository only a checkout equal to origin/main is installed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-cloud-git-"));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git("init", "-q");
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    git("add", "package.json", "pnpm-lock.yaml");
    git("commit", "-q", "-m", "base");
    git("update-ref", BASE_REF, "HEAD");
    const attempt = () => {
      const calls = [];
      const run = (command, args, options) => {
        if (command === "git") return spawnSync(command, args, { cwd: options.root, env: options.env, stdio: ["ignore", "pipe", "ignore"] });
        calls.push(command);
        return { status: 1 };
      };
      cloudInstall({ env: { ...CLOUD, PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT }, root, problem: () => MISSING, run });
      return calls;
    };
    assert.deepEqual(attempt(), ["pnpm"], "identical to origin/main: installed");
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nextra: 1\n");
    assert.deepEqual(attempt(), [], "a changed lockfile in the working tree: not installed");
    git("commit", "-q", "-am", "head under review");
    assert.deepEqual(attempt(), [], "a committed change on another head: not installed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("F-214: the hook script carries the critical floor and the owner's merge command", () => {
  assert.equal(isD97Path("scripts/engineering/cloud-install.mjs"), true);
  assert.equal(isD97Path("scripts/engineering/cloud-install.test.mjs"), true);
});

test("the command line always exits 0 and is silent outside the cloud", () => {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_REMOTE;
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/engineering/cloud-install.mjs")], { encoding: "utf8", env });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

test("settings.json runs the hook once per session start, synchronously, within its timeout", () => {
  const entries = settings.hooks.SessionStart.flatMap((entry) => entry.hooks.map((hook) => ({ entry, hook })));
  const matches = entries.filter(({ hook }) => (hook.args ?? []).includes(SCRIPT));
  assert.equal(matches.length, 1);
  const [{ entry, hook }] = matches;
  assert.equal(entry.matcher, "startup|resume|clear");
  assert.equal(hook.command, "node");
  assert.notEqual(hook.async, true, "the install must finish before the first tool call");
  assert.notEqual(hook.asyncRewake, true);
  assert.ok(hook.timeout * 1000 > INSTALL_TIMEOUT_MS, "the install gives up before the harness kills the hook");
});

test("the fail-closed safety hook is still wired unchanged", () => {
  const safety = settings.hooks.PreToolUse.filter(({ hooks }) => hooks.some(({ command }) => command.includes("scripts/hooks/safety-net.mjs")));
  assert.equal(safety.length, 1);
  assert.equal(safety[0].matcher, "Bash|PowerShell");
  const [hook] = safety[0].hooks;
  assert.equal(hook.onFailure, "block");
  assert.match(hook.command, /exit 2/);
});
