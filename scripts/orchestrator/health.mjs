// Stall check for the orchestrator (DAN-139), step 0 of the heartbeat. Read-only:
// every gh/git call passes readOnlyCall() first; no files written, no cache.
// Usage: node health.mjs   Exit 0 = all checked, nothing stalls; 1 = something
// stalls (FAIL); 2 = no FAIL, but some check could not run (NEPROVJERENO).
import { execFile } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  MANUAL, checkFailStalls, checkMainCi, checkQueue, checkSafetyNet, exitCode, hookTargets, joinPath,
  parseWorktrees, queueItems, render, watched,
} from "./health-core.mjs";

export const QUEUE_ISSUE = 87; // coordination issue (docs/ORKESTRATOR.md §8)
const PR_LIMIT = 1000;
const PR_LIST_FLAGS = new Set(["--state", "--limit", "--json"]);

/** True only for the calls this script needs: `gh api` GET, `gh pr list`, `git worktree list`. */
export function readOnlyCall(cmd, args) {
  const a = args.map(String);
  if (cmd === "git") return a.join(" ") === "worktree list --porcelain -z";
  if (cmd !== "gh") return false;
  if (a[0] === "api") {
    const rest = a.slice(1).filter((x) => x !== "--paginate" && x !== "--slurp");
    return rest.length === 1 && !rest[0].startsWith("-") && !rest[0].startsWith("graphql");
  }
  if (a[0] === "pr" && a[1] === "list") {
    return a.slice(2).every((x, i) => (i % 2 === 0 ? PR_LIST_FLAGS.has(x) : !x.startsWith("-")));
  }
  return false;
}

const run = promisify(execFile);
async function defaultExec(cmd, args) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return stdout;
}

const defaultFs = {
  size: (p) => { try { return statSync(p).size; } catch { return null; } },
  read: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } },
};

const reason = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0].slice(0, 160);

/** All checks; `exec`, `fsView` and `now` (ms) are injectable for tests. Returns {findings, code, lines}. */
export async function health({ exec = defaultExec, fsView = defaultFs, now = Date.now() } = {}) {
  const call = async (cmd, args) => {
    if (!readOnlyCall(cmd, args)) throw new Error(`refused non-read call: ${cmd} ${args[0]}`);
    return exec(cmd, args);
  };
  const json = async (args) => {
    const out = String(await call("gh", args)).trim();
    if (!out) throw new Error(`empty response from gh ${args[0]}`);
    return JSON.parse(out);
  };
  const pages = async (path) => {
    const p = await json(["api", "--paginate", "--slurp", path]);
    if (!Array.isArray(p)) throw new Error(`unexpected response for ${path}`);
    return p;
  };
  const list = async (path) => (await pages(path)).flat();
  const findings = [];
  const guard = async (check, fn) => {
    try {
      findings.push(...(await fn()));
    } catch (e) {
      findings.push({ level: "NEPROVJERENO", check, text: `nije izvedeno: ${reason(e).replace(/[^\x20-\x7eÀ-ſ]/g, "?")}` });
    }
  };

  await guard("cc-safety-net", async () => {
    const worktrees = parseWorktrees(await call("git", ["worktree", "list", "--porcelain", "-z"]));
    const root = worktrees[0]?.path;
    if (!root) throw new Error("git worktree list is empty");
    const settings = JSON.parse(fsView.read(joinPath(root, ".claude/settings.json")) ?? "null");
    const pinned = JSON.parse(fsView.read(joinPath(root, "package.json")) ?? "null")?.devDependencies?.["cc-safety-net"];
    return checkSafetyNet({ worktrees, targets: hookTargets(settings), pinned, fsView });
  });

  let prs = null;
  let comments = new Map();
  await guard("pr-list", async () => {
    const all = await json(["pr", "list", "--state", "all", "--limit", String(PR_LIMIT),
      "--json", "number,state,isDraft,headRefOid,headRefName"]);
    if (!Array.isArray(all) || all.length >= PR_LIMIT) throw new Error("PR list missing or possibly cut at the limit");
    const read = await Promise.all(all.filter(watched).map((pr) =>
      list(`repos/{owner}/{repo}/issues/${pr.number}/comments?per_page=100`).then((c) => [pr.number, c], () => null)));
    comments = new Map(read.filter(Boolean));
    prs = all;
    return [];
  });
  if (prs) {
    await guard("fail-bez-pusha", async () => checkFailStalls({ prs, comments, now }));
    await guard("red-87", async () => {
      const queue = queueItems(await list(`repos/{owner}/{repo}/issues/${QUEUE_ISSUE}/comments?per_page=100`));
      return checkQueue({ queue, prs, comments, now });
    });
  } else {
    findings.push({ level: "NEPROVJERENO", check: "fail-bez-pusha", text: "popis PR-ova nije pročitan" });
    findings.push({ level: "NEPROVJERENO", check: "red-87", text: "popis PR-ova nije pročitan" });
  }

  await guard("main-ci", async () => {
    const branch = await json(["api", "repos/{owner}/{repo}/branches/main"]);
    const sha = branch?.commit?.sha;
    const rsc = branch?.protection?.required_status_checks;
    const required = [...new Set([...(rsc?.contexts ?? []), ...(rsc?.checks ?? []).map((c) => c?.context)])].filter(Boolean);
    const checkRuns = (await pages(`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`))
      .flatMap((p) => { if (!Array.isArray(p?.check_runs)) throw new Error("unexpected check-runs page"); return p.check_runs; });
    const statuses = await list(`repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`);
    return checkMainCi({ sha, required, checkRuns, statuses });
  });

  findings.push(...MANUAL);
  const code = exitCode(findings);
  return { findings, code, lines: render(findings, new Date(now).toISOString()) };
}

const self = fileURLToPath(import.meta.url);
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
if (process.argv[1] && real(process.argv[1]) === real(self)) {
  const { lines, code } = await health();
  for (const line of lines) console.log(line);
  process.exitCode = code;
}
