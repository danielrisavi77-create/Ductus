// DAN-130: worktree-clean against throwaway repositories with real worktrees.
// No network, no GitHub, and never the worktrees of this repository.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GuardError, assertDeletable, clean, defaultExec, parseArgs, removeTree } from "./worktree-clean.mjs";

const SCRIPT = fileURLToPath(new URL("./worktree-clean.mjs", import.meta.url));
// Drop inherited GIT_* (set inside git hooks) so every command stays in the temp repos.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("GIT_")));
Object.assign(env, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
});
const git = (cwd, ...a) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...a], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const link = (target, path) => symlinkSync(target, path, "junction"); // junction on Windows, symlink elsewhere

/** Bare remote + main checkout `work` with helpers; everything under one temp directory. */
function setup(t, workName = "work") {
  const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "orch-clean-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const remote = join(tmp, "remote.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  const work = join(tmp, workName);
  git(tmp, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, ".gitignore"), "ignored/\n");
  git(work, "add", ".gitignore");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  assert.equal(realpathSync.native(git(work, "rev-parse", "--show-toplevel")), work);
  const base = join(work, ".claude", "worktrees");
  let n = 0;
  /** Registered worktree with one commit of its own; pushed unless push=false. */
  const add = (name, { push = true, dir = base } = {}) => {
    const path = join(dir, name);
    const branch = `b${n += 1}`;
    git(work, "worktree", "add", "-q", "-b", branch, path);
    writeFileSync(join(path, "f.txt"), name);
    git(path, "add", "f.txt");
    git(path, "commit", "-q", "-m", name);
    if (push) git(path, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
    return { path, branch };
  };
  const orphan = (name, files = { "x.txt": "x" }) => {
    const path = join(base, name);
    mkdirSync(path, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
    return path;
  };
  const run = (opts = {}) => {
    const lines = [];
    const res = clean({ cwd: work, log: (l) => lines.push(l), ...opts });
    return { ...res, out: lines.join("\n") };
  };
  const registered = () => git(work, "worktree", "list", "--porcelain").replaceAll("\\", "/");
  const isRegistered = (path) => registered().includes(`worktree ${path.replaceAll("\\", "/")}\n`);
  return { tmp, remote, work, base, add, orphan, run, isRegistered };
}
const reasonOf = (res, name) => res.skipped.find((s) => s.name === name)?.reason;

test("clean worktree with HEAD on origin is removed; its branch stays", (t) => {
  const r = setup(t);
  const a = r.add("agent-a1");
  mkdirSync(join(a.path, "ignored", "deep"), { recursive: true });
  writeFileSync(join(a.path, "ignored", "deep", "big.bin"), "x");
  const res = r.run({ apply: true });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.removed, ["agent-a1"]);
  assert.equal(existsSync(a.path), false);
  assert.equal(r.isRegistered(a.path), false);
  assert.match(git(r.work, "branch", "--list", a.branch), new RegExp(a.branch));
  assert.match(res.out, /summary: removed 1, failed 0, skipped 0/);
});

test("without --apply nothing is removed (CLI default and --dry-run)", (t) => {
  const r = setup(t);
  const a = r.add("agent-a1");
  const o = r.orphan("agent-orphan");
  for (const args of [[], ["--dry-run"]]) {
    const cli = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: r.work, env, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /would remove\s+agent-a1 /);
    assert.match(cli.stdout, /would remove\s+agent-orphan /);
    assert.match(cli.stdout, /dry run: nothing was removed; pass --apply to remove/);
    assert.equal(existsSync(join(a.path, "f.txt")), true);
    assert.equal(r.isRegistered(a.path), true);
    assert.equal(existsSync(join(o, "x.txt")), true);
  }
});

