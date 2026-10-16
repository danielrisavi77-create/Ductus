import { readFile } from "node:fs/promises";
import process from "node:process";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import { evaluatePullRequest, prNumberFromEvent } from "./review-gate-core.mjs";

const context = "Engineering review gate";

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

async function setStatus(repository, sha, result, targetUrl) {
  const [owner, repo] = repository.split("/");
  await api(`/repos/${owner}/${repo}/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state: result.state,
      context,
      description: result.description.slice(0, 140),
      target_url: targetUrl,
    }),
  });
}

// A run that fails after the head is known marks that head pending, so an
// older success never outlives a failed re-evaluation.
const RUN_FAILED = { state: "pending", description: "Gate run failed before a verdict; re-run the gate." };
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
  const [comments, changedFiles, reviews] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
    // Only for quota evidence (#128): a PR review of the exhausted App voids it.
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
  ]);

  const { metadata, result } = evaluatePullRequest({
    pr,
    files: changedFiles,
    comments,
    prReviews: reviews,
    ownerLogin: owner,
    carriedHeads: await carriedHeads(api, owner, repo, pr, comments),
  });

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
    await setStatus(knownHead.repository, knownHead.sha, RUN_FAILED, knownHead.url);
  } catch (statusError) {
    console.error(`Could not mark the head pending after the failure: ${statusError.message}`);
  }
});
