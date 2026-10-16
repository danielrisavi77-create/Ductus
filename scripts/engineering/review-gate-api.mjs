// GitHub REST access for the review gate (review-gate.mjs), split out so the
// time limits and the D-101 carry-over walk can be tested with a fake fetch.
//
// Plan napada #231, 7.4: a stuck call must not hold the evaluator. Every call
// has its own limit (API_CALL_TIMEOUT_MS) and the whole carry-over check has a
// shared budget (CARRY_BUDGET_MS). Running out of either means nothing carries;
// the gate itself is still computed from verdicts on the current head.

import { MAX_MERGE_STEPS, carriedByCompare, carriedHeadCandidates } from "./review-gate-core.mjs";

export const API_CALL_TIMEOUT_MS = 15_000;
export const CARRY_BUDGET_MS = 60_000;

// Rejects as soon as `signal` aborts, even if `work` never settles (a fetch or
// body read that ignores the signal must not hold the evaluator either).
function untilAborted(work, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Returns `api(path, options)`. Each call aborts after `timeoutMs`, or earlier
 * when `options.signal` aborts (used for the carry-over budget). The limit also
 * covers reading the body.
 */
export function createApi({
  fetchImpl = globalThis.fetch,
  baseUrl = "https://api.github.com",
  token,
  timeoutMs = API_CALL_TIMEOUT_MS,
} = {}) {
  return async function api(path, options = {}) {
    const { signal: outer, ...rest } = options;
    const limit = AbortSignal.timeout(timeoutMs);
    const signal = outer ? AbortSignal.any([limit, outer]) : limit;
    return untilAborted(call(path, rest, signal), signal);
  };

  async function call(path, rest, signal) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...rest,
      signal,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(rest.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
}

// Walks first parents from `head` until a non-merge commit or the step limit,
// whichever comes first.
export async function firstParentPath(api, owner, repo, head, signal) {
  const path = [];
  let sha = head;
  for (let step = 0; step <= MAX_MERGE_STEPS && sha; step += 1) {
    const commit = await api(`/repos/${owner}/${repo}/commits/${sha}`, { signal });
    path.push({ sha: commit.sha, parents: commit.parents });
    if (commit.parents.length < 2) break;
    sha = commit.parents[0]?.sha;
  }
  return path;
}

// D-101: earlier heads whose verdicts still hold because only base merges
// followed and the PR diff is unchanged. Any API error, a timed-out call or an
// exhausted budget carries nothing.
export async function carriedHeads(api, owner, repo, pr, comments, { budgetMs = CARRY_BUDGET_MS, log = console.log } = {}) {
  const signal = AbortSignal.timeout(budgetMs);
  const compare = (range) => api(`/repos/${owner}/${repo}/compare/${range}?per_page=100`, { signal });
  let candidates;
  let current;
  try {
    const path = await firstParentPath(api, owner, repo, pr.head.sha, signal);
    const { heads, reason } = carriedHeadCandidates(comments, pr.head.sha, path);
    if (reason) log(`Carry-over refused: ${reason}.`);
    candidates = heads;
    if (candidates.length === 0) return new Set();
    current = await compare(`${pr.base.sha}...${pr.head.sha}`);
  } catch (error) {
    log(`Carry-over check failed closed: ${error.message}`);
    return new Set();
  }
  log(`Carry-over compares ${pr.base.sha}...<head> with ${pr.base.sha}...${pr.head.sha}.`);
  return carriedByCompare(candidates, current, (sha) => compare(`${pr.base.sha}...${sha}`), log);
}
