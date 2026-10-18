// DAN-213 (#421): SessionStart worktree cleanup that can never take an active worktree.
// A worktree goes only when ALL hold: it lies directly in <root>/.claude/worktrees/agent-* or
// <parent of root>/Ductus-worktrees/*, is not locked, not the current directory, has no changes,
// untracked files or operation in progress, its branch has commits of its own (not reachable from
// origin/main), and a MERGED pull request for that branch has headRefOid equal to HEAD, merged at
// least MIN_MERGED_AGE_MS ago, with no OPEN pull request on the same branch name. Anything unknown
// (failed fetch, gh, git) means keep. Never --force; the local branch is deleted only after its
// worktree is gone and while it still points at the merged head. No `git worktree prune`.
// Usage: node session-worktree-clean.mjs [--dry-run]. Always exits 0 (fail-open hook).
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_MERGED_AGE_MS = 2 * 60 * 60 * 1000;
const SHA_RE = /^[0-9a-f]{40,64}$/;
const REPO_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/i;
const IN_PROGRESS = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"];
const fold = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
};
const samePath = (a, b) => fold(a) === fold(b);
const insideOrSame = (child, parent) => samePath(child, parent) || fold(child).startsWith(fold(parent) + sep);

/** True only for a direct child agent-* of <root>/.claude/worktrees or any direct child of <parent>/Ductus-worktrees. */
export function inScope(root, path) {
  const dir = dirname(path);
  if (samePath(dir, join(root, ".claude", "worktrees"))) return /^agent-.+$/.test(basename(path));
  return samePath(dir, join(dirname(root), "Ductus-worktrees"));
}

/**
 * Pure decision. facts: {inScope, locked, current, branch, head, dirty, inProgress,
 * ownCommits (number|null), prs ([{state, headRefOid, mergedAt}]|null), now (ms)}.
 * Returns {remove: boolean, reason: string}.
 */
export function decide(f) {
  const keep = (reason) => ({ remove: false, reason });
  if (!f.inScope) return keep("outside .claude/worktrees/agent-* and ../Ductus-worktrees/");
  if (f.locked) return keep("locked");
  if (f.current) return keep("current directory");
  if (!f.branch) return keep("detached HEAD");
  if (!SHA_RE.test(f.head ?? "")) return keep("HEAD unreadable");
  if (f.dirty !== false) return keep("uncommitted or untracked changes (or status unreadable)");
  if (f.inProgress) return keep("rebase, merge or bisect in progress");
  if (!Number.isInteger(f.ownCommits) || f.ownCommits < 1) return keep("no commits of its own on top of origin/main");
  if (!Array.isArray(f.prs)) return keep("pull requests unreadable");
  if (f.prs.some((p) => p.state === "OPEN")) return keep("an open pull request uses this branch name");
  const merged = f.prs.find((p) => p.state === "MERGED" && p.headRefOid === f.head);
  if (!merged) return keep("no merged pull request with this exact HEAD");
  const at = Date.parse(merged.mergedAt ?? "");
  if (!Number.isFinite(at) || f.now - at < MIN_MERGED_AGE_MS) return keep("merged less than 2 hours ago");
  return { remove: true, reason: "merged pull request with this exact HEAD" };
}

export function defaultExec(cmd, args, { cwd } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_ENV.test(k)));
  const r = spawnSync(cmd, args, {
    cwd, encoding: "utf8", windowsHide: true, timeout: 60_000, env: { ...env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
  });
  return { ok: r.status === 0, out: String(r.stdout ?? "").trim() };
}

function listWorktrees(git, cwd) {
  const r = git(["worktree", "list", "--porcelain", "-z"], cwd);
  if (!r.ok) return null;
  return r.out.split("\0\0").filter(Boolean).map((rec) => {
    const fields = rec.split("\0").filter(Boolean);
    const value = (key) => fields.find((x) => x.startsWith(`${key} `))?.slice(key.length + 1);
    return {
      path: resolve(value("worktree") ?? ""),
      branch: value("branch")?.replace(/^refs\/heads\//, "") ?? "",
      locked: fields.some((x) => x === "locked" || x.startsWith("locked ")),
    };
  });
}

/** Gathers facts with git and gh, then acts on decide(). Returns [{path, branch, remove, reason, done}]. */
export function run({ cwd = process.cwd(), dryRun = false, exec = defaultExec, now = Date.now(), log = console.log } = {}) {
  const git = (args, dir) => exec("git", args, { cwd: dir });
  const all = listWorktrees(git, cwd);
  if (!all?.length) return [];
  const root = real(all[0].path);
  if (!git(["fetch", "origin", "--quiet"], root).ok) {
    log("worktree cleanup: fetch failed, nothing removed");
    return [];
  }
  const here = real(cwd);
  const results = [];
  for (const wt of all.slice(1)) {
    if (!existsSync(wt.path)) continue;
    const path = real(wt.path);
    const facts = { inScope: inScope(root, path), locked: wt.locked, current: insideOrSame(here, path), branch: wt.branch, now };
    if (facts.inScope && !facts.locked && !facts.current && facts.branch) {
      const rp = git(["rev-parse", "--absolute-git-dir", "HEAD"], path);
      const [gitDir = "", head = ""] = rp.ok ? rp.out.split("\n").map((s) => s.trim()) : [];
      facts.head = head;
      const st = git(["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"], path);
      facts.dirty = st.ok ? st.out !== "" : null;
      facts.inProgress = !gitDir || IN_PROGRESS.some((x) => existsSync(join(gitDir, x)));
      const own = git(["rev-list", "--count", `origin/main..${head}`], root);
      facts.ownCommits = own.ok && /^\d+$/.test(own.out) ? Number(own.out) : null;
      if (facts.ownCommits > 0) {
        const pr = exec("gh", ["pr", "list", "--head", wt.branch, "--state", "all", "--limit", "50", "--json", "state,headRefOid,mergedAt"], { cwd: root });
        try {
          facts.prs = pr.ok ? JSON.parse(pr.out) : null;
        } catch {
          facts.prs = null;
        }
      }
    }
    const d = decide(facts);
    const item = { path, branch: wt.branch, ...d, done: false };
    if (d.remove && !dryRun) {
      item.done = git(["worktree", "remove", path], root).ok && !existsSync(path);
      const tip = git(["rev-parse", "--verify", "--quiet", `refs/heads/${wt.branch}`], root);
      if (item.done && tip.ok && tip.out === facts.head) git(["branch", "-D", wt.branch], root);
    }
    if (d.remove) log(`worktree cleanup: ${dryRun ? "would remove" : item.done ? "removed" : "FAILED to remove"} ${path} [${wt.branch}]`);
    results.push(item);
  }
  return results;
}

if (process.argv[1] && samePath(real(process.argv[1]), fileURLToPath(import.meta.url))) {
  try {
    run({ dryRun: process.argv.includes("--dry-run") });
  } catch (e) {
    console.error(`worktree cleanup stopped: ${e.message}`);
  }
  process.exitCode = 0;
}
