// Table of all open PRs. Read-only. Usage: node pr-status.mjs [--json]
import "./help.mjs";
import { checkRollup, openPrsWithPaths, prComments, readGate, repoId } from "./gh.mjs";
import {
  evaluateChecks, externalReason, formatStatusRow, formatVerdict, headOrigin, latestVerdict, originText, overlapPairs,
  overlapsOf, parseAgentRisk,
} from "./orchestrator-core.mjs";

const json = process.argv.includes("--json");
// F-010 (plan #1671 N10): the gate reads no verdict on a head outside this repository.
const HIDDEN = "not shown (VANJSKI)";

function formatChecks({ total, bad }) {
  if (!total) return "none";
  if (!bad.length) return `green ${total}`;
  return `${bad.length}/${total} ${bad.slice(0, 3).map((b) => `${b.name}=${b.state}`).join(", ")}`;
}

async function row(pr, origin) {
  const [gate, comments, rollup] = await Promise.all([
    readGate(pr.headRefOid).then((g) => (g?.error ? undefined : g)),
    prComments(pr.number).catch(() => undefined),
    checkRollup(pr.headRefOid).catch(() => undefined),
  ]);
  const { agent, risk } = parseAgentRisk(pr.body);
  const review = comments ? latestVerdict(comments, "review", pr.headRefOid) : undefined;
  const qa = comments ? latestVerdict(comments, "qa", pr.headRefOid) : undefined;
  const o = headOrigin(pr, origin.repository);
  return {
    number: pr.number,
    head: pr.headRefOid.slice(0, 8),
    base: pr.baseRefName,
    draft: pr.isDraft,
    // F-010: reason the PR waits for the owner to adopt it, or null.
    external: externalReason(pr, origin.repository, origin.owner) ?? (o.ok ? null : originText(o)),
    agent,
    risk,
    ci: rollup ? formatChecks(evaluateChecks(rollup)) : "?",
    gate: !o.ok ? HIDDEN : gate === undefined ? "?" : gate ? `${gate.state}: ${(gate.description ?? "").slice(0, 60)}` : "none",
    review: !o.ok ? HIDDEN : comments ? formatVerdict(review) : "?",
    qa: !o.ok ? HIDDEN : comments ? formatVerdict(qa) : "?",
  };
}

try {
  const prs = await openPrsWithPaths();
  const { owner, repo } = await repoId();
  const origin = { repository: `${owner}/${repo}`, owner };
  const pairs = overlapPairs(prs);
  const rows = (await Promise.all(prs.map((pr) => row(pr, origin)))).map((r) => ({ ...r, overlaps: overlapsOf(r.number, prs, pairs) }));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      console.log(formatStatusRow(r));
    }
    if (!rows.length) console.log("no open PRs");
  }
} catch (e) {
  console.error(`pr-status failed: ${e.message}`);
  process.exit(2);
}
