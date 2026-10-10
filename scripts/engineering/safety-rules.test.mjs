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

test("force push is blocked in every spelling the tool can match", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    for (const command of ["git push --force origin x", "git push -f origin x", "git push origin +x", "git push --force-with-lease origin x", "git push --force-if-includes origin x", "git push --force-w origin x", "git push --forc origin x"]) {
      assert.notEqual(decide(tool, command), "allowed", `${tool}: ${command}`);
    }
  }
});

// The two lists below pin what docs/SESSIONS.md 4a says about the limits of the
// rulebook. A change in either direction means the document must change too.
const DOCUMENTED_GAPS = {
  Bash: [
    "git push --force-with-lease=platforma/x origin platforma/x",
    "git push --prune origin",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git --config-env=core.hooksPath=HP commit -m x",
    "LEFTHOOK=0 git commit -m x",
    "git -c alias.ci='commit -n' ci -m x",
    "g=git; $g commit -n -m x",
    "alias g=git; g add -A",
    "git commit $(echo -n) -m x",
    "git add ${X:--A}",
    "winpty git add -A",
    "node -e \"require('child_process').execSync('git commit -n -m x')\"",
    "git commit-tree HEAD^{tree} -m x",
    "git update-index --again",
    "git add ':!nothing'",
    "git add ':(top,glob)**'",
    "git add src/..",
    "git add \"$PWD\"",
    "git add --pathspec-from-file=all.txt",
    "git am -k3n x.patch",
  ],
  PowerShell: [
    "& git add -A",
    "& git commit -n -m x",
    "(git add -A)",
    "$x = git commit -n -m x",
    "Start-Process git -ArgumentList 'commit','-n','-m','x'",
    "$a='-A'; git add $a",
    "$env:LEFTHOOK='0'; git commit -m x",
    "git push --force-with-lease=platforma/x origin platforma/x",
    "git -c core.hooksPath=NUL commit -m x",
    "git add ':!nothing'",
  ],
};

const DOCUMENTED_FALSE_BLOCKS = {
  "git commit -mnote": "block-git-commit-no-verify",
  "git commit -uno -m x": "block-git-commit-no-verify",
  "git commit -m \"-n\"": "block-git-commit-no-verify",
  "git commit -mwait": "block-git-commit-all",
  "git -C . add src/x.ts": "block-git-add-all",
  "git -C . commit -m x": "block-git-commit-all",
};

test("gaps named in docs/SESSIONS.md 4a still pass the hook", () => {
  for (const [tool, commands] of Object.entries(DOCUMENTED_GAPS)) {
    for (const command of commands) assert.equal(decide(tool, command), "allowed", `${tool}: ${command}`);
  }
});

test("false blocks named in docs/SESSIONS.md 4a are still blocked", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    for (const [command, rule] of Object.entries(DOCUMENTED_FALSE_BLOCKS)) {
      assert.equal(decide(tool, command), `custom.ductus-rules/${rule}`, `${tool}: ${command}`);
    }
  }
});
