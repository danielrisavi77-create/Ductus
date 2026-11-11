// Pure core of orch:sync: argument parsing, the local-state decision and the CI wait.
// No git and no GitHub here; the entry script feeds it what it read.
import { GATE_STATUSES } from "./merge-ready-core.mjs";
import { latestChecks } from "./orchestrator-core.mjs";

// WAITING (environment approval) and REQUESTED are check runs that have not finished either.
const RUNNING_STATES = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);
export const DEFAULT_WAIT_MIN = 30;

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
 *   local   { branch, head, dirty, behind } read from git; behind = commits of main the branch lacks
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
  if (local.head !== pr.headRefOid) return stop("local head differs from the PR head: pull or push first");
  if (!Number.isInteger(local.behind) || local.behind < 0) return stop("lag behind main could not be read");
  return local.behind === 0
    ? { action: "skip", reason: "branch already contains main" }
    : { action: "merge", reason: `branch lacks ${local.behind} commit(s) of main` };
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