test("uncommitted change, untracked file, unpushed commit, lock and --keep are skipped", (t) => {
  const r = setup(t);
  const dirty = r.add("agent-dirty");
  writeFileSync(join(dirty.path, "f.txt"), "changed");
  const staged = r.add("agent-staged");
  writeFileSync(join(staged.path, "new.txt"), "n");
  git(staged.path, "add", "new.txt");
  const untracked = r.add("agent-untracked");
  writeFileSync(join(untracked.path, "note.txt"), "n");
  const unpushed = r.add("agent-unpushed", { push: false });
  const ahead = r.add("agent-ahead");
  git(ahead.path, "commit", "-q", "--allow-empty", "-m", "local only");
  const locked = r.add("agent-locked");
  git(r.work, "worktree", "lock", locked.path);
  const kept = r.add("agent-kept");
  const keptOrphan = r.orphan("agent-kept-orphan");
  const bisect = r.add("agent-bisect");
  writeFileSync(join(git(bisect.path, "rev-parse", "--absolute-git-dir"), "BISECT_LOG"), "");
  const noGit = r.add("agent-nogit"); // without .git, git commands in it would answer for the main checkout
  rmSync(join(noGit.path, ".git"));
  // hidden untracked files must not make a worktree look clean
  git(r.work, "config", "status.showUntrackedFiles", "no");

  const res = r.run({ apply: true, keep: ["agent-kept", "agent-kept-orphan"] });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.removed, []);
  assert.equal(reasonOf(res, "agent-dirty"), "uncommitted changes");
  assert.equal(reasonOf(res, "agent-staged"), "uncommitted changes");
  assert.equal(reasonOf(res, "agent-untracked"), "untracked files");
  assert.equal(reasonOf(res, "agent-unpushed"), "HEAD not on any origin branch");
  assert.equal(reasonOf(res, "agent-ahead"), "HEAD not on any origin branch");
  assert.equal(reasonOf(res, "agent-locked"), "locked");
  assert.equal(reasonOf(res, "agent-kept"), "kept (--keep)");
  assert.equal(reasonOf(res, "agent-kept-orphan"), "kept (--keep)");
  assert.equal(reasonOf(res, "agent-bisect"), "rebase, merge or bisect in progress");
  assert.equal(reasonOf(res, "agent-nogit"), "not a readable worktree");
  for (const w of [dirty, staged, untracked, unpushed, ahead, locked, kept, bisect]) {
    assert.equal(existsSync(join(w.path, "f.txt")), true, w.path);
    assert.equal(r.isRegistered(w.path), true, w.path);
  }
  // its files stay in this run; the closing `git worktree prune` drops the registration (git's own rule)
  assert.equal(existsSync(join(noGit.path, "f.txt")), true);
  assert.equal(readFileSync(join(dirty.path, "f.txt"), "utf8"), "changed");
  assert.equal(existsSync(join(untracked.path, "note.txt")), true);
  assert.equal(existsSync(join(keptOrphan, "x.txt")), true);
  assert.match(res.out, /skipped 10 \(/);
});

test("the current directory, also when it is below the worktree, is skipped", (t) => {
  const r = setup(t);
  const here = r.add("agent-here");
  const other = r.add("agent-other");
  const hereOrphan = r.orphan("agent-here-orphan");
  mkdirSync(join(here.path, "ignored", "sub"), { recursive: true });
  let res = r.run({ apply: true, cwd: join(here.path, "ignored", "sub") });
  assert.equal(reasonOf(res, "agent-here"), "current directory");
  assert.equal(r.isRegistered(here.path), true);
  assert.deepEqual(res.removed, ["agent-other", "agent-here-orphan"]);
  assert.equal(existsSync(other.path), false);
  // an orphan directory cannot be the cwd of a git command; the rule is checked on its own
  const o2 = r.orphan("agent-o2");
  res = r.run({ apply: true, cwd: here.path, keep: ["agent-here"] });
  assert.equal(existsSync(o2), false);
  assert.equal(existsSync(hereOrphan), false);
});

test("orphan directories: plain ones go, one with .git or behind a link stays", (t) => {
  const r = setup(t);
  const outside = join(r.tmp, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "precious.txt"), "p");
  const plain = r.orphan("agent-plain");
  mkdirSync(join(plain, "node_modules", "pkg"), { recursive: true });
  link(outside, join(plain, "node_modules", "pkg", "linked")); // a link inside a deletable tree
  const withGitFile = r.orphan("agent-gitfile", { ".git": "gitdir: /nowhere", "x.txt": "x" });
  const withGitDir = r.orphan("agent-gitdir");
  mkdirSync(join(withGitDir, ".git"));
  mkdirSync(r.base, { recursive: true });
  link(outside, join(r.base, "agent-link")); // the orphan itself is a link to the outside
  writeFileSync(join(r.base, "agent-file"), "not a directory");

  const dry = r.run();
  assert.deepEqual(dry.removed, ["agent-plain"]);
  assert.equal(existsSync(plain), true);
  const res = r.run({ apply: true });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.removed, ["agent-plain"]);
  assert.equal(existsSync(plain), false);
  assert.equal(reasonOf(res, "agent-gitfile"), "not registered here but has .git");
  assert.equal(reasonOf(res, "agent-gitdir"), "not registered here but has .git");
  assert.equal(reasonOf(res, "agent-link"), "symlink or junction, not followed");
  assert.equal(reasonOf(res, "agent-file"), "not a directory");
  assert.equal(existsSync(join(withGitFile, "x.txt")), true);
  assert.equal(existsSync(join(withGitDir, ".git")), true);
  assert.equal(existsSync(join(r.base, "agent-link")), true);
  assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "p");
});

