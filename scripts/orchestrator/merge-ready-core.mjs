// Merge readiness of one PR, read the way the gate and GitHub read it. Pure: no
// gh/git; merge-ready.mjs does the reads. The gate's own statuses decide (they
// already include the D-101 carry of verdicts across clean main merges), so this
// never recounts verdicts on the head and never disagrees with the gate about them.
import { evaluateChecks, GATE_CONTEXT, latestChecks } from "./orchestrator-core.mjs";

export const AUTHORIZATION_CONTEXT = "Merge authorization";
// Statuses the gate workflow posts itself; they are not CI.
const GATE_STATUSES = new Set([GATE_CONTEXT, AUTHORIZATION_CONTEXT, "Auto-merge eligible"]);
// The merge queue's own check runs (Mergify Merge Queue, Merge Protections, Summary), by App
// slug, not by name. They wait for the very conditions this tool reports, so counting them as
// CI deadlocks: a "queue" posted before the owner's command leaves "Mergify Merge Queue" pending
// and the owner's turn never comes (#1162, #1182). Pending, skipped and passed ones are shown,
// not counted; a failed one still blocks (fail-closed).
const QUEUE_APP = "mergify";
const QUEUE_FAILED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);
const isQueueCheck = (c) => c?.appSlug === QUEUE_APP;
const RUNNING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"]);
// The fixed description of evaluateMergeAuthorization when only the owner's command is missing.
const NEEDS_OWNER = /owner's merge command/i;
// The gate posts a FAIL or BLOCK verdict as pending with this fixed text: it needs a fix, not time.
const NEGATIVE_VERDICT = /\bIndependent (?:review|QA) (?:fail|block) on current head\b/i;

export const STATES = Object.freeze({
  READY: "READY", // the merge queue may take it now
  WAITS_OWNER: "WAITS_OWNER", // everything passes except the owner's merge command
  WAITING: "WAITING", // something is still running; nothing to fix
  BLOCKED: "BLOCKED", // something must be fixed before it can merge
  UNREAD: "UNREAD", // a read failed: never counts as ready
});
export const EXIT_CODES = Object.freeze({ READY: 0, BLOCKED: 1, UNREAD: 2, WAITING: 3, WAITS_OWNER: 4 });

/** Newest status of `context` in a commit statuses list (any order); null when none. */
export function pickStatus(statuses, context) {
  const at = (s) => Date.parse(s?.created_at ?? "") || 0;
  let best = null;
  for (const s of statuses ?? []) {
    if (s?.context !== context) continue;
    if (!best || at(s) > at(best) || (at(s) === at(best) && (s.id ?? 0) > (best.id ?? 0))) best = s;
  }
  return best;
}

/** Required contexts other than the gate's own statuses, as {context, appId}; null when unread. */
function requiredChecks(required) {
  if (!Array.isArray(required) || required.length === 0) return null;
  return required
    .map((r) => (typeof r === "string" ? { context: r, appId: null } : { context: r?.context, appId: Number.isInteger(r?.appId) ? r.appId : null }))
    .filter((r) => typeof r.context === "string" && r.context && !GATE_STATUSES.has(r.context));
}

const short = (sha) => String(sha ?? "?").slice(0, 8);
const said = (s) => (s?.description ? `: ${s.description}` : "");
const unread = (v) => v === undefined || Boolean(v?.error);

/**
 * Input (a read that failed is passed as {error}, never as "nothing"):
 *   pr             toPr() shape: number, state, isDraft, headRefOid, baseRefName, mergeable
 *   mergeState     GitHub's merge state of the PR (CLEAN, BLOCKED, BEHIND, DIRTY, UNKNOWN, ...)
 *   gate           newest "Engineering review gate" status on the head, null, or {error}
 *   authorization  newest "Merge authorization" status on the head, null, or {error}
 *   rollup         checkRollup(head), or {error}
 *   required       required status contexts of main ([{context}] or strings), or null
 *   threads        summarizeThreads() result ({count, authors}), or {error}
 * Returns {state, reason, checks: [{level: PASS|FAIL|WAIT|OWNER|UNREAD|INFO, id, text}]}.
 */
