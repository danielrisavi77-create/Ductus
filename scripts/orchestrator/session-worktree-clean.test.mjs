// DAN-213 (#421): SessionStart worktree cleanup keeps every worktree it cannot prove finished.
// Throwaway repositories only; gh is faked through the injected exec.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MIN_MERGED_AGE_MS, decide, defaultExec, inScope, run } from "./session-worktree-clean.mjs";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const OLD = new Date(NOW - MIN_MERGED_AGE_MS - 1000).toISOString();
const H = "a".repeat(40);
const base = {
  inScope: true, locked: false, current: false, branch: "platforma/x", head: H, dirty: false,
  inProgress: false, ownCommits: 2, prs: [{ state: "MERGED", headRefOid: H, mergedAt: OLD }], now: NOW,
};

test("decide removes only a clean, in-scope worktree whose HEAD is a merged PR head", () => {
  assert.deepEqual(decide(base), { remove: true, reason: "merged pull request with this exact HEAD" });
});

test("decide keeps every case it cannot prove finished", () => {
  const cases = {
    "fresh branch without own commits": { ownCommits: 0 },
    "own-commit count unreadable": { ownCommits: null },
    "reused branch name: merged PR has another head": { prs: [{ state: "MERGED", headRefOid: "b".repeat(40), mergedAt: OLD }] },
    "reused branch name with an open PR": { prs: [...base.prs, { state: "OPEN", headRefOid: "c".repeat(40) }] },
    "closed, not merged": { prs: [{ state: "CLOSED", headRefOid: H, mergedAt: null }] },
    "no PR": { prs: [] },
    "gh failed": { prs: null },
    "merged just now": { prs: [{ state: "MERGED", headRefOid: H, mergedAt: new Date(NOW - 60_000).toISOString() }] },
    "mergedAt missing": { prs: [{ state: "MERGED", headRefOid: H }] },
    "dirty tree": { dirty: true },
    "status unreadable": { dirty: null },
    "operation in progress": { inProgress: true },
    "out of scope": { inScope: false },
    locked: { locked: true },
    "current directory": { current: true },
    "detached HEAD": { branch: "" },
    "HEAD unreadable": { head: "" },
  };
  for (const [name, patch] of Object.entries(cases)) {
    assert.equal(decide({ ...base, ...patch }).remove, false, name);
  }
});

test("inScope accepts only agent-* under .claude/worktrees and children of ../Ductus-worktrees", () => {
  const root = join(tmpdir(), "p", "Ductus");
  assert.equal(inScope(root, join(root, ".claude", "worktrees", "agent-1")), true);
  assert.equal(inScope(root, join(root, ".claude", "worktrees", "mine")), false);
  assert.equal(inScope(root, join(root, ".claude", "worktrees", "agent-1", "nested")), false);
  assert.equal(inScope(root, join(tmpdir(), "p", "Ductus-worktrees", "claude-a-platforma-x")), true);
  assert.equal(inScope(root, join(tmpdir(), "p", "elsewhere", "agent-1")), false);
});

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("GIT_")));
Object.assign(env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" });
const git = (cwd, ...a) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...a], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function setup(t) {
  const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "sess-clean-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const remote = join(tmp, "remote.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  const work = join(tmp, "Ductus");
  git(tmp, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, "a.txt"), "a");
  git(work, "add", "a.txt");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  const prs = {};
  /** Worktree on a new branch from main; `commit` adds one commit of its own (a push is not needed). */
  const add = (dir, branch, { commit = true } = {}) => {
    const path = join(dir, branch.replaceAll("/", "-"));
    git(work, "worktree", "add", "-q", "-b", branch, path, "main");
    if (commit) {
      writeFileSync(join(path, `${branch.replaceAll("/", "-")}.txt`), branch);
      git(path, "add", ".");
      git(path, "commit", "-q", "-m", branch);
    }
    return { path, branch, head: git(path, "rev-parse", "HEAD") };
  };
  const exec = (cmd, args, opts) => {
    if (cmd !== "gh") return defaultExec(cmd, args, opts);
    const branch = args[args.indexOf("--head") + 1];
    const v = prs[branch];
    return v === undefined ? { ok: false, out: "" } : { ok: true, out: JSON.stringify(v) };
  };
  const clean = (opts = {}) => run({ cwd: work, exec, now: NOW, log: () => {}, ...opts });
  const agents = join(work, ".claude", "worktrees");
  const sibling = join(tmp, "Ductus-worktrees");
  return { work, remote, prs, add, clean, agents, sibling };
}

test("run removes only proven-finished worktrees and keeps a fresh or reused-name one", (t) => {
  const r = setup(t);
  const done = r.add(r.agents, "agent-done");
  const sib = r.add(r.sibling, "claude-a-platforma-done");
  const fresh = r.add(r.agents, "agent-fresh", { commit: false });
  const reused = r.add(r.agents, "agent-reused");
  const dirty = r.add(r.agents, "agent-dirty");
  writeFileSync(join(dirty.path, "wip.txt"), "wip");
  const outside = r.add(join(r.work, "..", "other"), "agent-outside");
  const merged = (w) => [{ state: "MERGED", headRefOid: w.head, mergedAt: OLD }];
  Object.assign(r.prs, {
    [done.branch]: merged(done), [sib.branch]: merged(sib), [fresh.branch]: merged(fresh),
    [reused.branch]: [{ state: "MERGED", headRefOid: "d".repeat(40), mergedAt: OLD }],
    [dirty.branch]: merged(dirty), [outside.branch]: merged(outside),
  });

  const dry = r.clean({ dryRun: true });
  assert.deepEqual(dry.filter((x) => x.remove).map((x) => x.branch).sort(), [done.branch, sib.branch].sort());
  assert.equal(existsSync(done.path), true, "dry run removes nothing");

  r.clean();
  for (const w of [done, sib]) {
    assert.equal(existsSync(w.path), false, w.branch);
    assert.equal(git(r.work, "branch", "--list", w.branch), "", `${w.branch} local branch deleted`);
  }
  for (const w of [fresh, reused, dirty, outside]) {
    assert.equal(existsSync(w.path), true, w.branch);
    assert.match(git(r.work, "branch", "--list", w.branch), /\S/, `${w.branch} branch kept`);
  }
  assert.equal(existsSync(join(dirty.path, "wip.txt")), true);
});

test("run keeps everything when gh fails, fetch fails, or it runs from inside the worktree", (t) => {
  const r = setup(t);
  const a = r.add(r.agents, "agent-a");
  assert.equal(r.clean().some((x) => x.done), false, "no PR data");
  r.prs[a.branch] = [{ state: "MERGED", headRefOid: a.head, mergedAt: OLD }];
  assert.equal(r.clean({ cwd: a.path }).some((x) => x.done), false, "current directory");
  git(r.work, "remote", "set-url", "origin", join(r.work, "missing.git"));
  assert.deepEqual(r.clean(), [], "fetch failed");
  assert.equal(existsSync(a.path), true);
});
