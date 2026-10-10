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
    "git am -3kn x.patch",
    "GIT_CONFIG_PARAMETERS=\"'core.hookspath=/dev/null'\" git commit -m x",
    "GIT_CONFIG_GLOBAL=x.cfg git commit -m x",
    "GIT_CONFIG_SYSTEM=x.cfg git commit -m x",
    "GIT_CONFIG=x.cfg git commit -m x",
    "git config include.path x.cfg",
    "npx git add -A",
    "pnpm dlx git add -A",
    // Commands read from a file: the hook sees the command line, not the script.
    "bash x.sh",
    "sh x.sh",
    "source x.sh",
    ". x.sh",
    "./x.sh",
    "./x.ps1",
    "pwsh -File x.ps1",
    "pnpm run x",
    "pnpm x",
    "npm run x",
    "make x",
    "node x.mjs",
    "git config alias.ci 'commit -n'",
    "git ci -m x",
    // A git or lefthook hook that calls git itself runs from a routine commit.
    "git commit -m x",
    // Programs git runs on its own.
    "git rebase -x 'git commit -n -m x' HEAD~1",
    "git rebase --exec 'git add -A' HEAD~1",
    "git submodule foreach 'git add -A'",
    "git bisect run ./x.sh",
    "git filter-branch --tree-filter ./x.sh HEAD",
    "git difftool -x ./x.sh",
    "GIT_EDITOR=./x.sh git commit",
    "EDITOR=./x.sh git commit",
    "GIT_SEQUENCE_EDITOR=./x.sh git rebase -i HEAD~1",
    "git -c core.editor=./x.sh commit",
    "git -c sequence.editor=./x.sh rebase -i HEAD~1",
    "git -c core.pager=./x.sh log",
    "GIT_PAGER=./x.sh git log",
    "PAGER=./x.sh git log",
    "git -c core.fsmonitor=./x.sh status",
    "git -c gpg.program=./x.sh commit -S -m x",
    "git -c diff.external=./x.sh diff",
    "GIT_EXTERNAL_DIFF=./x.sh git diff",
    "git -c credential.helper='!./x.sh' push",
    "git config filter.x.clean ./x.sh",
    "git config diff.x.textconv ./x.sh",
    "git config core.sshCommand ./x.sh",
    "GIT_TEMPLATE_DIR=x git init y",
    "git clone --template=x y z",
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
    "$env:GIT_CONFIG_PARAMETERS=\"'core.hookspath=NUL'\"; git commit -m x",
    "$env:GIT_EDITOR='./x.ps1'; git commit",
    "git am -3kn x.patch",
    "npx git add -A",
    "./x.ps1",
    "& ./x.ps1",
    "pwsh -File x.ps1",
    "bash x.sh",
    "pnpm run x",
    "node x.mjs",
    "git config alias.ci 'commit -n'",
    "git ci -m x",
    "git rebase -x 'git commit -n -m x' HEAD~1",
    "git submodule foreach 'git add -A'",
    "git -c core.editor=./x.ps1 commit",
    "git config core.sshCommand ./x.ps1",
  ],
};

// docs/SESSIONS.md 4a also names forms next to those gaps that built-in rules block.
const DOCUMENTED_BUILT_IN_BLOCKS = {
  Bash: ["GIT_SSH_COMMAND=./x.sh git push", "GIT_SSH=./x.sh git push", "git -c core.sshCommand=./x.sh push", "pnpm exec git add -A"],
  PowerShell: ["source x.sh", ". x.sh", ". ./x.ps1", "GIT_SSH_COMMAND=./x.sh git push", "git -c core.sshCommand=./x.sh push", "pnpm exec git add -A"],
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

test("blocked neighbours of the gaps named in docs/SESSIONS.md 4a stay blocked", () => {
  for (const [tool, commands] of Object.entries(DOCUMENTED_BUILT_IN_BLOCKS)) {
    for (const command of commands) assert.notEqual(decide(tool, command), "allowed", `${tool}: ${command}`);
  }
});

test("false blocks named in docs/SESSIONS.md 4a are still blocked", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    for (const [command, rule] of Object.entries(DOCUMENTED_FALSE_BLOCKS)) {
      assert.equal(decide(tool, command), `custom.ductus-rules/${rule}`, `${tool}: ${command}`);
    }
  }
});
