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

/** Paginated REST list, flattened. `exec` is injectable for tests. */
export async function ghList(path, exec = sh) {
  const pages = await ghJson(["api", "--paginate", "--slurp", path], exec);
  if (!Array.isArray(pages)) throw new Error(`unexpected response for ${path}`);
  return pages.flat();
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

/** Open PRs (ascending) with `paths`: string[] or null when the files read failed. */
export async function openPrsWithPaths(fields, { json = ghJson, paths = prPaths } = {}) {
  const prs = await json(["pr", "list", "--state", "open", "--limit", "200", "--json", fields]);
  prs.sort((a, b) => a.number - b.number);
  return Promise.all(prs.map(async (pr) => ({ ...pr, paths: await paths(pr.number).catch(() => null) })));
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
  cachedRepo ??= ghJson(["repo", "view", "--json", "owner,name"]).then((r) => ({
    owner: r.owner.login,
    repo: r.name,
  }));
  return cachedRepo;
}

export async function reviewThreads(n) {
  const { owner, repo } = await repoId();
  const q = "query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}}}}";
  const res = await ghJson(["api", "graphql", "-f", `query=${q}`, "-F", `n=${n}`, "-f", `o=${owner}`, "-f", `r=${repo}`]);
  const nodes = res?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(nodes)) throw new Error("no reviewThreads in GraphQL response");
  return nodes;
}
