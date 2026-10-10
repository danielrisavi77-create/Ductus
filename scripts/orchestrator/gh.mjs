// Thin read-only wrappers around `gh` (no shell, no network beyond gh).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { pickGate } from "./orchestrator-core.mjs";

const run = promisify(execFile);

export async function sh(cmd, args) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return stdout;
}

export async function ghJson(args) {
  const out = (await sh("gh", args)).trim();
  if (!out) throw new Error(`empty response from gh ${args.slice(0, 2).join(" ")}`);
  return JSON.parse(out);
}

/** Paginated REST list, flattened. */
export async function ghList(path) {
  const pages = await ghJson(["api", "--paginate", "--slurp", path]);
  if (!Array.isArray(pages)) throw new Error(`unexpected response for ${path}`);
  return pages.flat();
}

export const prComments = (n) => ghList(`repos/{owner}/{repo}/issues/${n}/comments?per_page=100`);

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
