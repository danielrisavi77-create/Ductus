// DAN-521 (#1516): the cloud SessionStart install hook.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudInstall, INSTALL_TIMEOUT_MS, isCloud } from "./cloud-install.mjs";
import { packageProblem } from "../hooks/safety-net.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
const SCRIPT = "${CLAUDE_PROJECT_DIR}/scripts/engineering/cloud-install.mjs";
const MISSING = "cc-safety-net is not installed or incomplete";

/** A run that records its calls and answers from `results` in order. */
function recorder(results) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, cwd: options.root });
    return results.shift() ?? { status: 0 };
  };
  return { calls, run };
}

/** problem() answers from `states` in order: a string is a missing package, null a complete one. */
const sequence = (states) => () => (states.length > 1 ? states.shift() : states[0]);

test("only CLAUDE_CODE_REMOTE=true is a cloud session", () => {
  for (const value of [undefined, "", "false", "1", "TRUE", "True", " true", "true "]) {
    assert.equal(isCloud({ CLAUDE_CODE_REMOTE: value }), false, `value ${JSON.stringify(value)}`);
  }
  assert.equal(isCloud({}), false);
  assert.equal(isCloud({ CLAUDE_CODE_REMOTE: "true" }), true);
});

test("outside the cloud nothing is checked or run, even with node_modules missing", () => {
  const { calls, run } = recorder([]);
  let checked = false;
  const problem = () => ((checked = true), MISSING);
  assert.equal(cloudInstall({ env: {}, root: "/r", problem, run }), "");
  assert.equal(cloudInstall({ env: { CLAUDE_CODE_REMOTE: "false" }, root: "/r", problem, run }), "");
  assert.equal(checked, false);
  assert.deepEqual(calls, []);
});

test("in the cloud a complete package means no install", () => {
  const { calls, run } = recorder([]);
  assert.equal(cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root: "/r", problem: () => null, run }), "");
  assert.deepEqual(calls, []);
});

test("a missing package runs pnpm install --frozen-lockfile in the repo root", () => {
  const { calls, run } = recorder([{ status: 0 }]);
  const message = cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root: "/r", problem: sequence([MISSING, null]), run });
  assert.deepEqual(calls, [{ command: "pnpm", args: ["install", "--frozen-lockfile"], cwd: "/r" }]);
  assert.match(message, /package is now complete/);
});

test("without pnpm on PATH it falls back to corepack pnpm, and to a message when neither exists", () => {
  const enoent = { error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) };
  const first = recorder([enoent, { status: 0 }]);
  cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root: "/r", problem: sequence([MISSING, null]), run: first.run });
  assert.deepEqual(first.calls.map(({ command, args }) => [command, ...args]), [
    ["pnpm", "install", "--frozen-lockfile"],
    ["corepack", "pnpm", "install", "--frozen-lockfile"],
  ]);
  const none = recorder([enoent, enoent]);
  const message = cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root: "/r", problem: () => MISSING, run: none.run });
  assert.match(message, /neither pnpm nor corepack/);
  assert.match(message, /keeps blocking/);
});

test("a failed, timed-out or incomplete install is reported, never claimed done, and not retried with another installer", () => {
  const cases = [
    { result: { status: 1, stderr: "ERR_PNPM_OUTDATED_LOCKFILE" }, expect: /exit status 1/ },
    { result: { status: null, error: Object.assign(new Error("spawnSync pnpm ETIMEDOUT"), { code: "ETIMEDOUT" }) }, expect: /ETIMEDOUT/ },
    // Exit 0 but the safety hook's package is still incomplete: the hook's own check decides.
    { result: { status: 0 }, expect: /did not complete/ },
  ];
  for (const { result, expect } of cases) {
    const { calls, run } = recorder([result]);
    const message = cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root: "/r", problem: () => MISSING, run });
    assert.equal(calls.length, 1);
    assert.match(message, expect);
    assert.match(message, /keeps blocking/);
    assert.doesNotMatch(message, /now complete/);
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
    const { calls, run } = recorder([{ status: 1 }]);
    cloudInstall({ env: { CLAUDE_CODE_REMOTE: "true" }, root, problem: packageProblem, run });
    assert.equal(calls.length, 1, "hook.js is missing, so the install runs");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
