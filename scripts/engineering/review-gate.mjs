import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  MAX_MERGE_STEPS,
  carriedHeadCandidates,
  evaluatePullRequest,
  sameChange,
} from "./review-gate-core.mjs";

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

// Walks first parents from `head` until a non-merge commit or the step limit,
// whichever comes first.
async function firstParentPath(owner, repo, head) {
  const path = [];
  let sha = head;
  for (let step = 0; step <= MAX_MERGE_STEPS && sha; step += 1) {
    const commit = await api(`/repos/${owner}/${repo}/commits/${sha}`);
    path.push({ sha: commit.sha, parents: commit.parents });
    if (commit.parents.length < 2) break;
    sha = commit.parents[0]?.sha;
  }
  return path;
}

// D-101: earlier heads whose verdicts still hold because only base merges
// followed and the PR diff is unchanged. Any API error carries nothing.
async function carriedHeads(owner, repo, pr, comments) {
  const carried = new Set();
  const compare = (range) => api(`/repos/${owner}/${repo}/compare/${range}?per_page=100`);
  let candidates;
  let current;
  try {
    const path = await firstParentPath(owner, repo, pr.head.sha);
    const { heads, reason } = carriedHeadCandidates(comments, pr.head.sha, path);
    if (reason) console.log(`Carry-over refused: ${reason}.`);
    candidates = heads;
    if (candidates.length === 0) return carried;
    current = await compare(`${pr.base.sha}...${pr.head.sha}`);
  } catch (error) {
    console.log(`Carry-over check failed closed: ${error.message}`);
    return carried;
  }
  for (const sha of candidates) {
    const range = `${pr.base.sha}...${sha}`;
    try {
      const same = sameChange(current, await compare(range));
      console.log(
        `Carry-over ${same ? "accepted" : "rejected"}: head ${sha}, base ${pr.base.sha}, ` +
          `compared ${pr.base.sha}...${pr.head.sha} with ${range}.`,
      );
      if (same) carried.add(sha);
    } catch (error) {
      // A head that is gone or unreadable simply does not carry.
      console.log(`Carry-over check for ${sha} failed closed: ${error.message}`);
    }
  }
  return carried;
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
  const [comments, changedFiles] = await Promise.all([
    apiAll(`/repos/${owner}/${repo}/issues/${number}/comments`),
    apiAll(`/repos/${owner}/${repo}/pulls/${number}/files`),
  ]);

  const { metadata, result } = evaluatePullRequest({
    pr,
    files: changedFiles,
    comments,
    ownerLogin: owner,
    carriedHeads: await carriedHeads(owner, repo, pr, comments),
  });

  await setStatus(repository, pr.head.sha, result, pr.html_url);
  console.log(`${context}: ${result.state} — ${result.description}`);
  if (metadata?.ok) {
    console.log(`Risk: declared=${metadata.risk}, minimum=${metadata.minimumRisk}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
