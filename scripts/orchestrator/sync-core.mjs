// Pure core of orch:sync: argument parsing, the local-state decision and the CI wait.
// No git and no GitHub here; the entry script feeds it what it read.
import { GATE_CONTEXT, latestChecks } from "./orchestrator-core.mjs";

const AUTHORIZATION_CONTEXT = "Merge authorization";
const RUNNING_STATES = new Set(["PENDING", "QUEUED", "IN_PROGRESS"]);
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
 * State of CI on one head for the wait loop. The review gate and the merge
 * authorization wait for people, so they never keep the loop waiting.
 *   required  requiredStatusChecks() shape, or null when it could not be read
 * Returns { state: "waiting" | "settled", running: [names], missing: [names] }.
 */
export function ciWait(rollup, required) {
  const skip = (name) => name === GATE_CONTEXT || name === AUTHORIZATION_CONTEXT;
  const nameOf = (c) => c.name ?? c.context;
  const checks = latestChecks(Array.isArray(rollup) ? rollup : []).filter((c) => !skip(nameOf(c)));
  const running = checks
    .filter((c) => RUNNING_STATES.has(String(c.conclusion || c.state || c.status || "").toUpperCase()))
    .map(nameOf);
  const missing = (Array.isArray(required) ? required : [])
    .map((r) => (typeof r === "string" ? r : r?.context))
    .filter((name) => name && !skip(name) && !checks.some((c) => nameOf(c) === name));
  const settled = checks.length > 0 && running.length === 0 && missing.length === 0;
  return { state: settled ? "settled" : "waiting", running, missing };
}
