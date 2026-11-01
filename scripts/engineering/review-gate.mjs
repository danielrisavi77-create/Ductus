import { readFile } from "node:fs/promises";
import process from "node:process";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import {
  evaluatePullRequest,
  lastBaseChange,
  NOT_DEFAULT_BASE,
  prNumberFromEvent,
  sameRepositoryHead,
  SHARED_HEAD,
  sharesHeadWithOpenPr,
  sinceBaseChange,
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
    knownHead = {
      repository,
      sha: event.pull_request.head.sha,
      url: event.pull_request.html_url,
      carrier: isMergifyQueuePr(event.pull_request, repository),
    };
  }
  const pr = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  if (!ownsHead(pr, repository)) {
    knownHead = null;
    console.log(`${context}: no status; the PR is not open or its head is outside ${repository}.`);
    return;
  }
  knownHead = targetsDefaultBranch(pr) || isMergifyQueuePr(pr, repository)
    ? { repository, sha: pr.head.sha, url: pr.html_url, carrier: isMergifyQueuePr(pr, repository) }
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
  const [allComments, changedFiles, reviews, reviewComments, openPulls, issueEvents] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
    // Only for quota evidence (#128): a PR review of the exhausted App voids it.
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
    // D-139: Codex threads and their replies (second-session QA path only).
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/comments`),
    // F-165: statuses are per head, so the gate reads which open PRs share it.
    apiAll(`/repos/${owner}/${repo}/pulls?state=open`),
    // F-013: verdicts and commands from before the last base change do not count.
    // Base change events are listed by the issue events endpoint, not the timeline.
    apiAll(`/repos/${owner}/${repo}/issues/${number}/events`),
  ]);
  const cutoff = lastBaseChange(issueEvents);
  // F-013 (QA c.6558749797): a base change without a readable time stops the
  // run. Dropping every comment is not enough, since a PR exempt from review
  // (only new tests) needs none and would still turn green. The failure path
  // marks all three statuses pending.
  if (cutoff === Infinity) throw new Error("A base change has no readable time; the gate cannot tell which verdicts count.");
  const comments = sinceBaseChange(allComments, cutoff, "created_at", { codexEdits: true });
  // PR reviews stay unfiltered, as before F-013: a review of the exhausted App
  // without a readable time must still void quota evidence (QA c.6561448849).
  // Filtering them by base change is a separate ticket.
  if (!targetsDefaultBranch(pr)) {
    // F-014, F-040: another open PR on this head may own its statuses, and
    // while the head is shared none of them may stay green (Codex review
    // c.6564729651), so the run clears them with the shared-head marker. It
    // never writes success there. An unread list counts as shared.
    const marker = sharesHeadWithOpenPr(pr, openPulls) ? SHARED_HEAD : NOT_DEFAULT_BASE;
    for (const statusContext of [authorizationContext, autoMergeContext, context]) {
      await setStatus(repository, pr.head.sha, marker, pr.html_url, statusContext);
    }
    console.log(`${context}: pending — ${marker.description}`);
    return;
  }

  const { metadata, result, mergeAuthorization, autoMergeEligible } = evaluatePullRequest({
    pr,
    files: changedFiles,
    comments,
    historyComments: allComments,
    prReviews: reviews,
    reviewComments,
    ownerLogin: owner,
    carriedHeads: await carriedHeads(api, owner, repo, pr, comments),
  });

  // F-040: the statuses of a shared head would also stand for the other PR.
  const shared = sharesHeadWithOpenPr(pr, openPulls);
  const gate = shared ? SHARED_HEAD : result;
  // Authorization first: a stale green one must never sit beside a new green gate.
  await setStatus(repository, pr.head.sha, shared ? SHARED_HEAD : (mergeAuthorization ?? WAITING), pr.html_url, authorizationContext);
  const eligible = shared ? SHARED_HEAD : (autoMergeEligible ?? { state: "pending", description: "Not eligible for auto-merge." });
  await setStatus(repository, pr.head.sha, eligible, pr.html_url, autoMergeContext);
  await setStatus(repository, pr.head.sha, gate, pr.html_url);
  // F-040 (QA c.6564767686): runs of two PRs can overlap, so the list read
  // above may predate a PR opened on this head since. After any green write
  // the run reads the list again; a PR opened later sees this one in its own
  // run. A failed re-read fails the run, which marks the head pending.
  const wroteGreen = !shared && [mergeAuthorization, eligible, gate].some((status) => status?.state === "success");
  if (wroteGreen && sharesHeadWithOpenPr(pr, await apiAll(`/repos/${owner}/${repo}/pulls?state=open`))) {
    for (const statusContext of [authorizationContext, autoMergeContext, context]) {
      await setStatus(repository, pr.head.sha, SHARED_HEAD, pr.html_url, statusContext);
    }
    console.log(`${context}: pending — ${SHARED_HEAD.description}`);
    return;
  }
  console.log(`${context}: ${gate.state} — ${gate.description}`);
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
    // An older green Auto-merge eligible must not outlive a failed run either
    // (QA c.6558749797). A queue carrier never gets this status, so none is
    // written for it.
    if (!knownHead.carrier) await setStatus(knownHead.repository, knownHead.sha, RUN_FAILED, knownHead.url, autoMergeContext);
    await setStatus(knownHead.repository, knownHead.sha, RUN_FAILED, knownHead.url);
  } catch (statusError) {
    console.error(`Could not mark the head pending after the failure: ${statusError.message}`);
  }
});
