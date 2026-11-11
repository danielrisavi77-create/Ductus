// The real sync.mjs against a local bare repository as the remote: merge, push,
// conflict, a merge that fails without a conflict, a rejected push and a
// single-branch clone. `gh` is answered by fake-gh-git-preload.mjs; no network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
function setup(t, { cloneArgs = [], mainFile = "main.txt" } = {}) {
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
  write(seed, mainFile, "main\n", "main moves");
  git(seed, "push", "-q", remote, "main");
  const head = git(work, "rev-parse", "HEAD");
  const sync = () => {
    const routes = join(root, "routes.json");
    writeFileSync(routes, JSON.stringify({ "repos/{owner}/{repo}/pulls/7": {
      number: 7, state: "open", mergeable: true, head: { sha: head, ref: BRANCH, repo: { full_name: "o/r" } },
      base: { ref: "main", repo: { full_name: "o/r" } },
    } }));
    const env = { ...base, FAKE_GH_ROUTES: routes, NODE_OPTIONS: `--import ${PRELOAD}` };
    const r = spawnSync(process.execPath, [SCRIPT, "7", "--wait-min", "0"], { cwd: work, env, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
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
    // The fake gh has no routes for preflight, so it ends with a read error on the head it was given.
    assert.ok(res.out.includes(`SYNC NOT READY: preflight exit 2 on ${head}`), res.out);
    assert.equal(res.code, 2);
  });
}

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
