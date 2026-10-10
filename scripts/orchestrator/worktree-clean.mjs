// Removes finished subagent worktrees under <main checkout>/.claude/worktrees/agent-*.
// Default is a dry run; only --apply removes. Never --force, never deletes a branch;
// worktrees are only ever removed under that directory.
// The closing `git worktree prune` acts on the whole repository, not only on agent-*: it drops the
// registration of every unlocked worktree whose directory is missing (e.g. on an unplugged disk).
// A dry run lists these first as "would prune".
// Usage: node worktree-clean.mjs [--dry-run | --apply] [--keep <name>]...
// Exit: 0 ok, 1 fetch or removal failure, 2 usage or path-guard error.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const AGENT_RE = /^agent-.+$/;
const SHA_RE = /^[0-9a-f]{40,64}$/;
// Inherited repository-location variables (set inside git hooks) would point every git call elsewhere.
const REPO_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/i;
const IN_PROGRESS = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"];

export class GuardError extends Error {}

const lstat = (p) => lstatSync(p, { throwIfNoEntry: false });
const fold = (p) => (WIN ? resolve(p).toLowerCase() : resolve(p));
const samePath = (a, b) => fold(a) === fold(b);
const inside = (child, parent) => samePath(child, parent) || fold(child).startsWith(fold(parent) + sep);
const firstLine = (s) => String(s ?? "").trim().split("\n")[0].trim();
const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
};

/** No shell: the argument array reaches the program as is. */
export function defaultExec(cmd, args, { cwd, env } = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_ENV.test(k)));
  const r = spawnSync(cmd, args, {
    cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 600_000,
    env: { ...clean, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  return { ok: r.status === 0, out: r.stdout ?? "", err: String(r.stderr ?? "").trim() || r.error?.message || "" };
}

/**
 * Last check before every deletion: `target` is a real directory (no symlink,
 * no junction) named agent-* whose resolved path is exactly
 * <real root>/.claude/worktrees/<name>. Throws GuardError otherwise.
 */
export function assertDeletable(root, target) {
  const name = basename(target);
  const st = lstat(target);
  const expected = join(realpathSync.native(root), ".claude", "worktrees", name);
  const actual = real(target);
  if (!AGENT_RE.test(name) || !st?.isDirectory() || !actual || !samePath(actual, expected)) {
    throw new GuardError(`path guard: refusing to delete ${target}`);
  }
}

function unlinkLinks(dir) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isSymbolicLink()) unlinkSync(join(dir, d.name));
    else if (d.isDirectory()) unlinkLinks(join(dir, d.name));
  }
}

/**
 * Recursive delete that never follows a link: links inside the tree are
 * unlinked first, then the tree goes (PowerShell on Windows, where long paths
 * in node_modules defeat other tools). The path travels in the environment,
 * so nothing in it is ever parsed as PowerShell syntax.
 */
export function removeTree(path, exec = defaultExec) {
  unlinkLinks(path);
  if (!WIN) return rmSync(path, { recursive: true, force: true });
  const r = exec("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Remove-Item -LiteralPath $env:ORCH_CLEAN_TARGET -Recurse -Force -ErrorAction Stop",
  ], { env: { ORCH_CLEAN_TARGET: path } });
  // PowerShell hard-wraps its error text; rejoin it and keep the start.
  if (!r.ok) throw new Error(r.err.replace(/\r?\n/g, "").slice(0, 240) || "Remove-Item failed");
  return undefined;
}

function listWorktrees(git, cwd) {
  const r = git(["worktree", "list", "--porcelain", "-z"], cwd);
  if (!r.ok) throw new Error(`git worktree list failed: ${r.err}`);
  return r.out.split("\0\0").filter(Boolean).map((rec) => {
    const fields = rec.split("\0").filter(Boolean);
    const value = (key) => fields.find((f) => f.startsWith(`${key} `))?.slice(key.length + 1);
    const given = resolve(value("worktree"));
    // `given` is what git knows; `path` is the resolved location every check and deletion uses.
    return { given, path: real(given) ?? given, locked: fields.some((f) => f === "locked" || f.startsWith("locked ")) };
  });
}

/**
 * opts: {cwd, apply, keep: string[], exec, removeDir, log}. Returns
 * {code, removed: [name], skipped: [{name, reason}], failed: [{name, reason}]}.
 * Throws GuardError when a path about to be deleted fails the guard.
 */
