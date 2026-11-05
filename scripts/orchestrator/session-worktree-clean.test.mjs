// DAN-213 (#421): SessionStart worktree cleanup keeps every worktree it cannot prove finished.
// Throwaway repositories only; gh is faked through the injected exec.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MIN_MERGED_AGE_MS, decide, defaultExec, githubRepo, hookOutput, inScope, main, run, unsafePaths,
} from "./session-worktree-clean.mjs";

// rmSync in Node 24 throws EPERM at once on Windows and ignores maxRetries (#1141),
// so a directory a finished child still holds for a moment is retried here, bounded.
function removeDir(dir, deadlineMs = 10000) {
  const start = Date.now();
  for (;;) {
    try { return rmSync(dir, { recursive: true, force: true }); } catch (error) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code) || Date.now() - start >= deadlineMs) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

const NOW = Date.parse("2026-10-18T12:00:00Z");
const OLD = new Date(NOW - MIN_MERGED_AGE_MS - 1000).toISOString();
const H = "a".repeat(40);
const base = {
  inScope: true, linked: false, locked: false, current: false, branch: "platforma/x", head: H, dirty: false,
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
    "symlink or junction": { linked: true },
    "link status unknown": { linked: undefined },
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

test("unsafePaths lets only regenerable ignored paths through (#374 invariant)", () => {
  const regenerable = ["!! node_modules/", "!! apps/web/node_modules/", "!! .next/", "!! playwright-report-login/",
    "!! test-results/", "!! tsconfig.tsbuildinfo", "!! next-env.d.ts", "!! .DS_Store"];
  assert.deepEqual(unsafePaths(regenerable.join("\n")), []);
  for (const line of ["!! .env.local", "!! .env", "!! reports/", "!! .netlify/", "!! src/node_modules.txt",
    "?? note.txt", " M a.txt", "A  b.txt"]) {
    assert.deepEqual(unsafePaths(`!! node_modules/\n${line}\n`), [line], line);
  }
});

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith("GIT_")));
Object.assign(env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" });
const git = (cwd, ...a) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=", ...a], { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function setup(t) {
  const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "sess-clean-")));
  t.after(() => removeDir(tmp));
  const remote = join(tmp, "remote.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  const work = join(tmp, "Ductus");
  git(tmp, "init", "-q", "-b", "main", work);
  writeFileSync(join(work, "a.txt"), "a");
  writeFileSync(join(work, ".gitignore"), "node_modules/\n.next/\n.env.*\n*.tsbuildinfo\nreports/\n");
  git(work, "add", "a.txt", ".gitignore");
  git(work, "commit", "-q", "-m", "init");
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "-q", "-u", "origin", "main");
  // origin is written as a GitHub URL (the script derives --repo from it) and rewritten to the local remote for fetch.
  git(work, "config", `url.${remote.replaceAll("\\", "/")}.insteadOf`, "https://github.com/acme/Ductus.git");
  git(work, "remote", "set-url", "origin", "https://github.com/acme/Ductus.git");
  const prs = {};
  const hooks = {}; // hooks[name](args) runs just before a git call whose first argument is `name`
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
  const calls = [];
  const exec = (cmd, args, opts) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd !== "gh") {
      hooks[args[0]]?.(args);
      return defaultExec(cmd, args, opts);
    }
    if (args[args.indexOf("--repo") + 1] !== "acme/Ductus") return { ok: false, out: "" };
    const branch = args[args.indexOf("--head") + 1];
    const v = prs[branch];
    return v === undefined ? { ok: false, out: "" } : { ok: true, out: JSON.stringify(v) };
  };
  const clean = (opts = {}) => run({ cwd: work, exec, now: NOW, log: () => {}, ...opts });
  const agents = join(work, ".claude", "worktrees");
  const sibling = join(tmp, "Ductus-worktrees");
  return { work, remote, prs, hooks, calls, add, clean, agents, sibling, exec };
}

test("githubRepo reads owner/name from https and ssh GitHub URLs only", () => {
  assert.equal(githubRepo("https://github.com/acme/Ductus.git"), "acme/Ductus");
  assert.equal(githubRepo("git@github.com:acme/Ductus.git\n"), "acme/Ductus");
  assert.equal(githubRepo("ssh://git@github.com/acme/Ductus"), "acme/Ductus");
  for (const u of ["https://gitlab.com/acme/Ductus.git", "/tmp/remote.git", "https://github.com/acme", ""]) {
    assert.equal(githubRepo(u), null, u);
  }
});

