// GitHub REST access for the review gate (review-gate.mjs), split out so the
// time limits and the D-101 carry-over walk can be tested with a fake fetch.
//
// Plan napada #231, 7.4: a stuck call must not hold the evaluator. Every call
// has its own limit (API_CALL_TIMEOUT_MS) and the whole carry-over check has a
// shared budget (CARRY_BUDGET_MS). Running out of either means nothing carries;
// the gate itself is still computed from verdicts on the current head.

import { MAX_MERGE_STEPS, carriedByCompare, carriedHeadCandidates, foundCarryHeads, namedCarryHeads } from "./review-gate-core.mjs";

const SHA_RE = /^[0-9a-f]{40}$/;

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

// True only when GitHub says `sha` is contained in `baseRef` (compare status
// "behind" or "identical"). Any other answer, or an error, is false.
async function inBase(api, owner, repo, baseRef, sha, signal) {
  const result = await api(`/repos/${owner}/${repo}/compare/${encodeURIComponent(baseRef)}...${sha}?per_page=1`, { signal });
  return result?.status === "behind" || result?.status === "identical";
}

// Walks first parents from `head` until a non-merge commit or the step limit,
// whichever comes first. A two-parent merge is marked `mergesBase` when its
// second parent is in the base branch (#231, question 1); an octopus merge is
// never checked and never carries.
// With `stopAt` (lower-case SHAs), the walk also ends once it has passed every
// one of them (F-148): nothing named lies further back. A name may be a prefix
// (F-027): the first walked SHA that starts with it ends the wait for it.
// With `path`, the steps walked so far stay readable after an error.
export async function firstParentPath(api, owner, repo, head, signal, baseRef, stopAt, path = []) {
  const pending = stopAt ? new Set(stopAt) : null;
  let sha = head;
  for (let step = 0; step <= MAX_MERGE_STEPS && sha; step += 1) {
    if (pending && pending.size === 0) break;
    const commit = await api(`/repos/${owner}/${repo}/commits/${sha}`, { signal });
    const parents = commit.parents;
    // p06f: a reached commit is in `path` before its own second parent is
    // checked, so an error on that check keeps it readable; it stays
    // `mergesBase: false` until GitHub confirms, so nothing behind it carries.
    const reached = { sha: commit.sha, parents, mergesBase: false };
    path.push(reached);
    const walked = String(commit.sha).toLowerCase();
    for (const name of pending ?? []) if (walked.startsWith(name)) pending.delete(name);
    if (parents.length === 2 && typeof baseRef === "string" && baseRef !== "" && typeof parents[1]?.sha === "string") {
      reached.mergesBase = await inBase(api, owner, repo, baseRef, parents[1].sha, signal);
    }
    if (parents.length < 2) break;
    sha = parents[0]?.sha;
  }
  return path;
}

// F-027: heads the walk found behind base merges only, kept when the check
// could not finish, so a FAIL or BLOCK on them still blocks. They never carry a
// PASS, an override or a command: only `negativeHead` reads them.
const holdNegatives = (carried, heads) => Object.defineProperty(carried, "heldNegatives", { value: new Set(heads) });

const wholeEntry = (item) => ["path", "mode", "type"].every((key) => typeof item?.[key] === "string" && item[key] !== "");

// D-101: earlier heads whose verdicts still hold because only base merges
// followed and the PR diff is unchanged. Any API error, a timed-out call or an
// exhausted budget carries nothing, except that a negative on a head already
// found stays (`holdNegatives`).
export async function carriedHeads(api, owner, repo, pr, comments, { budgetMs = CARRY_BUDGET_MS, log = console.log } = {}) {
  const signal = AbortSignal.timeout(budgetMs);
  // F-046: each compared file gets its whole tree entry (mode and type) on both
  // sides of that compare: at the compared head and at the compare's own merge
  // base, read at the base-side path (the old path of a rename). "absent" when
  // the path is not in that tree. A compare without a readable merge base, or a
  // tree that is not whole, throws, so nothing carries. Each tree is read once.
  const trees = new Map();
  const treeEntries = (sha) => {
    if (!trees.has(sha)) {
      trees.set(sha, api(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, { signal }).then((tree) => {
        if (tree?.truncated !== false || !Array.isArray(tree?.tree)) throw new Error(`the tree of ${sha} could not be read whole`);
        // QA c.6657595775: an entry without `path`, `mode` and `type` as
        // non-empty strings would build a key like "undefined undefined" that
        // matches on both sides, so it throws and nothing carries.
        if (!tree.tree.every(wholeEntry)) throw new Error(`the tree of ${sha} has an entry without path, mode and type`);
        return new Map(tree.tree.map((item) => [item.path, `${item.mode} ${item.type}`]));
      }));
    }
    return trees.get(sha);
  };
  const compare = async (range) => {
    const result = await api(`/repos/${owner}/${repo}/compare/${range}?per_page=100`, { signal });
    const head = range.split("...")[1];
    const mergeBase = String(result?.merge_base_commit?.sha ?? "").toLowerCase();
    if (!SHA_RE.test(mergeBase)) throw new Error(`the compare ${range} has no merge base`);
    const atHead = await treeEntries(head);
    const atBase = await treeEntries(mergeBase);
    const files = Array.isArray(result?.files)
      ? result.files.map((file) => ({
          ...file,
          entry: atHead.get(file?.filename) ?? "absent",
          baseEntry: atBase.get(file?.previous_filename ?? file?.filename) ?? "absent",
        }))
      : result?.files;
    return { ...result, files };
  };
  const path = [];
  const found = () => foundCarryHeads(comments, pr.head.sha, path);
  let candidates;
  let current;
  let base;
  try {
    // No trusted verdict, override or command names an earlier head: nothing
    // could carry, so the walk and its API calls are skipped (F-148).
    const named = namedCarryHeads(comments, pr.head.sha);
    if (named.size === 0) return new Set();
    await firstParentPath(api, owner, repo, pr.head.sha, signal, pr.base?.ref, named, path);
    const { heads, reason } = carriedHeadCandidates(comments, pr.head.sha, path);
    if (reason) {
      log(`Carry-over refused: ${reason}.`);
      return holdNegatives(new Set(), found());
    }
    candidates = heads;
    if (candidates.length === 0) return new Set();
    // F-046: every compare is anchored on the live tip of the base branch, read
    // once, not on `pr.base.sha`, which GitHub may leave on an older commit.
    // Against the live tip a merge that kept the PR's side of a file main has
    // since changed shows main's change reverted, so the diffs differ.
    if (typeof pr.base?.ref !== "string" || pr.base.ref === "") throw new Error("the PR has no base branch name");
    const tip = await api(`/repos/${owner}/${repo}/branches/${encodeURIComponent(pr.base.ref)}`, { signal });
    base = String(tip?.commit?.sha ?? "").toLowerCase();
    if (!SHA_RE.test(base)) throw new Error("the base branch tip could not be read");
    current = await compare(`${base}...${pr.head.sha}`);
  } catch (error) {
    log(`Carry-over check failed closed: ${error.message}`);
    return holdNegatives(new Set(), found());
  }
  log(`Carry-over compares ${base}...<head> with ${base}...${pr.head.sha} (live tip of ${pr.base.ref}).`);
  let failed = false;
  const compareHead = (sha) => compare(`${base}...${sha}`).catch((error) => {
    failed = true;
    throw error;
  });
  const carried = await carriedByCompare(candidates, current, compareHead, log);
  return failed ? holdNegatives(carried, found()) : carried;
}