export function clean({
  cwd = process.cwd(), apply = false, keep = [], exec = defaultExec, removeDir = removeTree, log = console.log,
} = {}) {
  const git = (args, dir) => exec("git", args, { cwd: dir });
  const root = realpathSync.native(listWorktrees(git, cwd)[0].path);
  const base = join(root, ".claude", "worktrees");
  const here = real(cwd) ?? resolve(cwd);
  const res = { code: 0, removed: [], skipped: [], failed: [] };
  const say = (verb, name, text) => log(`${verb.padEnd(12)} ${name}  ${text}`);
  const NOT_AGENT = "name is not agent-*"; // out of scope: counted in the summary, not listed
  const skip = (name, reason) => (res.skipped.push({ name, reason }), reason === NOT_AGENT || say("skip", name, reason));
  const fail = (name, reason) => (res.failed.push({ name, reason }), say("FAILED", name, reason));
  const done = (name, what) => (res.removed.push(name), say(apply ? "removed" : "would remove", name, what));
  log(`root ${root}${apply ? "" : " (dry run)"}`);

  const fetch = git(["fetch", "origin"], root);
  if (!fetch.ok) {
    log(`FAILED: git fetch origin: ${firstLine(fetch.err)}`);
    log("nothing removed: without a fetch, HEAD on origin cannot be confirmed");
    return { ...res, code: 1 };
  }
  if (lstat(base) && !samePath(real(base) ?? "", base)) throw new GuardError(`path guard: ${base} is a link`);
  const registered = () => listWorktrees(git, root).slice(1);
  const isRegistered = (p) => registered().some((w) => samePath(w.given, p) || samePath(w.path, real(p) ?? p));

  const skipReason = (wt, name) => {
    if (keep.includes(name)) return "kept (--keep)";
    if (wt.locked) return "locked";
    const st = lstat(wt.path);
    if (!st) return "directory missing (git worktree prune drops the registration)";
    if (!st.isDirectory()) return "symlink or junction, not followed";
    if (inside(here, wt.path)) return "current directory";
    const rp = git(["rev-parse", "--show-toplevel", "--absolute-git-dir", "HEAD"], wt.path);
    const [top = "", gitDir = "", head = ""] = rp.out.split("\n").map((s) => s.trim());
    if (!rp.ok || !SHA_RE.test(head) || !samePath(real(top) ?? "", wt.path)) return "not a readable worktree";
    const status = git(["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"], wt.path);
    if (!status.ok) return "git status failed";
    const lines = status.out.split("\n").filter(Boolean);
    if (lines.some((l) => !l.startsWith("??"))) return "uncommitted changes";
    if (lines.length) return "untracked files";
    if (IN_PROGRESS.some((f) => existsSync(join(gitDir, f)))) return "rebase, merge or bisect in progress";
    const on = git(["for-each-ref", "--count=1", "--contains", head, "refs/remotes/origin/"], root);
    if (!on.ok || !on.out.trim()) return "HEAD not on any origin branch";
    return null;
  };

  /** Second step: a leftover or orphan directory that is unregistered and has no .git. */
  const deleteDir = (name, path, what) => {
    if (!lstat(path)) return done(name, what);
    if (isRegistered(path)) return fail(name, "still registered, directory left in place");
    if (lstat(join(path, ".git"))) return fail(name, "unregistered but .git present, directory left in place");
    assertDeletable(root, path);
    try {
      removeDir(path);
    } catch (e) {
      return fail(name, `directory could not be deleted: ${firstLine(e.message)}`);
    }
    return lstat(path) ? fail(name, "directory still exists after deletion") : done(name, what);
  };

  const seen = new Set();
  for (const wt of registered().filter((w) => samePath(dirname(w.path), base))) {
    const name = basename(wt.path);
    seen.add(fold(wt.path));
    const reason = AGENT_RE.test(name) ? skipReason(wt, name) : NOT_AGENT;
    if (reason) skip(name, reason);
    else if (!apply) done(name, "clean worktree, HEAD on origin");
    else {
      assertDeletable(root, wt.path);
      const rm = git(["worktree", "remove", wt.given], root);
      if (isRegistered(wt.path)) fail(name, `git worktree remove: ${firstLine(rm.err) || "still registered"}`);
      else deleteDir(name, wt.path, "worktree");
    }
  }
  for (const d of lstat(base) ? readdirSync(base, { withFileTypes: true }) : []) {
    const path = join(base, d.name);
    if (seen.has(fold(path))) continue;
    if (!AGENT_RE.test(d.name)) skip(d.name, NOT_AGENT);
    else if (keep.includes(d.name)) skip(d.name, "kept (--keep)");
    else if (d.isSymbolicLink()) skip(d.name, "symlink or junction, not followed");
    else if (!d.isDirectory()) skip(d.name, "not a directory");
    else if (lstat(join(path, ".git")) || isRegistered(path)) skip(d.name, "not registered here but has .git");
    else if (inside(here, real(path) ?? path)) skip(d.name, "current directory");
    else if (!apply) done(d.name, "orphan directory (not registered, no .git)");
    else deleteDir(d.name, path, "orphan directory");
  }

  // Prune drops registrations whose directory is gone, wherever it was; the dry run shows which.
  const prune = git(["worktree", "prune", ...(apply ? [] : ["--dry-run", "--verbose"])], root);
  if (!prune.ok) fail("git worktree prune", firstLine(prune.err));
  else if (!apply) for (const l of `${prune.out}\n${prune.err}`.split("\n").filter((x) => x.trim())) log(`would prune   ${l.trim()}`);
  const by = {};
  for (const s of res.skipped) by[s.reason] = (by[s.reason] ?? 0) + 1;
  const reasons = Object.entries(by).map(([r, n]) => `${r}: ${n}`).join("; ");
  log(`summary: ${apply ? "removed" : "would remove"} ${res.removed.length}, failed ${res.failed.length}, skipped ${res.skipped.length}${reasons ? ` (${reasons})` : ""}`);
  if (!apply) log("dry run: nothing was removed; pass --apply to remove");
  return { ...res, code: res.failed.length ? 1 : 0 };
}

export function parseArgs(argv) {
  const opts = { apply: false, keep: [] };
  let dry = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") opts.apply = true;
    else if (argv[i] === "--dry-run") dry = true;
    else if (argv[i] === "--keep" && argv[i + 1] && !argv[i + 1].startsWith("--")) opts.keep.push(basename(argv[++i]));
    else throw new Error("usage: worktree-clean [--dry-run | --apply] [--keep <name>]...");
  }
  if (dry && opts.apply) throw new Error("give either --dry-run or --apply, not both");
  return opts;
}

if (process.argv[1] && samePath(real(process.argv[1]) ?? "", fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = clean(parseArgs(process.argv.slice(2))).code;
  } catch (e) {
    console.error(`worktree-clean stopped: ${e.message}`);
    process.exitCode = 2;
  }
}
