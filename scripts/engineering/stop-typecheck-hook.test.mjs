// DAN-213 (#420): Stop hook that blocks only on tsc errors in changed files, fail-open, no loop.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_SHOWN, TSC_TIMEOUT_MS, changedTsFiles, errorsIn, runStopHook, stopDecision } from "../hooks/stop-typecheck.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK = path.join(repo, "scripts", "hooks", "stop-typecheck.mjs");

test("changedTsFiles keeps changed and untracked TypeScript, drops deleted and other files", () => {
  const z = [" M src/a.ts", "?? src/new.tsx", "A  tests/b.test.ts", " D src/gone.ts", "R  src/renamed.ts", "src/old.ts",
    " M docs/x.md", "?? scripts/x.mjs", "MM src/c.mts"].join("\0");
  assert.deepEqual([...changedTsFiles(z)].sort(), ["src/a.ts", "src/c.mts", "src/new.tsx", "src/renamed.ts", "tests/b.test.ts"]);
  assert.equal(changedTsFiles("").size, 0);
});

test("errorsIn reports only errors located in changed files", () => {
  const out = [
    "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/other.ts(1,1): error TS2304: Cannot find name 'x'.",
    "src\\new.tsx(9,2): error TS7006: Parameter 'p' implicitly has an 'any' type.",
    "  src/a.ts(4,1): continuation without a code",
    "Found 3 errors.",
  ].join("\n");
  const hits = errorsIn(out, new Set(["src/a.ts", "src/new.tsx"]));
  assert.equal(hits.length, 2);
  assert.match(hits[0], /^src\/a\.ts\(3,7\): error TS2322/);
  assert.match(hits[1], /TS7006/);
});

test("stopDecision blocks with a capped list, or lets the session stop", () => {
  assert.equal(stopDecision([]), undefined);
  const many = Array.from({ length: MAX_SHOWN + 5 }, (_, i) => `src/a.ts(${i + 1},1): error TS1: x`);
  const d = stopDecision(many);
  assert.equal(d.decision, "block");
  assert.equal(d.reason.split("\n").filter((l) => l.startsWith("src/a.ts")).length, MAX_SHOWN);
  assert.match(d.reason, /and 5 more/);
});

function fakeExec({ status = " M src/a.ts", tracked = "", tsc = { status: 2, stdout: "src/a.ts(1,1): error TS2304: Cannot find name 'x'." } } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (args[0] === "rev-parse") return { status: 0, stdout: `${repo}\n` };
    if (args[0] === "status") return status === null ? { status: 128, stdout: "" } : { status: 0, stdout: status };
    if (args[0] === "ls-files") return { status: tracked === null ? 128 : 0, stdout: tracked ?? "" };
    return tsc;
  };
  return { exec, calls };
}

test("runStopHook blocks on an error in a changed file", () => {
  const { exec } = fakeExec();
  assert.equal(runStopHook({ cwd: repo }, { exec }).decision, "block");
});

test("runStopHook never runs twice in a row and fails open", () => {
  const cases = {
    "stop_hook_active": [{ cwd: repo, stop_hook_active: true }, {}],
    "no input": [null, {}],
    "git status fails": [{ cwd: repo }, { status: null }],
    "no changed TypeScript": [{ cwd: repo }, { status: " M docs/a.md" }],
    "tsc timed out": [{ cwd: repo }, { tsc: { status: null, error: new Error("ETIMEDOUT"), stdout: "" } }],
    "error only in an unchanged file": [{ cwd: repo }, { tsc: { status: 2, stdout: "src/z.ts(1,1): error TS1: x" } }],
    "node_modules tracked in the checkout": [{ cwd: repo }, { tracked: "node_modules/typescript/bin/tsc\0" }],
    "differently cased node_modules tracked": [{ cwd: repo }, { tracked: "src/a.ts\0NODE_MODULES/typescript/bin/tsc\0" }],
    "tracked-file listing fails": [{ cwd: repo }, { tracked: null }],
    "tsc clean": [{ cwd: repo }, { tsc: { status: 0, stdout: "" } }],
  };
  for (const [name, [input, opts]] of Object.entries(cases)) {
    const { exec, calls } = fakeExec(opts);
    assert.equal(runStopHook(input, { exec, projectDir: undefined }), undefined, name);
    if (name === "stop_hook_active") assert.deepEqual(calls, [], "nothing runs while the hook is active");
  }
});

for (const dir of ["node_modules", "NODE_MODULES", "Node_Modules"]) test(`a tracked ${dir}/typescript is never executed`, { timeout: 60_000 }, (t) => {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "stop-tracked-")));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const git = (...a) => spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
  git("init", "-q");
  const marker = path.join(tmp, "ran.txt");
  git("config", "core.ignorecase", "true");
  fs.mkdirSync(path.join(tmp, dir, "typescript", "bin"), { recursive: true });
  fs.writeFileSync(path.join(tmp, dir, "typescript", "bin", "tsc"), `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");\n`);
  git("add", "-f", `${dir}/typescript/bin/tsc`);
  fs.writeFileSync(path.join(tmp, "a.ts"), "export const a: number = 1;\n");
  assert.equal(runStopHook({ cwd: tmp }), undefined);
  assert.equal(fs.existsSync(marker), false, "the tracked tsc must not run");
});

test("the hook script exits 0 with no output on bad input and when already active", () => {
  for (const stdin of ["not json", JSON.stringify({ cwd: repo, stop_hook_active: true })]) {
    const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  }
});

test("settings register the Stop hook once, through node with the project path", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
  const hooks = (settings.hooks.Stop ?? []).flatMap((e) => e.hooks);
  const ours = hooks.filter((h) => (h.args ?? []).some((a) => a.endsWith("scripts/hooks/stop-typecheck.mjs")));
  assert.equal(ours.length, 1);
  assert.equal(ours[0].command, "node");
  assert.deepEqual(ours[0].args, ["${CLAUDE_PROJECT_DIR}/scripts/hooks/stop-typecheck.mjs"]);
  assert.ok(ours[0].timeout * 1000 > TSC_TIMEOUT_MS, "the hook timeout covers the tsc timeout");
});

test("a real tsc error in an untracked file of a throwaway repo blocks the stop", { timeout: 200_000 }, (t) => {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "stop-tsc-")));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const git = (...a) => spawnSync("git", a, { cwd: tmp, encoding: "utf8" });
  git("init", "-q");
  fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ["*.ts"] }));
  fs.writeFileSync(path.join(tmp, "ok.ts"), "export const ok: number = 1;\n");
  fs.writeFileSync(path.join(tmp, "bad.ts"), "export const bad: number = 'x';\n");
  fs.mkdirSync(path.join(tmp, "node_modules"));
  fs.symlinkSync(path.join(repo, "node_modules", "typescript"), path.join(tmp, "node_modules", "typescript"), "junction");
  const d = runStopHook({ cwd: tmp });
  assert.equal(d?.decision, "block");
  assert.match(d.reason, /bad\.ts\(1,14\): error TS2322/);
  assert.doesNotMatch(d.reason, /ok\.ts/);
});
