// The real sync.mjs against a local bare repository as the remote: merge, push,
// conflict, a merge that fails without a conflict, a rejected push, a single-branch
// clone, a tree dirty under hostile git config, a local head that moves while
// CI is awaited, merge options set on the branch, pull.twohead, a local ref named
// origin/main and every state after the merge. `gh` is answered by fake-gh-git-preload.mjs; no network.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mergeCheck, readMergeState, STATUS_ARGS } from "./sync-core.mjs";

const SCRIPT = fileURLToPath(new URL("./sync.mjs", import.meta.url));
const PRELOAD = new URL("./fake-gh-git-preload.mjs", import.meta.url).href;
const BRANCH = "pr/x";
// Drop inherited GIT_* (set inside git hooks) so every command stays in the temp repos,
// and the work contract of the calling session, which is about the real repository.
const base = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !k.toUpperCase().startsWith("GIT_") && !k.startsWith("DUCTUS_WORK_")));
Object.assign(base, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1",
});
const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: base, encoding: "utf8" }).trim();
const write = (cwd, file, text, msg) => {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", msg);
};

/** Remote with main and the PR branch, a clone on the PR branch, then main moves on. */
function setup(t, { cloneArgs = [], mainFile = "main.txt", mainMoves = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "orch-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  const seed = join(root, "seed");
  git(root, "init", "-q", "-b", "main", seed);
  write(seed, "base.txt", "base\n", "init");
  git(seed, "push", "-q", remote, "main");
  git(seed, "checkout", "-q", "-b", BRANCH);
  write(seed, "pr.txt", "pr\n", "pr work");
  git(seed, "push", "-q", remote, BRANCH);
  const work = join(root, "work");
  git(root, "clone", "-q", "--branch", BRANCH, ...cloneArgs, remote, work);
  git(seed, "checkout", "-q", "main");
  if (mainMoves) {
    write(seed, mainFile, "main\n", "main moves");
    git(seed, "push", "-q", remote, "main");
  }
  const head = git(work, "rev-parse", "HEAD");
  const argvLog = join(root, "argv.jsonl");
  const sync = ({ waitMin = 0, routes = {}, env = {} } = {}) => {
    const file = join(root, "routes.json");
    writeFileSync(file, JSON.stringify({ "repos/{owner}/{repo}/pulls/7": {
      number: 7, state: "open", mergeable: true, head: { sha: head, ref: BRANCH, repo: { full_name: "o/r" } },
      base: { ref: "main", repo: { full_name: "o/r" } },
    }, ...routes }));
    rmSync(argvLog, { force: true });
    const all = { ...base, FAKE_GH_ROUTES: file, FAKE_GH_ARGV_LOG: argvLog, NODE_OPTIONS: `--import ${PRELOAD}`, ...env };
    const r = spawnSync(process.execPath, [SCRIPT, "7", "--wait-min", String(waitMin)], { cwd: work, env: all, encoding: "utf8" });
    // Arguments of every script the run started, sync.mjs itself included.
    const calls = existsSync(argvLog) ? readFileSync(argvLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    const preflight = calls.filter((c) => c[0].endsWith("preflight.mjs")).map((c) => c.slice(1));
    return { code: r.status, out: `${r.stdout}${r.stderr}`, calls, preflight };
  };
  return { remote, seed, work, head, sync, remoteSha: () => git(remote, "rev-parse", `refs/heads/${BRANCH}`) };
}

const untouched = (r) => {
  assert.equal(git(r.work, "rev-parse", "HEAD"), r.head);
  assert.equal(r.remoteSha(), r.head);
  assert.equal(git(r.work, "status", "--porcelain"), "");
  assert.equal(existsSync(join(r.work, ".git", "MERGE_HEAD")), false);
};

for (const [name, cloneArgs] of [["full clone", []], ["single-branch clone", ["--single-branch"]]]) {
  test(`${name}: merges main, pushes the merge commit and hands that head to preflight`, (t) => {
    const r = setup(t, { cloneArgs });
    const res = r.sync();
    const head = git(r.work, "rev-parse", "HEAD");
    assert.notEqual(head, r.head);
    assert.equal(git(r.work, "rev-list", "--count", "HEAD..origin/main"), "0");
    assert.equal(git(r.work, "rev-parse", "HEAD^1"), r.head);
    assert.equal(r.remoteSha(), head, res.out);
    // preflight is started once, for the pushed merge head; the fake gh has no routes for
    // it, so it ends with a read error.
    assert.deepEqual(res.preflight, [["7", "--head", head]]);
    assert.ok(res.out.includes(`SYNC NOT READY: preflight exit 2 on ${head}`), res.out);
    assert.equal(res.code, 2);
  });
}

test("an untracked file stops the run even when git is configured to hide untracked files", (t) => {
  const r = setup(t);
  git(r.work, "config", "status.showUntrackedFiles", "no");
  writeFileSync(join(r.work, "scratch.txt"), "local only\n");
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /working tree has uncommitted changes/);
  assert.doesNotMatch(res.out, /preflight|SYNC/);
  assert.equal(git(r.work, "rev-parse", "HEAD"), r.head);
  assert.equal(r.remoteSha(), r.head);
  assert.equal(readFileSync(join(r.work, "scratch.txt"), "utf8"), "local only\n");
  assert.equal(existsSync(join(r.work, ".git", "MERGE_HEAD")), false);
  assert.deepEqual(res.calls.map((c) => c[0].endsWith("sync.mjs")), [true]);
});

test("conflict: the merge is aborted, the file is listed and nothing is pushed", (t) => {
  const r = setup(t, { mainFile: "pr.txt" });
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /CONFLICT: merge aborted, nothing changed/);
  assert.match(res.out, /^ {2}pr\.txt$/m);
  assert.doesNotMatch(res.out, /preflight|SYNC/);
  untouched(r);
});