test("defaultExec drops an inherited GH_REPO and GH_HOST", (t) => {
  const prev = { GH_REPO: process.env.GH_REPO, GH_HOST: process.env.GH_HOST };
  Object.assign(process.env, { GH_REPO: "someone/fork", GH_HOST: "example.invalid" });
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const r = defaultExec(process.execPath, ["-e", "console.log(`${process.env.GH_REPO ?? 'none'} ${process.env.GH_HOST ?? 'none'}`)"]);
  assert.equal(r.out, "none none");
});

test("review #425: a link at a registered path is never listed; an inherited GH_REPO is not asked", (t) => {
  const r = setup(t);
  const merged = (w) => [{ state: "MERGED", headRefOid: w.head, mergedAt: OLD }];
  // A registered worktree whose directory was replaced by a junction to another clean worktree with an open PR.
  const target = r.add(r.agents, "agent-target");
  const gone = r.add(r.agents, "agent-gone");
  rmSync(gone.path, { recursive: true, force: true });
  symlinkSync(target.path, gone.path, "junction");
  const plain = r.add(r.agents, "agent-plain");
  Object.assign(r.prs, {
    [target.branch]: [{ state: "OPEN", headRefOid: target.head }], [gone.branch]: merged(gone), [plain.branch]: merged(plain),
  });
  const prevRepo = process.env.GH_REPO;
  process.env.GH_REPO = "someone/Ductus-fork";
  t.after(() => (prevRepo === undefined ? delete process.env.GH_REPO : (process.env.GH_REPO = prevRepo)));

  const res = r.clean();
  const by = Object.fromEntries(res.map((x) => [x.branch, x]));
  assert.match(by[gone.branch].reason, /symlink, junction/);
  assert.equal(by[target.branch].remove, false);
  assert.equal(by[plain.branch].remove, true, "listed through --repo acme/Ductus despite GH_REPO");
});