export function evaluateMergeReady({ pr, mergeState, gate, authorization, rollup, required = null, threads }) {
  const checks = [];
  const add = (level, id, text) => checks.push({ level, id, text });
  const head = short(pr?.headRefOid);

  add(pr?.state === "OPEN" ? "PASS" : "FAIL", "open", `state ${pr?.state ?? "?"}`);
  if (pr?.isDraft) add("FAIL", "draft", "PR is a draft");
  if (pr?.baseRefName !== "main") add("FAIL", "base", `base ${pr?.baseRefName ?? "?"}, not main`);

  // The review gate: its success already counts verdicts carried across clean main merges (D-101).
  if (unread(gate)) add("UNREAD", "gate", `gate could not be read on ${head}${gate?.error ? ` (${gate.error})` : ""}`);
  else if (!gate) add("WAIT", "gate", `gate has not reported on ${head} yet`);
  else if (gate.state === "success") add("PASS", "gate", `gate success on ${head}${said(gate)}`);
  else if (gate.state === "pending" && NEGATIVE_VERDICT.test(gate.description ?? "")) {
    add("FAIL", "gate", `gate holds a negative verdict on ${head}${said(gate)}`);
  } else if (gate.state === "pending") add("WAIT", "gate", `gate pending on ${head}${said(gate)}`);
  else add("FAIL", "gate", `gate ${gate.state} on ${head}${said(gate)}`);

  if (unread(authorization)) add("UNREAD", "authorization", `Merge authorization could not be read${authorization?.error ? ` (${authorization.error})` : ""}`);
  else if (!authorization) add("WAIT", "authorization", "Merge authorization has not reported yet");
  else if (authorization.state === "success") add("PASS", "authorization", `Merge authorization success${said(authorization)}`);
  else if (authorization.state === "pending" && NEEDS_OWNER.test(authorization.description ?? "")) {
    add("OWNER", "authorization", `waits for the owner's "Spoji ${pr?.number ?? "?"}" on ${head}${said(authorization)}`);
  } else if (authorization.state === "pending") add("WAIT", "authorization", `Merge authorization pending${said(authorization)}`);
  else add("FAIL", "authorization", `Merge authorization ${authorization.state}${said(authorization)}`);

  // Every required context of main (branch protection; the same list Mergify's queue
  // conditions name, besides Merge authorization) must be reported on the head: a check
  // that never started is not green (Codex #1197). Context and App as in evaluatePreflight.
  const req = requiredChecks(required);
  if (!Array.isArray(rollup)) add("UNREAD", "ci", `CI checks could not be read${rollup?.error ? ` (${rollup.error})` : ""}`);
  else if (req === null) add("UNREAD", "ci", "required checks of main could not be read");
  else {
    const reported = latestChecks(rollup);
    const missing = req.filter((r) => !reported.some((c) => (c.name ?? c.context) === r.context && (r.appId == null || c.appId === r.appId)));
    if (missing.length) add("WAIT", "required", `required check(s) not reported on the head yet: ${missing.map((r) => r.context).join(", ")}`);
    const queue = latestChecks(rollup.filter(isQueueCheck));
    const queueState = (c) => c.conclusion || c.status || "?";
    const queueFailed = queue.filter((c) => QUEUE_FAILED.has(queueState(c)));
    if (queueFailed.length) add("FAIL", "queue", `merge queue check failed: ${queueFailed.map((c) => `${c.name}=${queueState(c)}`).join(", ")}`);
    else if (queue.length) add("INFO", "queue", `merge queue checks (a pending one is not counted as CI): ${queue.map((c) => `${c.name}=${queueState(c)}`).join(", ")}`);
    const ck = evaluateChecks(rollup.filter((c) => !GATE_STATUSES.has(c?.name ?? c?.context) && !isQueueCheck(c)));
    const running = ck.bad.filter((c) => RUNNING.has(c.state));
    const failing = ck.bad.filter((c) => !RUNNING.has(c.state));
    if (ck.total === 0) add("WAIT", "ci", "no CI checks reported on the head yet");
    else if (failing.length) add("FAIL", "ci", `CI not green: ${failing.map((c) => `${c.name}=${c.state}`).join(", ")}`);
    else if (running.length) add("WAIT", "ci", `CI running: ${running.map((c) => c.name).join(", ")}`);
    else add("PASS", "ci", `CI green (${ck.total} checks)`);
  }

  if (unread(threads) || !Number.isInteger(threads?.count)) add("UNREAD", "threads", `review threads could not be read${threads?.error ? ` (${threads.error})` : ""}`);
  else if (threads.count > 0) {
    add("FAIL", "threads", `${threads.count} unresolved review thread(s) (${(threads.authors ?? []).join(", ") || "?"}); GitHub does not merge until they are resolved`);
  } else add("PASS", "threads", "no unresolved review threads");

  // GitHub's own view. A BLOCKED that nothing above explains is reported as such,
  // so nobody waits for a merge that cannot happen.
  const ms = String(mergeState ?? "UNKNOWN").toUpperCase();
  if (ms === "DIRTY" || pr?.mergeable === "CONFLICTING") add("FAIL", "merge-state", "conflicts with main: the writer merges main and resolves it");
  else if (ms === "BLOCKED") {
    const visible = checks.filter((c) => ["FAIL", "WAIT", "OWNER", "UNREAD"].includes(c.level)).map((c) => c.id);
    const req = (required ?? []).map((r) => (typeof r === "string" ? r : r?.context)).filter(Boolean);
    if (visible.length) add("INFO", "merge-state", `GitHub blocks the merge because of: ${visible.join(", ")}`);
    else add("FAIL", "merge-state", `GitHub blocks the merge, but no status, check or thread read here explains it${req.length ? ` (required: ${req.join(", ")})` : ""}: check the PR page and the branch protection`);
  } else if (ms === "UNKNOWN") add("WAIT", "merge-state", "GitHub has not computed the merge state yet");
  else if (ms === "DRAFT") add("FAIL", "merge-state", "GitHub sees a draft");
  else add("INFO", "merge-state", `GitHub merge state ${ms}${ms === "BEHIND" ? " (the merge queue refreshes the branch)" : ""}`);

  // Codex is not read here: whether a head needs a Codex review is the gate's rule, and the gate's
  // status above already carries it. Reading it twice could only disagree (Codex CLI #1197).

  const first = (level) => checks.find((c) => c.level === level);
  const order = [["UNREAD", "UNREAD"], ["FAIL", "BLOCKED"], ["WAIT", "WAITING"], ["OWNER", "WAITS_OWNER"]];
  const hit = order.find(([level]) => first(level));
  if (!hit) return { state: STATES.READY, reason: `gate, Merge authorization, CI and threads pass on ${head}`, checks };
  return { state: STATES[hit[1]], reason: first(hit[0]).text, checks };
}
