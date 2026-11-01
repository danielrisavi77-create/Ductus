// One look at the CI of a PR head, never a wait. Pure core; ci-once.mjs reads GitHub.
import { latestChecks } from "./orchestrator-core.mjs";

/**
 * Statuses the gate posts. They wait for review, QA or the owner's command by
 * design, so they are never CI: counting them would keep every open PR "running".
 */
export const GATE_CONTEXTS = new Set(["Engineering review gate", "Merge authorization", "Auto-merge eligible"]);

const OK = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const RUNNING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"]);

const nameOf = (c) => c.name ?? c.context;
const stateOf = (c) => String(c.conclusion || c.state || c.status || "UNKNOWN").toUpperCase();

/** Exit codes of ci-once.mjs. */
export const EXIT = { green: 0, red: 1, error: 2, running: 3 };

/**
 * `rollup`: checkRollup(head) entries. `required`: [{context, appId}] of main's
 * branch protection, or null when unread. Verdict:
 *   red      some check ended in anything but SUCCESS, SKIPPED or NEUTRAL
 *            (an unknown state is red, never green);
 *   running  nothing red, but a check is still running or a required check
 *            has not reported on this head yet;
 *   green    every reported check ended green and every required one reported.
 * Red wins over running: a failed check is reported at once.
 */
export function ciOnce({ rollup, required }) {
  if (!Array.isArray(rollup)) throw new Error("checks of the head could not be read");
  if (!Array.isArray(required) || required.length === 0) throw new Error("required checks of main could not be read");
  const checks = latestChecks(rollup.filter((c) => !GATE_CONTEXTS.has(nameOf(c))));
  const failed = [];
  const running = [];
  for (const c of checks) {
    const state = stateOf(c);
    if (OK.has(state)) continue;
    (RUNNING.has(state) ? running : failed).push(`${nameOf(c)}=${state}`);
  }
  const missing = required
    .filter((r) => !GATE_CONTEXTS.has(r.context))
    .filter((r) => !checks.some((c) => nameOf(c) === r.context && (r.appId == null || c.appId === r.appId)))
    .map((r) => (r.appId == null ? r.context : `${r.context} (app ${r.appId})`));
  const verdict = failed.length ? "red" : running.length || missing.length ? "running" : "green";
  return { verdict, total: checks.length, failed, running, missing };
}

/**
 * The whole read of ci-once.mjs with GitHub injected (`gh`: prView, repoId,
 * ghJson, checkRollup), so the CLI path is testable. Returns { exit, out, err }.
 * The head is read again after the checks: a push during the read moves the PR
 * to another head, and the answer for the old one is then a read error (2).
 */
export async function runCiOnce({ n, expectHead = null, gh, requiredOf }) {
  const moved = (want, got) => ({
    exit: EXIT.error,
    out: [],
    err: [`CI HEAD MOVED #${n}: expected ${String(want).slice(0, 8)}, PR is at ${String(got).slice(0, 8)}`],
  });
  try {
    const head = (await gh.prView(n))?.headRefOid;
    if (!head) throw new Error(`head of #${n} could not be read`);
    if (expectHead && head.toLowerCase() !== expectHead.toLowerCase()) return moved(expectHead, head);
    const { owner, repo } = await gh.repoId();
    const main = await gh.ghJson(["api", `repos/${owner}/${repo}/branches/main`]);
    const result = ciOnce({ rollup: await gh.checkRollup(head), required: requiredOf(main?.protection?.required_status_checks) });
    const after = (await gh.prView(n))?.headRefOid;
    if (!after) throw new Error(`head of #${n} could not be read again`);
    if (after.toLowerCase() !== head.toLowerCase()) return moved(head, after);
    return { exit: EXIT[result.verdict], out: ciOnceLines(n, head, result), err: [] };
  } catch (e) {
    return { exit: EXIT.error, out: [], err: [`CI READ ERROR #${n}: ${e.message}`] };
  }
}

/**
 * The GitHub reads ci-once.mjs hands to runCiOnce. `prView` of gh.mjs waits
 * and reads again while GitHub still computes mergeability; ci-once needs only
 * the head, so its reads never wait (QA of #1081, c.6557763346).
 */
export function noWaitGh({ prView, ...rest }) {
  return { ...rest, prView: (n) => prView(n, { waitMs: 0 }) };
}

/** The lines ci-once.mjs prints; the first one carries the verdict. */
export function ciOnceLines(n, head, result) {
  const short = String(head).slice(0, 8);
  if (result.verdict === "green") return [`CI GREEN #${n} head ${short}: ${result.total} checks`];
  if (result.verdict === "red") return [`CI RED #${n} head ${short}: ${result.failed.join(", ")}`];
  const parts = [];
  if (result.running.length) parts.push(`still running: ${result.running.join(", ")}`);
  if (result.missing.length) parts.push(`not reported yet: ${result.missing.join(", ")}`);
  return [
    `CI RUNNING #${n} head ${short}: ${parts.join("; ")}`,
    "Do not wait in a loop: hand the work back and check again later.",
  ];
}