test("a link to the outside inside a removed worktree does not take its target along", (t) => {
  const r = setup(t);
  const outside = join(r.tmp, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "precious.txt"), "p");
  const a = r.add("agent-a1");
  mkdirSync(join(a.path, "ignored"));
  link(outside, join(a.path, "ignored", "linked"));
  const res = r.run({ apply: true });
  assert.deepEqual(res.removed, ["agent-a1"], res.out);
  assert.equal(existsSync(a.path), false);
  assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "p");
});

test("names other than agent-* and worktrees elsewhere are never touched", (t) => {
  const r = setup(t);
  const other = r.add("other-x");
  const upper = r.add("Agent-x");
  const outside = r.add("agent-out", { dir: join(r.tmp, "elsewhere") });
  const nested = r.add("agent-nested", { dir: join(r.base, "group") });
  const dir = r.orphan("tmp-y");
  const res = r.run({ apply: true });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(res.removed, []);
  assert.equal(reasonOf(res, "other-x"), "name is not agent-*");
  assert.equal(reasonOf(res, "tmp-y"), "name is not agent-*");
  assert.doesNotMatch(res.out, /agent-out|agent-nested/);
  for (const w of [other, upper, outside, nested]) {
    assert.equal(existsSync(join(w.path, "f.txt")), true, w.path);
    assert.equal(r.isRegistered(w.path), true, w.path);
  }
  assert.equal(existsSync(join(dir, "x.txt")), true);
});