test("run only reports: it lists proven-finished worktrees and never removes or deletes anything", (t) => {
  const r = setup(t);
  const done = r.add(r.agents, "agent-done");
  const sib = r.add(r.sibling, "claude-a-platforma-done");
  const fresh = r.add(r.agents, "agent-fresh", { commit: false });
  const reused = r.add(r.agents, "agent-reused");
  const dirty = r.add(r.agents, "agent-dirty");
  writeFileSync(join(dirty.path, "wip.txt"), "wip");
  const outside = r.add(join(r.work, "..", "other"), "agent-outside");
  // Only regenerable ignored paths: still listed.
  mkdirSync(join(done.path, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(done.path, "node_modules", "pkg", "index.js"), "x");
  writeFileSync(join(done.path, "tsconfig.tsbuildinfo"), "x");
  // Ignored but not regenerable: not listed.
  const envLocal = r.add(r.agents, "agent-envlocal");
  writeFileSync(join(envLocal.path, ".env.local"), "LOCAL_ONLY=1");
  const report = r.add(r.agents, "agent-report");
  mkdirSync(join(report.path, "reports"));
  writeFileSync(join(report.path, "reports", "out.txt"), "r");
  const merged = (w) => [{ state: "MERGED", headRefOid: w.head, mergedAt: OLD }];
  Object.assign(r.prs, {
    [done.branch]: merged(done), [sib.branch]: merged(sib), [fresh.branch]: merged(fresh),
    [reused.branch]: [{ state: "MERGED", headRefOid: "d".repeat(40), mergedAt: OLD }],
    [dirty.branch]: merged(dirty), [outside.branch]: merged(outside),
    [envLocal.branch]: merged(envLocal), [report.branch]: merged(report),
  });

  const lines = [];
  const res = r.clean({ log: (l) => lines.push(l) });
  assert.deepEqual(res.filter((x) => x.remove).map((x) => x.branch).sort(), [done.branch, sib.branch].sort());
  assert.equal(lines.filter((l) => l.includes("safe to remove by hand")).length, 2);
  // Owner decision 18 Oct (#425): report only. Every worktree and branch is still there.
  for (const w of [done, sib, fresh, reused, dirty, outside, envLocal, report]) {
    assert.equal(existsSync(w.path), true, w.branch);
    assert.match(git(r.work, "branch", "--list", w.branch), /\S/, `${w.branch} branch kept`);
  }
  assert.equal(existsSync(join(done.path, "node_modules", "pkg", "index.js")), true);
  const writes = r.calls.filter((c) => /^git (worktree (remove|prune)|branch -[dD]|update-ref|push)/.test(c));
  assert.deepEqual(writes, [], "no removing or deleting git command is ever run");
  assert.equal(existsSync(join(dirty.path, "wip.txt")), true);
  assert.equal(existsSync(join(envLocal.path, ".env.local")), true);
  assert.equal(existsSync(join(report.path, "reports", "out.txt")), true);
});

test("run lists nothing when gh fails, fetch fails, or it runs from inside the worktree", (t) => {
  const r = setup(t);
  const a = r.add(r.agents, "agent-a");
  assert.equal(r.clean().some((x) => x.remove), false, "no PR data");
  r.prs[a.branch] = [{ state: "MERGED", headRefOid: a.head, mergedAt: OLD }];
  assert.equal(r.clean({ cwd: a.path }).some((x) => x.remove), false, "current directory");
  assert.equal(r.clean().some((x) => x.remove), true, "listed once the PR data is there");
  git(r.work, "remote", "set-url", "origin", join(r.work, "missing.git"));
  assert.deepEqual(r.clean(), [], "fetch failed");
  assert.equal(existsSync(a.path), true);
});

test("#435: the whole run keeps to one time budget and lists nothing it could not finish checking", (t) => {
  const r = setup(t);
  const wts = ["agent-t1", "agent-t2", "agent-t3", "agent-t4"].map((b) => r.add(r.agents, b));
  for (const w of wts) r.prs[w.branch] = [{ state: "MERGED", headRefOid: w.head, mergedAt: OLD }];
  // Fake clock: only gh costs time (55 s each); a call longer than its timeout is cut and fails.
  let now = 0;
  const timeouts = [];
  const exec = (cmd, args, opts) => {
    timeouts.push({ timeout: opts.timeout, left: 150_000 - now });
    if (cmd !== "gh") return r.exec(cmd, args, opts);
    if (55_000 > opts.timeout) {
      now += opts.timeout;
      return { ok: false, out: "" };
    }
    now += 55_000;
    return r.exec(cmd, args, opts);
  };
  const lines = [];
  const res = run({ cwd: r.work, exec, now: NOW, clock: () => now, budgetMs: 150_000, log: (l) => lines.push(l) });
  assert.ok(now <= 150_000, `run used ${now} ms of a 150000 ms budget`);
  for (const x of timeouts) assert.ok(x.timeout <= 60_000 && x.timeout <= x.left, JSON.stringify(x));
  assert.equal(res.filter((x) => x.remove).length, 2, "the two worktrees checked in time are listed");
  assert.equal(res.length, 3, "the fourth worktree is not even started");
  assert.equal(res[2].remove, false, "the worktree whose gh call was cut is not listed");
  assert.match(lines.at(-1), /stopped after 150 s, the list is incomplete/);
  for (const w of wts) assert.equal(existsSync(w.path), true);
});

test("#435: defaultExec stops a call at the timeout it is given", () => {
  const start = Date.now();
  const r = defaultExec(process.execPath, ["-e", "setTimeout(() => console.log('late'), 20000)"], { timeout: 300 });
  assert.equal(r.ok, false);
  assert.equal(r.out, "");
  assert.ok(Date.now() - start < 10_000, "the child was stopped well before it finished");
});

test("#435: no call is started once the budget is spent", (t) => {
  const r = setup(t);
  r.add(r.agents, "agent-late");
  const res = run({ cwd: r.work, exec: r.exec, now: NOW, budgetMs: 0, log: () => {} });
  assert.deepEqual(res, []);
  assert.deepEqual(r.calls, []);
});

test("#435: hook output is one JSON line with additionalContext, and nothing when nothing is listed", () => {
  assert.equal(hookOutput([]), "");
  assert.equal(hookOutput(["worktree cleanup: fetch failed, nothing reported"]), "");
  const listed = "worktree cleanup: safe to remove by hand: /x/.claude/worktrees/agent-1 [agent-1]";
  const out = hookOutput([listed, "worktree cleanup: stopped after 150 s, the list is incomplete"]);
  assert.equal(out.endsWith("\n"), true);
  assert.equal(out.trimEnd().includes("\n"), false, "a single line");
  const json = JSON.parse(out);
  assert.deepEqual(Object.keys(json), ["hookSpecificOutput"]);
  assert.equal(json.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(json.hookSpecificOutput.additionalContext, /safe to remove by hand: \/x\/\.claude\/worktrees\/agent-1/);
  assert.match(json.hookSpecificOutput.additionalContext, /list is incomplete/);
});

test("#435: main writes the JSON line only with --hook and stays quiet when the run throws", () => {
  const listed = "worktree cleanup: safe to remove by hand: /x/agent-1 [agent-1]";
  const writes = [];
  const errors = [];
  const io = { write: (s) => writes.push(s), error: (s) => errors.push(s) };
  main(["--hook"], { ...io, runFn: ({ log }) => log(listed) });
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).hookSpecificOutput.additionalContext, listed);
  main(["--hook"], { ...io, runFn: () => [] });
  main(["--hook"], { ...io, runFn: () => { throw new Error("boom"); } });
  assert.equal(writes.length, 1, "nothing listed or a failed run writes nothing to stdout");
  assert.deepEqual(errors, ["worktree cleanup stopped: boom"]);
});
