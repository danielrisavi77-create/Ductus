import { readFile } from "node:fs/promises";
import process from "node:process";

import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { evaluateGate } from "./review-gate-core.mjs";

const context = "Engineering review gate";

async function api(path, options = {}) {
  const response = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

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

function prNumberFromEvent(event) {
  if (event.pull_request?.number) return event.pull_request.number;
  if (event.issue?.pull_request && event.issue?.number) return event.issue.number;
  return null;
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

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  const number = prNumberFromEvent(event);

  if (!repository || !number) {
    console.log("No pull request in this event; nothing to evaluate.");
    return;
  }

  const [owner, repo] = repository.split("/");
  const pr = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  const [comments, reviews, reviewComments, changedFiles] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/reviews`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
  ]);

  const metadata = evaluateMetadata({
    body: pr.body ?? "",
    files: changedFiles.map((item) => item.filename),
  });

  const result = metadata.ok
    ? evaluateGate({
        body: pr.body ?? "",
        headSha: pr.head.sha,
        ownerLogin: owner,
        comments,
        reviews,
        reviewComments,
      })
    : {
        state: "failure",
        description: metadata.message,
      };

  await setStatus(repository, pr.head.sha, result, pr.html_url);
  console.log(`${context}: ${result.state} — ${result.description}`);
  if (metadata.ok) {
    console.log(`Risk: declared=${metadata.risk}, minimum=${metadata.minimumRisk}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
