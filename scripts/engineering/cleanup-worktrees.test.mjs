// Exercise the SessionStart PowerShell cleanup against disposable local repos.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const script = join(repo, "scripts", "cleanup-worktrees.ps1");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
);
Object.assign(env, {
  GIT_AUTHOR_NAME: "cleanup test",
  GIT_AUTHOR_EMAIL: "cleanup@example.invalid",
  GIT_COMMITTER_NAME: "cleanup test",
  GIT_COMMITTER_EMAIL: "cleanup@example.invalid",
});

const git = (cwd, ...args) => execFileSync(
  "git",
  ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...args],
  { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
).trim();

function findPowerShell() {
  for (const executable of ["pwsh", "powershell"]) {
    const probe = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      env,
      stdio: "ignore",
    });
    if (!probe.error && probe.status === 0) return executable;
  }
  return null;
}

const powerShell = findPowerShell();

test("cleanup-worktrees.ps1 preserves ignored files in merged worktrees", {
  skip: !powerShell && "PowerShell is unavailable; the script integration check was not run",
}, (t) => {
  const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "cleanup-worktrees-")));
  t.after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 5 }));

  const remote = join(temp, "origin.git");
  const main = join(temp, "main");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", remote], { cwd: temp, env });
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", main], { cwd: temp, env });
  writeFileSync(join(main, ".gitignore"), "ignored-user-data.bin\n");
  git(main, "add", ".gitignore");
  git(main, "commit", "--quiet", "-m", "initial commit");
  git(main, "remote", "add", "origin", remote);
  git(main, "push", "--quiet", "--set-upstream", "origin", "main");

  const ignoredWorktree = join(temp, "merged-ignored");
  const cleanWorktree = join(temp, "merged-clean");
  git(main, "worktree", "add", "--quiet", "-b", "merged-ignored", ignoredWorktree);
  git(main, "worktree", "add", "--quiet", "-b", "merged-clean", cleanWorktree);
  const ignoredFile = join(ignoredWorktree, "ignored-user-data.bin");
  writeFileSync(ignoredFile, "keep this local file\n");

  assert.equal(git(ignoredWorktree, "status", "--porcelain"), "");
  assert.match(git(ignoredWorktree, "status", "--porcelain", "--untracked-files=all", "--ignored=matching"), /ignored-user-data\.bin/);

  const result = spawnSync(powerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
  ], { cwd: main, env, encoding: "utf8", timeout: 20_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  assert.match(result.stdout, /skip \(worktree contains uncommitted, untracked, or ignored files\):/);
  assert.equal(existsSync(ignoredWorktree), true, result.stdout);
  assert.equal(readFileSync(ignoredFile, "utf8"), "keep this local file\n");
  assert.equal(existsSync(cleanWorktree), false, result.stdout);
  assert.match(git(main, "show-ref", "--verify", "refs/heads/merged-ignored"), /refs\/heads\/merged-ignored/);
  assert.throws(() => git(main, "show-ref", "--verify", "refs/heads/merged-clean"));
});