test("paths with spaces and shell characters are handled literally", (t) => {
  const r = setup(t, "wo rk & (co)");
  const names = ["agent-a b", "agent-it's $HOME `x`", "agent-;rm -rf --force"];
  const wt = r.add(names[0]);
  const o1 = r.orphan(names[1]);
  const o2 = r.orphan(names[2]);
  const neighbour = r.orphan("tmp");
  const cli = spawnSync(process.execPath, [SCRIPT, "--apply"], { cwd: r.work, env, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  for (const p of [wt.path, o1, o2]) assert.equal(existsSync(p), false, p);
  assert.equal(r.isRegistered(wt.path), false);
  assert.equal(existsSync(join(neighbour, "x.txt")), true);
  assert.equal(existsSync(join(r.work, ".gitignore")), true);
});

test("failed git fetch: nothing is removed, not even orphans; exit code 1", (t) => {
  const r = setup(t);
  const a = r.add("agent-a1");
  const o = r.orphan("agent-orphan");
  git(r.work, "remote", "set-url", "origin", join(r.tmp, "gone.git"));
  for (const apply of [false, true]) {
    const res = r.run({ apply });
    assert.equal(res.code, 1);
    assert.deepEqual([res.removed, res.skipped, res.failed], [[], [], []]);
    assert.match(res.out, /FAILED: git fetch origin/);
    assert.match(res.out, /nothing removed/);
  }
  assert.equal(r.isRegistered(a.path), true);
  assert.equal(existsSync(join(a.path, "f.txt")), true);
  assert.equal(existsSync(join(o, "x.txt")), true);
  const cli = spawnSync(process.execPath, [SCRIPT, "--apply"], { cwd: r.work, env, encoding: "utf8" });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
});

test("partial failure: clear message, non-zero exit, the rest still goes", (t) => {
  const r = setup(t);
  const stuck = r.add("agent-1stuck");
  const fine = r.add("agent-2fine");
  const badOrphan = r.orphan("agent-3bad");
  const goodOrphan = r.orphan("agent-4good");
  const exec = (cmd, args, o) =>
    (args[0] === "worktree" && args[1] === "remove" && args[2].includes("agent-1stuck")
      ? { ok: false, out: "", err: "fatal: simulated failure" } : defaultExec(cmd, args, o));
  const removeDir = (path) => {
    if (path.includes("agent-3bad")) throw new Error("Access to the path is denied.");
    removeTree(path);
  };
  const res = r.run({ apply: true, exec, removeDir });
  assert.equal(res.code, 1);
  assert.deepEqual(res.removed, ["agent-2fine", "agent-4good"]);
  assert.deepEqual(res.failed, [
    { name: "agent-1stuck", reason: "git worktree remove: fatal: simulated failure" },
    { name: "agent-3bad", reason: "directory could not be deleted: Access to the path is denied." },
  ]);
  assert.match(res.out, /FAILED\s+agent-1stuck/);
  assert.match(res.out, /summary: removed 2, failed 2, skipped 0/);
  assert.equal(existsSync(join(stuck.path, "f.txt")), true);
  assert.equal(existsSync(fine.path), false);
  assert.equal(existsSync(join(badOrphan, "x.txt")), true);
  assert.equal(existsSync(goodOrphan), false);
  // a deletion that reports success but leaves the directory is a failure too
  const silent = r.run({ apply: true, keep: ["agent-1stuck"], removeDir: () => {} });
  assert.equal(silent.code, 1);
  assert.equal(silent.failed[0].reason, "directory still exists after deletion");
});

test("Windows case: git unregisters the worktree but leaves the directory behind", (t) => {
  const r = setup(t);
  const left = r.add("agent-left");
  const leftWithGit = r.add("agent-leftgit");
  // Stand-in for `git worktree remove` failing half way: the registration is gone, files remain.
  const exec = (cmd, args, o) => {
    if (!(args[0] === "worktree" && args[1] === "remove")) return defaultExec(cmd, args, o);
    const keepGit = args[2].includes("agent-leftgit");
    const dotGit = join(args[2], ".git");
    const saved = readFileSync(dotGit, "utf8");
    rmSync(dotGit);
    git(r.work, "worktree", "prune");
    if (keepGit) writeFileSync(dotGit, saved);
    return { ok: false, out: "", err: "error: failed to delete: Filename too long" };
  };
  const res = r.run({ apply: true, exec });
  assert.deepEqual(res.removed, ["agent-left"], res.out);
  assert.equal(existsSync(left.path), false);
  // never registered any more, but .git is there: left in place and reported
  assert.deepEqual(res.failed, [{ name: "agent-leftgit", reason: "unregistered but .git present, directory left in place" }]);
  assert.equal(existsSync(join(leftWithGit.path, "f.txt")), true);
  assert.equal(res.code, 1);
});

test("path guard refuses everything that is not a real agent-* directory in place", (t) => {
  const r = setup(t);
  const ok = r.orphan("agent-ok");
  const outside = join(r.tmp, "agent-outside");
  mkdirSync(outside);
  link(outside, join(r.base, "agent-link"));
  mkdirSync(join(r.base, "agent-parent", "agent-child"), { recursive: true });
  assert.doesNotThrow(() => assertDeletable(r.work, ok));
  for (const bad of [
    join(r.base, "agent-link"), outside, r.orphan("tmp-y"), r.base, r.work, join(r.base, "agent-missing"),
    join(r.base, "agent-parent", "agent-child"), join(r.base, "agent-ok", ".."), join(r.base, "agent-link", "."),
  ]) {
    assert.throws(() => assertDeletable(r.work, bad), GuardError, bad);
  }
  // a second checkout is another root: its agent directories are not ours
  const other = join(r.tmp, "other");
  git(r.tmp, "init", "-q", "-b", "main", other);
  assert.throws(() => assertDeletable(other, ok), GuardError);

  // .claude/worktrees itself redirected to the outside: stop before looking at anything
  const r2 = setup(t);
  const target = join(r2.tmp, "target");
  mkdirSync(join(target, "agent-victim"), { recursive: true });
  writeFileSync(join(target, "agent-victim", "v.txt"), "v");
  mkdirSync(join(r2.work, ".claude"));
  link(target, r2.base);
  assert.throws(() => r2.run({ apply: true }), GuardError);
  assert.equal(existsSync(join(target, "agent-victim", "v.txt")), true);
  const cli = spawnSync(process.execPath, [SCRIPT, "--apply"], { cwd: r2.work, env, encoding: "utf8" });
  assert.equal(cli.status, 2, cli.stdout + cli.stderr);
  assert.match(cli.stderr, /worktree-clean stopped: path guard/);
});

test("an inherited GIT_DIR cannot make a dirty worktree look clean", (t) => {
  const r = setup(t);
  const dirty = r.add("agent-dirty");
  writeFileSync(join(dirty.path, "f.txt"), "changed");
  const elsewhere = join(r.tmp, "elsewhere");
  git(r.tmp, "init", "-q", "-b", "main", elsewhere);
  const cli = spawnSync(process.execPath, [SCRIPT, "--apply"], {
    cwd: r.work, encoding: "utf8", env: { ...env, GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
  });
  assert.match(cli.stdout, /skip\s+agent-dirty {2}uncommitted changes/, cli.stdout + cli.stderr);
  assert.equal(readFileSync(join(dirty.path, "f.txt"), "utf8"), "changed");
});

test("arguments: --keep repeats, anything unknown is a usage error", () => {
  assert.deepEqual(parseArgs([]), { apply: false, keep: [] });
  assert.deepEqual(parseArgs(["--dry-run"]), { apply: false, keep: [] });
  assert.deepEqual(parseArgs(["--apply", "--keep", "agent-a", "--keep", "agent-b"]), { apply: true, keep: ["agent-a", "agent-b"] });
  for (const bad of [["--force"], ["-f"], ["--apply", "--dry-run"], ["--keep"], ["--keep", "--apply"], ["agent-a"], ["--apply", "--force"]]) {
    assert.throws(() => parseArgs(bad), /usage|either/, bad.join(" "));
  }
  const cli = spawnSync(process.execPath, [SCRIPT, "--apply", "--force"], { env, encoding: "utf8", cwd: tmpdir() });
  assert.equal(cli.status, 2);
});