test("a merge that fails without a conflict shows git's error, not CONFLICT", (t) => {
  const r = setup(t);
  git(r.seed, "checkout", "-q", "--orphan", "other");
  write(r.seed, "other.txt", "other\n", "unrelated root");
  git(r.seed, "push", "-q", "--force", r.remote, "other:main");
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /merge failed, nothing changed: [\s\S]*unrelated histories/);
  assert.doesNotMatch(res.out, /CONFLICT|preflight|SYNC/);
  untouched(r);
});

test("rejected push: reports that the merge commit is local only and skips preflight", (t) => {
  const r = setup(t);
  git(r.seed, "checkout", "-q", BRANCH);
  write(r.seed, "late.txt", "late\n", "someone else pushed");
  git(r.seed, "push", "-q", r.remote, BRANCH);
  const ahead = r.remoteSha();
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /push failed: the merge commit is local only/);
  assert.doesNotMatch(res.out, /preflight|SYNC|BLOCKED/);
  assert.equal(r.remoteSha(), ahead);
  assert.equal(git(r.work, "rev-parse", "HEAD^1"), r.head);
  assert.equal(git(r.work, "rev-list", "--count", "HEAD..origin/main"), "0");
});

// Every class of local change against hostile config: the command line has to win.
test("STATUS_ARGS sees uncommitted work whatever the git config says", (t) => {
  const root = mkdtempSync(join(tmpdir(), "orch-sync-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sub = join(root, "sub");
  git(root, "init", "-q", "-b", "main", sub);
  write(sub, "s.txt", "s\n", "sub init");
  let i = 0;
  const repo = () => {
    const dir = join(root, `r${(i += 1)}`);
    git(root, "init", "-q", "-b", "main", dir);
    write(dir, ".gitignore", "ignored.txt\n", "init");
    git(dir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
    git(dir, "commit", "-q", "-m", "add sub");
    return dir;
  };
  const cases = [
    ["clean", [], () => {}, false],
    ["clean with color.status=always", [["color.status", "always"]], () => {}, false],
    ["modified tracked file", [], (d) => writeFileSync(join(d, ".gitignore"), "x\n"), true],
    ["staged new file", [], (d) => { writeFileSync(join(d, "n.txt"), "n\n"); git(d, "add", "n.txt"); }, true],
    ["untracked file, showUntrackedFiles=no", [["status.showUntrackedFiles", "no"]],
      (d) => writeFileSync(join(d, "u.txt"), "u\n"), true],
    ["untracked file in a new directory, showUntrackedFiles=no", [["status.showUntrackedFiles", "no"]],
      (d) => { mkdirSync(join(d, "dir")); writeFileSync(join(d, "dir", "u.txt"), "u\n"); }, true],
    ["ignored file", [], (d) => writeFileSync(join(d, "ignored.txt"), "i\n"), false],
    ["submodule on a new commit, diff.ignoreSubmodules=all", [["diff.ignoreSubmodules", "all"]],
      (d) => write(join(d, "sub"), "s.txt", "moved\n", "sub moves"), true],
    ["submodule content changed, submodule.sub.ignore=all", [["submodule.sub.ignore", "all"]],
      (d) => writeFileSync(join(d, "sub", "s.txt"), "edited\n"), true],
  ];
  for (const [name, config, change, dirty] of cases) {
    const d = repo();
    for (const [k, v] of config) git(d, "config", k, v);
    change(d);
    assert.equal(git(d, ...STATUS_ARGS) !== "", dirty, name);
  }
});

/** gh routes for one CI wait on `head`: one green check; `run` executes when it is read. */
const waitRoutes = (head, run) => ({
  "repos/{owner}/{repo}": { owner: { login: "o" }, name: "r" },
  [`repos/{owner}/{repo}/commits/${head}/check-runs?per_page=100&page=1`]: {
    $run: run,
    $body: { check_runs: [{ name: "ci", status: "completed", conclusion: "success", app: { id: 1, slug: "github-actions" } }] },
  },
  [`repos/{owner}/{repo}/commits/${head}/statuses?per_page=100&page=1`]: [],
});

test("passing CI and preflight on an unchanged head: SYNC OK", (t) => {
  const r = setup(t, { mainMoves: false });
  const res = r.sync({ waitMin: 1, routes: waitRoutes(r.head, ["git", "status", "-s"]), env: { FAKE_PREFLIGHT_EXIT: "0" } });
  assert.equal(res.code, 0, res.out);
  assert.ok(res.out.includes(`SYNC OK: head ${r.head}`), res.out);
  assert.deepEqual(res.preflight, [["7", "--head", r.head]]);
});

for (const [name, run, moved] of [
  ["a local commit", ["git", "commit", "-q", "--allow-empty", "-m", "made while waiting"], /local head moved to [0-9a-f]{8}/],
  ["a switch to another branch", ["git", "checkout", "-q", "-b", "elsewhere"], /local branch moved to elsewhere/],
]) {
  test(`${name} while CI is awaited: passing CI and preflight are not a success`, (t) => {
    const r = setup(t, { mainMoves: false });
    const res = r.sync({ waitMin: 1, routes: waitRoutes(r.head, run), env: { FAKE_PREFLIGHT_EXIT: "0" } });
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, moved);
    assert.ok(res.out.includes(`CI and preflight cover ${r.head}`), res.out);
    assert.doesNotMatch(res.out, /SYNC OK/);
    assert.deepEqual(res.preflight, [["7", "--head", r.head]]);
    assert.equal(r.remoteSha(), r.head);
  });
}

// The command line beats --no-commit and --squash from the branch config, but not -s ours
// or -X ours, so any merge option set on the branch stops the run before the merge.
for (const option of ["--no-commit", "--squash", "-s ours", "-Xours"]) {
  test(`branch.<name>.mergeOptions=${option}: stops before the merge, nothing changes`, (t) => {
    const r = setup(t);
    git(r.work, "config", `branch.${BRANCH}.mergeOptions`, option);
    const res = r.sync();
    assert.equal(res.code, 1, res.out);
    assert.ok(res.out.includes(`branch.${BRANCH}.mergeOptions is set (${option})`), res.out);
    assert.doesNotMatch(res.out, /preflight|SYNC OK|CONFLICT/);
    assert.deepEqual(res.preflight, []);
    untouched(r);
  });
}

test("pull.twohead=ours does not choose the strategy: main's change is in the pushed merge", (t) => {
  const r = setup(t);
  // Without -s on the command line git merges with pull.twohead, and "ours" drops main.
  git(r.work, "config", "pull.twohead", "ours");
  const res = r.sync();
  const head = git(r.work, "rev-parse", "HEAD");
  assert.notEqual(head, r.head, res.out);
  assert.equal(git(r.work, "show", `${head}:main.txt`), "main", res.out);
  assert.equal(r.remoteSha(), head, res.out);
  assert.deepEqual(res.preflight, [["7", "--head", head]]);
});

for (const kind of ["branch", "tag"]) {
  test(`a local ${kind} named origin/main does not replace the fetched main`, (t) => {
    const r = setup(t);
    // refs/tags/ and refs/heads/ win over refs/remotes/ for the short name origin/main.
    git(r.work, kind, "origin/main", "HEAD~1");
    const res = r.sync();
    const head = git(r.work, "rev-parse", "HEAD");
    assert.notEqual(head, r.head, res.out);
    assert.equal(git(r.work, "show", `${head}:main.txt`), "main", res.out);
    assert.equal(r.remoteSha(), head, res.out);
    assert.deepEqual(res.preflight, [["7", "--head", head]]);
  });
}

test("a merge already in progress with a clean tree stops the run and is left as it was", (t) => {
  const r = setup(t);
  git(r.work, "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main");
  // -s ours --no-commit: MERGE_HEAD is present and the tree still equals HEAD.
  git(r.work, "merge", "-q", "-s", "ours", "--no-commit", "origin/main");
  const pending = git(r.work, "rev-parse", "MERGE_HEAD");
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.ok(res.out.includes("a merge is already in progress"), res.out);
  assert.doesNotMatch(res.out, /preflight|SYNC OK|CONFLICT/);
  assert.deepEqual(res.preflight, []);
  assert.equal(git(r.work, "rev-parse", "MERGE_HEAD"), pending);
  assert.equal(git(r.work, "rev-parse", "HEAD"), r.head);
  assert.equal(r.remoteSha(), r.head);
});

test("a merge that ends without main in HEAD is not pushed", (t) => {
  const r = setup(t);
  // A post-merge hook takes the merge commit back: git exits 0, HEAD lacks main.
  const hooks = join(r.work, ".git", "test-hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "post-merge"), `#!/bin/sh\ngit checkout -q -B ${BRANCH} HEAD~1\n`);
  chmodSync(join(hooks, "post-merge"), 0o755);
  git(r.work, "config", "core.hooksPath", hooks);
  const res = r.sync();
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /SYNC STOPPED: HEAD does not contain the fetched main [0-9a-f]{8}; nothing pushed/);
  assert.doesNotMatch(res.out, /preflight|SYNC OK/);
  assert.deepEqual(res.preflight, []);
  untouched(r);
});

// The same reads orch:sync makes, over real repositories in each state after the merge step.
test("readMergeState and mergeCheck over real states after the merge", async (t) => {
  const tryGit = (cwd) => (...a) => new Promise((resolve) => {
    execFile("git", a, { cwd, env: base, encoding: "utf8" }, (e, out) => resolve(e ? null : out.trim()));
  });
  const states = [
    ["(a) concluded merge", true, ["merge", "-q", "--no-edit", "origin/main"], null],
    ["(b) unconcluded merge, MERGE_HEAD present", true, ["merge", "-q", "--no-commit", "--no-ff", "origin/main"], /MERGE_HEAD/],
    ["(c) HEAD without main (squash, no commit)", true, ["merge", "-q", "--squash", "origin/main"], /does not contain the fetched main/],
    ["(d) already up to date", false, null, null],
  ];
  for (const [name, mainMoves, merge, want] of states) {
    const r = setup(t, { mainMoves });
    git(r.work, "fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main");
    const main = git(r.work, "rev-parse", "refs/remotes/origin/main");
    const containedBefore = git(r.work, "rev-list", "--count", `HEAD..${main}`) === "0";
    if (merge) git(r.work, ...merge);
    const got = mergeCheck(await readMergeState(tryGit(r.work), { before: r.head, main, containedBefore }));
    if (want === null) assert.equal(got, null, name);
    else assert.match(String(got), want, name);
  }
});
