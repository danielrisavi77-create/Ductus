import { readFile } from "node:fs/promises";
import process from "node:process";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import {
  evaluatePullRequest,
  NOT_DEFAULT_BASE,
  prNumberFromEvent,
  sameRepositoryHead,
  SHARED_HEAD,
  sharesHeadWithOpenPr,
  targetsDefaultBranch,
} from "./review-gate-core.mjs";
import { isMergifyQueuePr, QUEUE_CARRIER_STATUS } from "./mergify-queue-pr.mjs";

const context = "Engineering review gate";
// What the merge queue reads (D-161 (h)); see evaluateMergeAuthorization.
const authorizationContext = "Merge authorization";
const autoMergeContext = "Auto-merge eligible";

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

// F-014: statuses belong to a commit, not to a PR. A closed PR, or one whose
// head lives in another repository, can carry the same SHA as an open PR of
// this repository, so the gate writes nothing for it, not even pending.
function ownsHead(pr, repository) {
  return pr?.state === "open" && sameRepositoryHead(pr) && pr?.base?.repo?.full_name === repository;
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const number = prNumberFromEvent(event);

  if (!repository || !number) {
    console.log("No pull request in this event; nothing to evaluate.");
    return;
  }

  const [owner, repo] = repository.split("/");
  // A side-base head can be shared with a PR to main, whose statuses it would
  // overwrite, so only a PR to the default branch gets the failure marker.
  if (event.pull_request?.head?.sha && ownsHead(event.pull_request, repository) && targetsDefaultBranch(event.pull_request)) {
    knownHead = { repository, sha: event.pull_request.head.sha, url: event.pull_request.html_url };
  }
  const pr = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  if (!ownsHead(pr, repository)) {
    knownHead = null;
    console.log(`${context}: no status; the PR is not open or its head is outside ${repository}.`);
    return;
  }
  knownHead = targetsDefaultBranch(pr) || isMergifyQueuePr(pr, repository)
    ? { repository, sha: pr.head.sha, url: pr.html_url }
    : null;
  // Only an authenticated, open draft owned by Mergify is a CI carrier.
  // It cannot enqueue itself (-draft). No review/owner verdict is fabricated:
  // source PRs retain their own six required statuses and are revalidated by
  // Mergify. This workflow still executes only trusted default-branch code.
  if (isMergifyQueuePr(pr, repository)) {
    await setStatus(repository, pr.head.sha, QUEUE_CARRIER_STATUS, pr.html_url, authorizationContext);
    await setStatus(repository, pr.head.sha, QUEUE_CARRIER_STATUS, pr.html_url);
    console.log(QUEUE_CARRIER_STATUS.description);
    return;
  }
  const [comments, changedFiles, reviews, reviewComments, openPulls] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
    // Only for quota evidence (#128): a PR review of the exhausted App voids it.
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
    // D-139: Codex threads and their replies (second-session QA path only).
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/comments`),
    // F-165: statuses are per head, so the gate reads which open PRs share it.
    apiAll(`/repos/${owner}/${repo}/pulls?state=open`),
  ]);
  if (!targetsDefaultBranch(pr)) {
    // F-014: another open PR on this head owns its statuses; a pending marker
    // here would overwrite them. An unread list counts as shared.
    if (sharesHeadWithOpenPr(pr, openPulls)) {
      knownHead = null;
      console.log(`${context}: no status; another open PR shares this head. ${NOT_DEFAULT_BASE.description}`);
      return;
    }
    for (const statusContext of [authorizationContext, autoMergeContext, context]) {
      await setStatus(repository, pr.head.sha, NOT_DEFAULT_BASE, pr.html_url, statusContext);
    }
    console.log(`${context}: pending — ${NOT_DEFAULT_BASE.description}`);
    return;
  }

  const { metadata, result, mergeAuthorization, autoMergeEligible } = evaluatePullRequest({
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
  const eligible = sharesHeadWithOpenPr(pr, openPulls)
    ? SHARED_HEAD
    : (autoMergeEligible ?? { state: "pending", description: "Not eligible for auto-merge." });
  await setStatus(repository, pr.head.sha, eligible, pr.html_url, autoMergeContext);
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
