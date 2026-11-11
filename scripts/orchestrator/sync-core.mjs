// Pure core of orch:sync: argument parsing, the local-state decision, the state after
// the merge and the CI wait. No GitHub here, and git only through an injected reader.
import { GATE_STATUSES } from "./merge-ready-core.mjs";
import { latestChecks } from "./orchestrator-core.mjs";

// WAITING (environment approval) and REQUESTED are check runs that have not finished either.
const RUNNING_STATES = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);
export const DEFAULT_WAIT_MIN = 30;
// The command line overrides status.showUntrackedFiles, diff.ignoreSubmodules and
// submodule.<name>.ignore, so a hidden untracked file or submodule change still counts.
export const STATUS_ARGS = ["status", "--porcelain", "--untracked-files=normal", "--ignore-submodules=none"];

/** `<pr> [--wait-min N]`; null when the arguments are not exactly that. */
export function parseSyncArgs(args) {
  let waitMin = DEFAULT_WAIT_MIN;
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--wait-min") waitMin = Number(args[++i]);
    else rest.push(args[i]);
  }
  const n = Number(rest[0]);
  if (rest.length !== 1 || !Number.isInteger(n) || n <= 0 || !Number.isFinite(waitMin) || waitMin < 0) return null;
  return { n, waitMin };
}

/**
 * What to do with the local checkout before anything is merged.
 *   pr      toPr() shape (state, headRefName, headRefOid, baseRefName, sameRepository)
 *   local   { branch, head, dirty, merging, behind } read from git; merging = MERGE_HEAD present,
 *           behind = commits of main the branch lacks
 * Returns { action: "stop", reason } or { action: "merge" | "skip", reason }.
 */
export function syncPlan({ pr, local }) {
  const stop = (reason) => ({ action: "stop", reason });
  if (pr.state !== "OPEN") return stop(`PR is ${String(pr.state).toLowerCase()}, not open`);
  if (pr.baseRefName !== "main") return stop(`base is ${pr.baseRefName}, not main`);
  if (pr.sameRepository === false) return stop("head is in a fork: sync it there");
  if (!local.branch) return stop("detached HEAD: check out the PR branch first");
  if (local.branch !== pr.headRefName) return stop(`current branch is ${local.branch}, the PR branch is ${pr.headRefName}`);
  if (local.dirty) return stop("working tree has uncommitted changes: commit or stash them first");
  // A clean tree can still hold a merge the user started: never abort or push over it.
  if (local.merging) return stop("a merge is already in progress: conclude or abort it first");
  if (local.head !== pr.headRefOid) return stop("local head differs from the PR head: pull or push first");
  if (!Number.isInteger(local.behind) || local.behind < 0) return stop("lag behind main could not be read");
  return local.behind === 0
    ? { action: "skip", reason: "branch already contains main" }
    : { action: "merge", reason: `branch lacks ${local.behind} commit(s) of main` };
}

/**
 * What git says about the checkout after the merge step. `tryGit(...args)` resolves to
 * stdout, or null when the command fails; a failed ancestry check reads as "not contained".
 *   before           the PR head the run started from
 *   main             SHA of origin/main read once right after the fetch
 *   containedBefore  true when `before` already contained `main` (nothing to merge)
 */
export async function readMergeState(tryGit, { before, main, containedBefore }) {
  const head = await tryGit("rev-parse", "--verify", "HEAD");
  const mergeHead = await tryGit("rev-parse", "-q", "--verify", "MERGE_HEAD");
  return {
    before, main, containedBefore, head,
    mergeInProgress: head === null ? null : mergeHead !== null,
    mainInHead: (await tryGit("merge-base", "--is-ancestor", main, "HEAD")) !== null,
    beforeInHead: (await tryGit("merge-base", "--is-ancestor", before, "HEAD")) !== null,
  };
}

/**
 * null when the checkout may be pushed: no merge left in progress, HEAD contains the
 * fetched main and the PR head, and HEAD moved or already contained main. Otherwise the
 * reason; anything unread (null) is a reason too.
 */
export function mergeCheck(s) {
  if (!s.head) return "HEAD could not be read";
  if (s.mergeInProgress !== false) return "merge not concluded: MERGE_HEAD is present or unreadable";
  if (s.mainInHead !== true) return `HEAD does not contain the fetched main ${String(s.main).slice(0, 8)}`;
  if (s.beforeInHead !== true) return `HEAD does not contain the PR head ${String(s.before).slice(0, 8)}`;
  if (s.head === s.before && s.containedBefore !== true) return "HEAD did not move and did not contain main";
  return null;
}

/**
 * null when the checkout is still the exact branch and head that CI and preflight
 * covered, otherwise what moved. Only full equality counts.
 *   now, expected   { branch, head } read from git (branch null = detached)
 */
export function headDrift(now, expected) {
  const moved = [];
  if (now.branch !== expected.branch) moved.push(`branch moved to ${now.branch ?? "(detached)"}`);
  if (now.head !== expected.head) moved.push(`head moved to ${now.head ? now.head.slice(0, 8) : "(unreadable)"}`);
  return moved.length ? moved.join(", ") : null;
}

/**
 * State of CI on one head for the wait loop. The review gate, the merge authorization
 * and "Auto-merge eligible" wait for people, and the merge queue's own checks
 * (Mergify, by App slug) wait for those, so none of them keeps the loop waiting.
 *   required  requiredStatusChecks() shape, or null when it could not be read
 * Returns { state: "waiting" | "settled", running: [names], missing: [names] }.
 */
export function ciWait(rollup, required) {
  const skip = (name) => GATE_STATUSES.has(name);
  const nameOf = (c) => c.name ?? c.context;
  const checks = latestChecks(Array.isArray(rollup) ? rollup : []).filter((c) => !skip(nameOf(c)) && c?.appSlug !== "mergify");
  const running = checks
    .filter((c) => RUNNING_STATES.has(String(c.conclusion || c.state || c.status || "").toUpperCase()))
    .map(nameOf);
  // Same match as preflight: a check bound to an App is not reported by a same-named check of another App.
  const missing = (Array.isArray(required) ? required : [])
    .map((r) => (typeof r === "string" ? { context: r, appId: null } : r))
    .filter((r) => r?.context && !skip(r.context)
      && !checks.some((c) => nameOf(c) === r.context && (r.appId == null || c.appId === r.appId)))
    .map((r) => (r.appId == null ? r.context : `${r.context} app ${r.appId}`));
  const settled = checks.length > 0 && running.length === 0 && missing.length === 0;
  return { state: settled ? "settled" : "waiting", running, missing };
}
