// Thin read-only wrappers around `gh` (no shell, no network beyond gh).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { changedPaths, pickGate } from "./orchestrator-core.mjs";

const run = promisify(execFile);

export async function sh(cmd, args) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return stdout;
}

export async function ghJson(args, exec = sh) {
  const out = (await exec("gh", args)).trim();
  if (!out) throw new Error(`empty response from gh ${args.slice(0, 2).join(" ")}`);
  return JSON.parse(out);
}

const MAX_PAGES = 50;

/**
 * REST list, every page, flattened. Pages are requested one by one with
 * `page=N`: gh --paginate follows Link headers that point at
 * repositories/{id}/..., which the cloud session proxy refuses (HTTP 403).
 * `key` picks the array out of an object page (check-runs). `exec` is
 * injectable for tests.
 */
export async function ghList(path, exec = sh, { key } = {}) {
  const per = Number(new URLSearchParams(path.split("?")[1] ?? "").get("per_page")) || 30;
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await ghJson(["api", `${path}${sep}page=${page}`], exec);
    const items = key ? body?.[key] : body;
    if (!Array.isArray(items)) throw new Error(`unexpected response for ${path}`);
    out.push(...items);
    if (items.length < per) return out;
  }
  throw new Error(`${path}: more than ${MAX_PAGES} pages`);
}

export const prComments = (n) => ghList(`repos/{owner}/{repo}/issues/${n}/comments?per_page=100`);

const FILES_CAP = 3000; // GitHub lists at most 3000 files of a pull request

/**
 * Every path a PR touches (a rename counts under both names), all pages. The
 * one files read per PR, shared by pr-overlap and pr-status. Throws when the
 * read fails or the list may have been cut at the API cap.
 */
export async function prPaths(n, list = ghList) {
  const files = await list(`repos/{owner}/{repo}/pulls/${n}/files?per_page=100`);
  if (files.length >= FILES_CAP) throw new Error(`file list of #${n} reached the ${FILES_CAP}-file API cap`);
  return changedPaths(files);
}

/**
 * REST pull object -> the gh-CLI field names the scripts use. gh pr list/view
 * go through GraphQL, which cloud sessions cannot reach (HTTP 403).
 */
export function toPr(p) {
  const state = p.merged_at ? "MERGED" : String(p.state ?? "").toUpperCase();
  const mergeable = p.mergeable === true ? "MERGEABLE" : p.mergeable === false ? "CONFLICTING" : "UNKNOWN";
  return {
    number: p.number,
    title: p.title,
    body: p.body ?? "",
    state,
    isDraft: Boolean(p.draft),
    headRefOid: p.head?.sha,
    baseRefName: p.base?.ref,
    createdAt: p.created_at,
    mergedAt: p.merged_at ?? null,
    mergeable,
    autoMergeRequest: p.auto_merge ?? null,
  };
}

/** Open PRs (ascending) with `paths`: string[] or null when the files read failed. */
export async function openPrsWithPaths({ list = ghList, paths = prPaths } = {}) {
  const prs = (await list("repos/{owner}/{repo}/pulls?state=open&per_page=100")).map(toPr);
  prs.sort((a, b) => a.number - b.number);
  return Promise.all(prs.map(async (pr) => ({ ...pr, paths: await paths(pr.number).catch(() => null) })));
}

/**
 * One PR. GitHub computes `mergeable` in the background and answers null on
 * the first read, so an UNKNOWN is read again once after a short wait.
 */
export async function prView(n, { json = ghJson, waitMs = 3000 } = {}) {
  const read = async () => toPr(await json(["api", `repos/{owner}/{repo}/pulls/${n}`]));
  const pr = await read();
  if (pr.state !== "OPEN" || pr.mergeable !== "UNKNOWN") return pr;
  await new Promise((r) => setTimeout(r, waitMs));
  return read();
}

/** Merged PRs into `base` with mergedAt >= since (ISO date), ascending. */
export async function mergedPrs(since, { base = "main", list = ghList } = {}) {
  const from = Date.parse(since);
  const prs = await list(`repos/{owner}/{repo}/pulls?state=closed&base=${base}&per_page=100`);
  return prs.map(toPr)
    .filter((p) => p.mergedAt && Date.parse(p.mergedAt) >= from)
    .sort((a, b) => a.number - b.number);
}

/**
 * Check runs and commit statuses of a commit in statusCheckRollup shape
 * ({name|context, conclusion|state, status, startedAt, completedAt}).
 */
export async function checkRollup(sha, { list = ghList } = {}) {
  const runs = await list(`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, undefined, { key: "check_runs" });
  const statuses = await list(`repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`);
  return [
    ...runs.map((r) => ({
      // check suite id stands in for the workflow name REST does not give
      workflowName: String(r.check_suite?.id ?? ""),
      name: r.name,
      status: String(r.status ?? "").toUpperCase(),
      conclusion: r.conclusion ? String(r.conclusion).toUpperCase() : (r.status === "completed" ? "" : String(r.status ?? "").toUpperCase()),
      startedAt: r.started_at,
      completedAt: r.completed_at,
    })),
    ...statuses.map((s) => ({
      context: s.context,
      state: String(s.state ?? "").toUpperCase(),
      startedAt: s.created_at,
    })),
  ];
}

/**
 * Newest gate status on the commit, from the full statuses list (every status
 * ever posted, not the combined roll-up). null = no gate status; throws when
 * the read fails. `list` is injectable for tests.
 */
export async function gateStatus(sha, list = ghList) {
  return pickGate(await list(`repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`));
}

/** gateStatus with retries; a failed read yields {error}, never "no status". */
export async function readGate(sha, { read = gateStatus, tries = 2 } = {}) {
  let error = "unknown";
  for (let i = 0; i < tries; i += 1) {
    try {
      return await read(sha);
    } catch (e) {
      error = String(e?.stderr || e?.message || e).trim().split("\n")[0];
    }
  }
  return { error };
}

let cachedRepo;
export function repoId() {
  cachedRepo ??= ghJson(["api", "repos/{owner}/{repo}"]).then((r) => ({
    owner: r.owner.login,
    repo: r.name,
  }));
  return cachedRepo;
}

/**
 * Review threads through the REST route cloud sessions are given
 * (GET pulls/{n}/ccr/review_threads), in the GraphQL node shape that
 * summarizeThreads reads. Authors come from one pulls/{n}/comments list.
 */
export async function reviewThreads(n, { json = ghJson, list = ghList } = {}) {
  const threads = await json(["api", `repos/{owner}/{repo}/pulls/${n}/ccr/review_threads`]);
  if (!Array.isArray(threads)) throw new Error("unexpected review_threads response");
  const open = threads.filter((t) => !t.resolved);
  const login = new Map();
  if (open.length) {
    for (const c of await list(`repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`)) login.set(c.id, c.user?.login);
  }
  return threads.map((t) => ({
    isResolved: Boolean(t.resolved),
    comments: { nodes: [{ author: { login: login.get(t.comment_ids?.[0]) ?? "?" } }] },
  }));
}
