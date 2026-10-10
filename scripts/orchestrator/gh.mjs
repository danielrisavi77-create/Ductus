// Thin read-only wrappers around `gh` (no shell, no network beyond gh).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GATE_CONTEXT } from "./orchestrator-core.mjs";

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

export async function gateStatus(sha) {
  const st = await ghJson(["api", `repos/{owner}/{repo}/commits/${sha}/status`]);
  return (st.statuses ?? []).find((s) => s.context === GATE_CONTEXT) ?? null;
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
