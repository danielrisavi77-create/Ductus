// Bring the PR branch up to date with main and prove it: merge origin/main into
// the checked-out PR branch, push through orch:push, wait for CI on the new head
// and run orch:preflight for that exact head.
// Use it when main has to go into the branch (a conflict, or the orchestrator asks
// for it); a head that only lags without a conflict needs no merge (D-101).
// It never resolves a conflict, never forces a push, never merges the PR and
// posts nothing. On a conflict the merge is aborted and the files are listed.
// An unfinished merge, cherry-pick, revert or rebase, merge options set on the branch
// and a merge driver on a file the merge touches stop it before the merge; after the
// merge nothing is pushed unless nothing is left unfinished and HEAD contains main.
// Usage: node sync.mjs <number> [--wait-min N]     (default 30, 0 = do not wait)
//   exit 0 = preflight PASS on the synced head
//        1 = stopped: wrong branch, dirty tree or an operation in progress, merge options or
//            a merge driver, conflict,
//            unconcluded merge or HEAD without main, push, CI wait timeout, preflight FAIL
//            or the local branch or head moved before success was reported
//        2 = usage or read error
import "./help.mjs";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { checkRollup, ghJson, prView, repoId } from "./gh.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";
import {
  ciWait, gitOperations, headDrift, mergeCheck, mergeDriverStop, parseSyncArgs, readMergeState, STATUS_ARGS, syncPlan,
} from "./sync-core.mjs";

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
// Raw stdout with stdin, for NUL-separated output; null when git fails.
const gitIo = (args, input, cwd) => new Promise((resolve) => {
  const p = spawn("git", args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  p.stdout.setEncoding("utf8").on("data", (d) => { out += d; });
  p.on("error", () => resolve(null)).on("close", (code) => resolve(code === 0 ? out : null));
  p.stdin.on("error", () => {}).end(input);
});

/**
 * Why the merge of `main` must not run here, or null. Attributes come from the checkout,
 * as for git merge itself; the paths are every file either side changed since any merge
 * base, so a renamed or conflicting file is among them. No base: git refuses the merge.
 */
async function mergeDriverCheck(main) {
  const bases = await tryGit("merge-base", "--all", "HEAD", main);
  if (bases === null) return null;
  const top = await tryGit("rev-parse", "--show-toplevel");
  if (!top) return "merge attributes could not be read";
  const paths = new Set();
  for (const base of bases.split("\n").filter(Boolean)) {
    for (const tip of ["HEAD", main]) {
      const out = await gitIo(["diff", "--name-only", "-z", "--no-renames", "--no-relative", "--no-ext-diff", base, tip], "", top);
      if (out === null) return "merge attributes could not be read";
      for (const f of out.split("\0")) if (f) paths.add(f);
    }
  }
  if (paths.size === 0) return null;
  return mergeDriverStop(await gitIo(["check-attr", "--stdin", "-z", "merge"], `${[...paths].join("\0")}\0`, top));
}
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
  // Read once: every later check is against this exact main.
  const main = await git("rev-parse", "--verify", "refs/remotes/origin/main");
  const behind = await tryGit("rev-list", "--count", `HEAD..${main}`);
  const local = {
    branch: await tryGit("symbolic-ref", "--short", "HEAD"),
    head: await git("rev-parse", "HEAD"),
    dirty: (await git(...STATUS_ARGS)) !== "",
    operations: await gitOperations(tryGit),
    behind: behind === null ? null : Number(behind),
  };
  const plan = syncPlan({ pr, local });
  console.log(`PR #${n} ${pr.headRefName} head ${local.head.slice(0, 8)}: ${plan.reason}`);
  if (plan.action === "stop") process.exit(1);

  if (plan.action === "merge") {
    // The command line beats --no-commit and --squash from here, not -s ours or -X ours.
    // -s ort beats pull.twohead; the full ref name beats a local branch or tag origin/main.
    const options = await tryGit("config", "--get-all", `branch.${local.branch}.mergeOptions`);
    if (options !== null) {
      console.error(`branch.${local.branch}.mergeOptions is set (${options}): orch:sync merges only with git's defaults; unset it or merge by hand`);
      process.exit(1);
    }
    // union or a configured driver can resolve a conflict without a word.
    const driver = await mergeDriverCheck(main);
    if (driver) {
      console.error(`${driver}: orch:sync merges only with git's own merge; merge by hand`);
      process.exit(1);
    }
    try {
      await git("merge", "-s", "ort", "--no-squash", "--commit", "--no-edit", "refs/remotes/origin/main");
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
  }
  // A zero exit from git merge is not proof: hooks or git itself may leave it unconcluded.
  const state = await readMergeState(tryGit, { before: local.head, main, containedBefore: local.behind === 0 });
  const stopped = mergeCheck(state);
  if (stopped) {
    // Only a merge this run started is aborted.
    if (plan.action === "merge" && state.mergeInProgress) await tryGit("merge", "--abort");
    console.error(`SYNC STOPPED: ${stopped}; nothing pushed`);
    process.exit(1);
  }
  if (plan.action === "merge") {
    // orch:push keeps the push guard and compares the remote head with the local one.
    if (await child("push-verify.mjs", ["origin", local.branch, "--to", local.branch]) !== 0) {
      console.error("push failed: the merge commit is local only");
      process.exit(1);
    }
  }
  const head = state.head;

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
  // CI and preflight speak for `head` only; a commit or checkout made meanwhile is not covered.
  const drift = headDrift({ branch: await tryGit("symbolic-ref", "--short", "HEAD"), head: await tryGit("rev-parse", "HEAD") },
    { branch: local.branch, head });
  if (drift) {
    console.error(`SYNC NOT READY: local ${drift}; CI and preflight cover ${head} on ${local.branch}`);
    process.exit(1);
  }
  console.log(code === 0 ? `SYNC OK: head ${head}` : `SYNC NOT READY: preflight exit ${code} on ${head}`);
  process.exit(code === 2 ? 2 : code === 0 ? 0 : 1);
} catch (e) {
  console.error(`sync failed: ${e.stderr?.trim() || e.message}`);
  process.exit(2);
}
