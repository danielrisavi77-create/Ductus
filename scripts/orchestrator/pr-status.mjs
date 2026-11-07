// Table of all open PRs. Read-only. Usage: node pr-status.mjs [--json]
import { field } from "../engineering/metadata-parser.mjs";
import {
  checkRollup, openPrsWithPaths, prComments, prEvents, prReviewComments, prReviews, readGate, repoId,
} from "./gh.mjs";
import {
  evaluateChecks, externalReason, formatStatusRow, formatVerdict, displayAgentRisk, latestVerdict, overlapPairs, overlapsOf, verdictInputs,
} from "./orchestrator-core.mjs";

const json = process.argv.includes("--json");

function formatChecks({ total, bad }) {
  if (!total) return "none";
  if (!bad.length) return `green ${total}`;
  return `${bad.length}/${total} ${bad.slice(0, 3).map((b) => `${b.name}=${b.state}`).join(", ")}`;
}

async function row(pr, origin) {
  const unread = () => undefined;
  const [gate, comments, events, reviews, reviewComments, rollup] = await Promise.all([
    readGate(pr.headRefOid).then((g) => (g?.error ? undefined : g)),
    prComments(pr.number).catch(unread),
    prEvents(pr.number).catch(unread),
    prReviews(pr.number).catch(unread),
    prReviewComments(pr.number).catch(unread),
    checkRollup(pr.headRefOid).catch(unread),
  ]);
  // F-015: the gate's inputs and base-change cutoff; null (unread) shows "?".
  const inputs = verdictInputs({ comments, events, reviews, reviewComments });
  // F-015: Agent and Risk only in the shape the gate accepts.
  const { agent, risk } = displayAgentRisk(pr.body);
  const authorAgent = field(pr.body, "Agent") ?? null;
  const options = { ...inputs, authorAgent, authorLogin: pr.author?.login ?? null };
  const review = inputs ? latestVerdict(inputs.comments, "review", pr.headRefOid, options) : undefined;
  const qa = inputs ? latestVerdict(inputs.comments, "qa", pr.headRefOid, options) : undefined;
  return {
    number: pr.number,
    head: pr.headRefOid.slice(0, 8),
    base: pr.baseRefName,
    draft: pr.isDraft,
    // F-010: reason the PR waits for the owner to adopt it, or null.
    external: externalReason(pr, origin.repository, origin.owner),
    agent,
    risk,
    ci: rollup ? formatChecks(evaluateChecks(rollup)) : "?",
    gate: gate === undefined ? "?" : gate ? `${gate.state}: ${(gate.description ?? "").slice(0, 60)}` : "none",
    review: inputs ? formatVerdict(review) : "?",
    qa: inputs ? formatVerdict(qa) : "?",
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
