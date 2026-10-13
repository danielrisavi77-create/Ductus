import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findProjectRoot, hookExitCode, isOrchestratorEdit, orchestratorTestFiles } from "./orchestrator-tests.mjs";

const fileInput = (toolName, filePath, cwd) => ({ tool_name: toolName, tool_input: { file_path: filePath }, cwd });

test("the hook targets Edit and Write only for orchestrator files in the current checkout", () => {
  const root = path.resolve("test-checkout");
  const nestedCwd = path.join(root, ".claude", "worktrees", "agent-1");
  const source = path.join(nestedCwd, "scripts", "orchestrator", "health-core.mjs");
  assert.equal(isOrchestratorEdit(fileInput("Edit", source, nestedCwd), nestedCwd), true);
  assert.equal(isOrchestratorEdit(fileInput("Write", source, nestedCwd), nestedCwd), true);
  assert.equal(isOrchestratorEdit(fileInput("Read", source, nestedCwd), nestedCwd), false);
  assert.equal(isOrchestratorEdit(fileInput("Write", path.join(nestedCwd, "docs", "notes.md"), nestedCwd), nestedCwd), false);
  assert.equal(isOrchestratorEdit(fileInput("Edit", path.join(root, "scripts", "orchestrator", "x.mjs"), nestedCwd), nestedCwd), false);
});

test("repo root discovery walks up from a nested worktree cwd", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hook-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nested = path.join(root, ".claude", "worktrees", "agent-1");
  fs.mkdirSync(path.join(root, "scripts", "orchestrator"), { recursive: true });
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  assert.equal(findProjectRoot(nested), root);
  assert.equal(findProjectRoot("relative/path"), null);
});

test("the runner passes explicit orchestrator test paths for Windows and Unix", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hook-tests-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const testDir = path.join(root, "scripts", "orchestrator");
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, "alpha.test.mjs"), "");
  fs.writeFileSync(path.join(testDir, "beta.test.mjs"), "");
  fs.writeFileSync(path.join(testDir, "support.mjs"), "");
  fs.mkdirSync(path.join(testDir, "nested.test.mjs"));
  assert.deepEqual(orchestratorTestFiles(root), [
    path.join("scripts", "orchestrator", "alpha.test.mjs"),
    path.join("scripts", "orchestrator", "beta.test.mjs"),
  ]);
});

test("the hook process runs the orchestrator suite from the event checkout", () => {
  const root = path.resolve(".");
  const target = path.join(root, orchestratorTestFiles(root)[0]);
  const input = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: target }, cwd: root });
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "hooks", "orchestrator-tests.mjs")], {
    cwd: root,
    encoding: "utf8",
    input,
    timeout: 120_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.stderr, "");
});

test("only a successful test run avoids asyncRewake; every failure becomes exit code 2", () => {
  assert.equal(hookExitCode(0), 0);
  assert.equal(hookExitCode(1), 2);
  assert.equal(hookExitCode(null), 2);
});
