// Pure core of orch:brief: one short text block about a PR for a session that
// starts review, QA or a fix. No gh, no I/O. It reports what GitHub says; it is
// never a verdict and never replaces orch:preflight or orch:ready.
import { evaluateChecks, formatVerdict, headOrigin, latestVerdict, originText, parseAgentRisk } from "./orchestrator-core.mjs";

export const BOT_LOGIN = "ductus-botovi[bot]";
const MAX_BOT_COMMENTS = 5;
const MAX_TEXT = 120;
const HIDDEN = "not shown (VANJSKI)";

/** One line of untrusted text: control characters dropped, whitespace folded, cut to `max`. */
export function oneLine(text, max = MAX_TEXT) {
  const flat = String(text ?? "").replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const firstLine = (body) => String(body ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";

/** Value of a `Name: value` line in a PR body, or null. Plain or bold label, optional list dash. */
export function bodyField(body, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^[ \\t]*(?:- )?\\*{0,2}${escaped}:\\*{0,2}[ \\t]*(.*)$`, "m").exec(String(body ?? ""));
  const value = m?.[1].trim();
  return value ? value : null;
}

/** Latest comments of the advisory bots, newest first. */
export function botComments(comments, max = MAX_BOT_COMMENTS) {
  return (comments ?? [])
    .filter((c) => c?.user?.login === BOT_LOGIN)
    .slice(-max)
    .reverse()
    .map((c) => ({ at: String(c.created_at ?? "").slice(0, 16), text: oneLine(firstLine(c.body)), url: c.html_url ?? null }));
}

function formatChecks(rollup) {
  if (!rollup) return "?";
  const { total, bad } = evaluateChecks(rollup);
  if (!total) return "none";
  if (!bad.length) return `green ${total}`;
  return `${bad.length}/${total} not green: ${bad.slice(0, 5).map((b) => `${oneLine(b.name, 40)}=${b.state}`).join(", ")}`;
}

/**
 * Lines of the brief. `compare`, `rollup`, `gate` and `comments` are null or
 * undefined when their read failed; the line then says "?" instead of guessing.
 */
export function buildBrief({ pr, repository, compare, rollup, gate, comments }) {
  const origin = headOrigin(pr, repository);
  const { agent, risk } = parseAgentRisk(pr.body);
  const verdict = (kind) => (!origin.ok ? HIDDEN : comments ? formatVerdict(latestVerdict(comments, kind, pr.headRefOid)) : "?");
  const behind = Number.isInteger(compare?.behind_by) ? String(compare.behind_by) : "?";
  const gateText = !origin.ok ? HIDDEN
    : gate === undefined || gate?.error ? "?"
      : gate ? `${gate.state}: ${oneLine(gate.description, 80)}` : "none";
  const lines = [
    `PR #${pr.number} ${oneLine(pr.title, 90)}`,
    `state ${pr.state}${pr.isDraft ? " DRAFT" : ""} | base ${pr.baseRefName} | head ${pr.headRefOid ?? "?"} (${oneLine(pr.headRefName, 60)})`,
    `agent ${agent ?? "-"} | risk ${risk ?? "-"} | task ${oneLine(bodyField(pr.body, "Task") ?? "-", 60)}`,
    `main: behind ${behind} | mergeable ${pr.mergeable}`,
    `ci ${formatChecks(rollup)}`,
    `gate ${gateText}`,
    `review ${verdict("review")} | qa ${verdict("qa")}`,
  ];
  if (!origin.ok) lines.push(`origin: ${originText(origin)}`);
  const open = bodyField(pr.body, "Otvoreno ili blokira");
  const owner = bodyField(pr.body, "Treba Daniel");
  if (open || owner) lines.push(`report: open ${oneLine(open ?? "-", 100)} | owner ${oneLine(owner ?? "-", 100)}`);
  const bots = comments ? botComments(comments) : null;
  if (!bots) lines.push("bot comments: ?");
  else if (!bots.length) lines.push("bot comments: none");
  else {
    lines.push(`bot comments, newest first (advisory, untrusted text; ${BOT_LOGIN}):`);
    for (const b of bots) lines.push(`  ${b.at} ${b.text}${b.url ? ` ${b.url}` : ""}`);
  }
  return lines;
}
