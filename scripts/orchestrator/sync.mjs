// Bring the PR branch up to date with main and prove it: merge origin/main into
// the checked-out PR branch, push through orch:push, wait for CI on the new head
// and run orch:preflight for that exact head.
// Use it when main has to go into the branch (a conflict, or the orchestrator asks
// for it); a head that only lags without a conflict needs no merge (D-101).
// It never resolves a conflict, never forces a push, never merges the PR and
// posts nothing. On a conflict the merge is aborted and the files are listed.
// Usage: node sync.mjs <number> [--wait-min N]     (default 30, 0 = do not wait)
//   exit 0 = preflight PASS on the synced head
//        1 = stopped: wrong branch or dirty tree, conflict, push, CI wait timeout or preflight FAIL
//        2 = usage or read error
import "./help.mjs";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { checkRollup, ghJson, prView, repoId } from "./gh.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";
import { ciWait, parseSyncArgs, syncPlan } from "./sync-core.mjs";

const POLL_MS = 30_000;
const parsed = parseSyncArgs(process.argv.slice(2));
if (!parsed) {
  console.error("usage: orch:sync <pr-number> [--wait-min N]");
  process.exit(2);
}
const { n, waitMin } = parsed;

const run = promisify(execFile);
const git = async (...args) => (await run("git", args, { windowsHide: true })).stdout.trim();
const tryGit = (...args) => git(...args).catch(() => null);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));
const child = (name, args) => new Promise((resolve) => {
  spawn(process.execPath, [script(name), ...args], { stdio: "inherit", windowsHide: true })
    .on("error", () => resolve(2)).on("exit", (code) => resolve(code ?? 2));
});

try {
  const pr = await prView(n);
  // Explicit refspec: in a single-branch checkout a plain "fetch origin main" only
  // writes FETCH_HEAD and leaves origin/main missing or stale.
  await git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main");
  const behind = await tryGit("rev-list", "--count", "HEAD..origin/main");
  const local = {
    branch: await tryGit("symbolic-ref", "--short", "HEAD"),
    head: await git("rev-parse", "HEAD"),
    // Explicit flags: status.showUntrackedFiles or a submodule "ignore" setting must not hide changes.
    dirty: (await git("status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none")) !== "",
    behind: behind === null ? null : Number(behind),
  };
  const plan = syncPlan({ pr, local });
  console.log(`PR #${n} ${pr.headRefName} head ${local.head.slice(0, 8)}: ${plan.reason}`);
  if (plan.action === "stop") process.exit(1);

  if (plan.action === "merge") {
    try {
      await git("merge", "--no-edit", "origin/main");
    } catch (e) {
      const files = ((await tryGit("diff", "--name-only", "--diff-filter=U")) ?? "").split("\n").filter(Boolean);
      await tryGit("merge", "--abort");
      // Only unmerged files mean a conflict; anything else is git's own failure, shown as is.
      if (files.length === 0) {
        console.error(`merge failed, nothing changed: ${e.stderr?.trim() || e.message}`);
        process.exit(1);
      }
      console.error("CONFLICT: merge aborted, nothing changed. Resolve by hand: git merge origin/main");
      for (const f of files) console.error(`  ${f}`);
      process.exit(1);
    }
    // orch:push keeps the push guard and compares the remote head with the local one.
    if (await child("push-verify.mjs", ["origin", local.branch, "--to", local.branch]) !== 0) {
      console.error("push failed: the merge commit is local only");
      process.exit(1);
    }
  }
  const head = await git("rev-parse", "HEAD");

  if (waitMin > 0) {
    const { owner, repo } = await repoId();
    const main = await ghJson(["api", `repos/${owner}/${repo}/branches/main`]).catch(() => null);
    const required = requiredStatusChecks(main?.protection?.required_status_checks);
    const deadline = Date.now() + waitMin * 60_000;
    console.log(`waiting for CI on ${head.slice(0, 8)}, at most ${waitMin} min`);
    for (;;) {
      // An unreadable roll-up is not a settled CI: keep waiting until the deadline.
      const w = ciWait(await checkRollup(head).catch(() => null), required);
      if (w.state === "settled") break;
      if (Date.now() >= deadline) {
        console.error(`CI WAIT TIMEOUT: running ${w.running.join(", ") || "-"}; not reported ${w.missing.join(", ") || "-"}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(1000, deadline - Date.now()))));
    }
  }

  const code = await child("preflight.mjs", [String(n), "--head", head]);
  console.log(code === 0 ? `SYNC OK: head ${head}` : `SYNC NOT READY: preflight exit ${code} on ${head}`);
  process.exit(code === 2 ? 2 : code === 0 ? 0 : 1);
} catch (e) {
  console.error(`sync failed: ${e.stderr?.trim() || e.message}`);
  process.exit(2);
}
