import { readFile } from "node:fs/promises";
import process from "node:process";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import { evaluatePullRequest, prNumberFromEvent } from "./review-gate-core.mjs";
import { isMergifyQueuePr } from "./mergify-queue-pr.mjs";

const context = "Engineering review gate";
// What the merge queue reads (D-161 (h)); see evaluateMergeAuthorization.
const authorizationContext = "Merge authorization";

// Every call is time-limited (plan napada #231, 7.4); see review-gate-api.mjs.
const api = createApi({
  baseUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
  token: process.env.GITHUB_TOKEN,
});

async function apiAll(path) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Expected array from paginated endpoint: ${path}`);
    items.push(...batch);
    if (batch.length < 100) break;
    if (page === 100) throw new Error(`Pagination limit reached for ${path}`);
  }
  return items;
}

async function setStatus(repository, sha, result, targetUrl, statusContext = context) {
  const [owner, repo] = repository.split("/");
  await api(`/repos/${owner}/${repo}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state: result.state,
      context: statusContext,
      description: result.description.slice(0, 140),
      target_url: targetUrl,
    }),
  });
}

// A run that fails after the head is known marks that head pending, so an
// older success never outlives a failed re-evaluation.
const RUN_FAILED = { state: "pending", description: "Gate run failed before a verdict; re-run the gate." };
const WAITING = { state: "pending", description: "Waiting for the Engineering review gate." };
let knownHead = null;

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const number = prNumberFromEvent(event);

  if (!repository || !number) {
    console.log("No pull request in this event; nothing to evaluate.");
    return;
  }

  const [owner, repo] = repository.split("/");
  if (event.pull_request?.head?.sha) {
    knownHead = { repository, sha: event.pull_request.head.sha, url: event.pull_request.html_url };
  }
  const pr = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  knownHead = { repository, sha: pr.head.sha, url: pr.html_url };
  // F-115: a Mergify CI carrier never receives a governance status. Its head is only a
  // merge commit of queued source heads; stamping "success" on it would let anyone who
  // pushes a descendant commit onto that branch open an ordinary PR with a green head.
  // The two governance contexts are checked on the source PRs (queue_conditions) only.
  if (isMergifyQueuePr(pr, repository)) {
    console.log("Mergify CI carrier: no governance status is published for it (F-115).");
    return;
  }
  const [comments, changedFiles, reviews, reviewComments] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
    // Only for quota evidence (#128): a PR review of the exhausted App voids it.
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
    // D-139: Codex threads and their replies (second-session QA path only).
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/comments`),
  ]);

  const { metadata, result, mergeAuthorization } = evaluatePullRequest({
    pr,
    files: changedFiles,
    comments,
    prReviews: reviews,
    reviewComments,
    ownerLogin: owner,
    carriedHeads: await carriedHeads(api, owner, repo, pr, comments),
  });

  // Authorization first: a stale green one must never sit beside a new green gate.
  await setStatus(repository, pr.head.sha, mergeAuthorization ?? WAITING, pr.html_url, authorizationContext);
  await setStatus(repository, pr.head.sha, result, pr.html_url);
  console.log(`${context}: ${result.state} — ${result.description}`);
  if (metadata?.ok) {
    console.log(`Risk: declared=${metadata.risk}, minimum=${metadata.minimumRisk}`);
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  if (!knownHead) return;
  try {
    await setStatus(knownHead.repository, knownHead.sha, RUN_FAILED, knownHead.url, authorizationContext);
    await setStatus(knownHead.repository, knownHead.sha, RUN_FAILED, knownHead.url);
  } catch (statusError) {
    console.error(`Could not mark the head pending after the failure: ${statusError.message}`);
  }
});
