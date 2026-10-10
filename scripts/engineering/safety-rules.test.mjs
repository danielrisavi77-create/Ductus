import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// cc-safety-net validates the rulebook's `tests` array but does not run it,
// so run every case through the real hook binary here.
const root = fileURLToPath(new URL("../../", import.meta.url));
const bin = fileURLToPath(new URL("../../node_modules/cc-safety-net/dist/bin/cc-safety-net.js", import.meta.url));
const rulebook = JSON.parse(fs.readFileSync(new URL("../../.cc-safety-net/rules/ductus-rules/rulebook.json", import.meta.url), "utf8"));

function decide(tool_name, command) {
  const event = { hook_event_name: "PreToolUse", cwd: root, tool_name, tool_input: { command } };
  const result = spawnSync(process.execPath, [bin, "hook", "--coding-cli"], { input: JSON.stringify(event), encoding: "utf8", cwd: root });
  assert.equal(result.status, 0);
  if (!result.stdout.trim()) return "allowed";
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  return /Rule: (\S+)/.exec(output.permissionDecisionReason)?.[1] ?? output.permissionDecision;
}

for (const tool of ["Bash", "PowerShell"]) {
  test(`ductus rulebook cases hold for the ${tool} tool`, () => {
    for (const { command, expect, rule } of rulebook.tests) {
      const expected = expect === "blocked" ? `custom.ductus-rules/${rule}` : "allowed";
      assert.equal(decide(tool, command), expected, command);
    }
  });
}

test("routine commands are not blocked by the built-in rules", () => {
  for (const command of ["git status", "pnpm test", "git push -u origin platforma/x", "docker compose down -v", "rm -rf node_modules/.cache"]) {
    assert.equal(decide("Bash", command), "allowed", command);
  }
});

test("destructive commands and secret reads are blocked", () => {
  for (const command of ["git push --force origin main", "rm -rf /", "cat .env.local"]) {
    assert.notEqual(decide("Bash", command), "allowed", command);
  }
});
