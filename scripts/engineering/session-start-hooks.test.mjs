import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bash = spawnSync("sh", ["-c", "command -v bash"], {
  encoding: "utf8",
}).stdout.trim();

function cleanupHook() {
  const settings = JSON.parse(
    fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"),
  );
  const hooks = settings.hooks.SessionStart.flatMap((entry) => entry.hooks);
  const matches = hooks.filter((hook) =>
    hook.command.includes("cleanup-worktrees.ps1"),
  );
  assert.equal(
    matches.length,
    1,
    "exactly one SessionStart hook runs cleanup-worktrees.ps1",
  );
  assert.equal(matches[0].shell, "bash");
  return matches[0].command;
}

function runWithPath(binDir) {
  return spawnSync(bash, ["-c", cleanupHook()], {
    encoding: "utf8",
    env: { PATH: binDir, CLAUDE_PROJECT_DIR: "/fake/project" },
  });
}

test("cleanup hook exits 0 silently when powershell is not installed", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-nops-"));
  try {
    const result = runWithPath(binDir);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("cleanup hook runs the worktree script through powershell when it is installed", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-ps-"));
  const argsFile = path.join(binDir, "args.txt");
  try {
    fs.writeFileSync(
      path.join(binDir, "powershell"),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\nexit 7\n`,
      { mode: 0o755 },
    );
    const result = runWithPath(binDir);
    assert.equal(
      result.status,
      7,
      "the powershell exit code is passed through",
    );
    assert.deepEqual(fs.readFileSync(argsFile, "utf8").trim().split("\n"), [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "/fake/project/scripts/cleanup-worktrees.ps1",
    ]);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
