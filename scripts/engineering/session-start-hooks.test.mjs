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
const shBash = spawnSync("sh", ["-c", "command -v bash"], {
  encoding: "utf8",
}).stdout.trim();
// Git Bash on Windows answers with an MSYS path that Node cannot spawn.
const bash =
  process.platform === "win32"
    ? spawnSync("cygpath", ["-w", shBash], { encoding: "utf8" }).stdout.trim()
    : shBash;
const SCRIPT = "session-worktree-clean.mjs";

function cleanupEntry() {
  const settings = JSON.parse(
    fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"),
  );
  const all = settings.hooks.SessionStart.flatMap((entry) =>
    entry.hooks.map((hook) => ({ entry, hook })),
  );
  assert.equal(
    all.filter(({ hook }) => hook.command.includes("cleanup-worktrees.ps1"))
      .length,
    0,
    "the old PowerShell cleanup is no longer wired",
  );
  const matches = all.filter(({ hook }) => hook.command.includes(SCRIPT));
  assert.equal(matches.length, 1, `exactly one SessionStart hook runs ${SCRIPT}`);
  assert.equal(matches[0].hook.shell, "bash");
  return matches[0];
}

function runWithPath(binDir) {
  return spawnSync(bash, ["-c", cleanupEntry().hook.command], {
    encoding: "utf8",
    env: { PATH: binDir, CLAUDE_PROJECT_DIR: "/fake/project" },
  });
}

test("cleanup hook runs only on startup, not on resume, clear or compact", () => {
  assert.equal(cleanupEntry().entry.matcher, "startup");
  assert.equal(cleanupEntry().hook.async, true);
});

test("cleanup hook exits 0 silently when node is not installed", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-nonode-"));
  try {
    const result = runWithPath(binDir);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("cleanup hook runs the node script and stays fail-open on its exit code", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-node-"));
  const argsFile = path.join(binDir, "args.txt");
  try {
    fs.writeFileSync(
      path.join(binDir, "node"),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\nexit 7\n`,
      { mode: 0o755 },
    );
    const result = runWithPath(binDir);
    assert.equal(result.status, 0, "a failing cleanup never blocks the session");
    assert.deepEqual(fs.readFileSync(argsFile, "utf8").trim().split("\n"), [
      `/fake/project/scripts/orchestrator/${SCRIPT}`,
      "--hook",
    ]);
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
