// push-verify against a local bare repository as the remote. No network, no GitHub.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./push-verify.mjs", import.meta.url));
// Drop inherited GIT_* (set inside git hooks) so every command stays in the temp repos.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("GIT_")));
Object.assign(env, {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
});

const git = (cwd, ...a) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...a], { cwd, env, encoding: "utf8" }).trim();
const commit = (cwd, msg) => git(cwd, "commit", "-q", "--allow-empty", "-m", msg);
const pushVerify = (cwd, ...a) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd, env, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** Bare remote with `main`, plus a clone of it. */
function setup(t, cloneArgs = []) {
  const root = mkdtempSync(join(tmpdir(), "orch-push-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  const seed = join(root, "seed");
  git(root, "init", "-q", "-b", "main", seed);
  commit(seed, "init");
  git(seed, "push", "-q", remote, "main");
  const work = join(root, "work");
  git(root, "clone", "-q", ...cloneArgs, remote, work);
  const remoteSha = (branch) => git(remote, "rev-parse", "--verify", "-q", `refs/heads/${branch}`);
  const remoteHas = (branch) => git(remote, "for-each-ref", `refs/heads/${branch}`) !== "";
  return { root, remote, seed, work, remoteSha, remoteHas };
}

/** PR branch on the remote, checked out locally under another name (busy-worktree case). */
function otherName(r, { track }) {
  git(r.seed, "checkout", "-q", "-b", "pr/branch");
  commit(r.seed, "pr base");
  git(r.seed, "push", "-q", r.remote, "pr/branch");
  git(r.work, "fetch", "-q", "origin");
  git(r.work, "checkout", "-q", track ? "--track" : "--no-track", "-b", "local/other", "origin/pr/branch");
  commit(r.work, "local work");
  return git(r.work, "rev-parse", "HEAD");
}

test("local branch named differently: pushes to the upstream branch, not to a same-named one", (t) => {
  const r = setup(t);
  const head = otherName(r, { track: true });
  const res = pushVerify(r.work);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /target origin refs\/heads\/pr\/branch/);
  assert.equal(r.remoteSha("pr/branch"), head);
  assert.equal(r.remoteHas("local/other"), false);
});

test("no upstream and no --to: FAIL, nothing pushed", (t) => {
  const r = setup(t);
  const head = otherName(r, { track: false });
  const res = pushVerify(r.work);
  assert.notEqual(res.code, 0);
  assert.match(res.out, /FAIL: nothing pushed: no upstream set for local\/other; pass --to <branch>/);
  assert.doesNotMatch(res.out, /^OK/m);
  assert.notEqual(r.remoteSha("pr/branch"), head);
  assert.equal(r.remoteHas("local/other"), false);
});

test("--to pushes to the named branch and verifies it", (t) => {
  const r = setup(t);
  const head = otherName(r, { track: false });
  const res = pushVerify(r.work, "--to", "pr/branch");
  assert.equal(res.code, 0, res.out);
  assert.equal(r.remoteSha("pr/branch"), head);
  assert.equal(r.remoteHas("local/other"), false);
});

test("upstream pointing at main is refused", (t) => {
  const r = setup(t);
  git(r.work, "checkout", "-q", "--track", "-b", "feat/x", "origin/main");
  commit(r.work, "c");
  const before = r.remoteSha("main");
  const res = pushVerify(r.work);
  assert.notEqual(res.code, 0);
  assert.match(res.out, /upstream of feat\/x is main; pass --to <branch>/);
  assert.equal(r.remoteSha("main"), before);
  assert.notEqual(pushVerify(r.work, "--to", "main").code, 0);
  assert.equal(r.remoteSha("main"), before);
});

test("first push of a new branch is OK in a single-branch clone", (t) => {
  const r = setup(t, ["--single-branch", "-b", "main"]);
  git(r.work, "checkout", "-q", "-b", "feat/new");
  commit(r.work, "c");
  const res = pushVerify(r.work, "--to", "feat/new");
  assert.equal(res.code, 0, res.out);
  assert.equal(r.remoteSha("feat/new"), git(r.work, "rev-parse", "HEAD"));
});

test("first push is OK when another local ref is named like the remote-tracking ref", (t) => {
  const r = setup(t);
  git(r.work, "checkout", "-q", "-b", "feat/new");
  git(r.work, "tag", "origin/feat/new");
  commit(r.work, "c");
  const res = pushVerify(r.work, "origin", "feat/new");
  assert.equal(res.code, 0, res.out);
  assert.equal(r.remoteSha("feat/new"), git(r.work, "rev-parse", "HEAD"));
});

test("a non-fast-forward push is rejected and reported as FAIL", (t) => {
  const r = setup(t);
  otherName(r, { track: true });
  commit(r.seed, "someone else pushed");
  git(r.seed, "push", "-q", r.remote, "pr/branch");
  const theirs = r.remoteSha("pr/branch");
  const res = pushVerify(r.work);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /FAIL: push failed/);
  assert.equal(r.remoteSha("pr/branch"), theirs);
});

test("force, +refspec and branch deletion are refused before any push", (t) => {
  const r = setup(t);
  otherName(r, { track: true });
  commit(r.seed, "someone else pushed");
  git(r.seed, "push", "-q", r.remote, "pr/branch");
  const theirs = r.remoteSha("pr/branch");
  for (const args of [
    ["--force"], ["-f"], ["--force-with-lease"], ["origin", "--force"], ["--force", "--to", "pr/branch"],
    ["origin", "+HEAD:pr/branch"], ["origin", "+local/other:pr/branch"], ["--to", "+pr/branch"],
    ["origin", ":pr/branch"], ["origin", ":refs/heads/pr/branch"], ["--to", ":pr/branch"], ["origin", "--delete"],
    ["--to"], ["--to", ""], ["origin", "HEAD:pr/branch", "--to", "pr/branch"], ["--to", "refs/tags/v1"],
  ]) {
    const res = pushVerify(r.work, ...args);
    assert.equal(res.code, 2, `${args.join(" ")}\n${res.out}`);
    assert.match(res.out, /FAIL: nothing pushed/, args.join(" "));
    assert.equal(r.remoteSha("pr/branch"), theirs, args.join(" "));
    assert.equal(r.remoteHas("local/other"), false, args.join(" "));
  }
});
