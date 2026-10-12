// Stall check for the orchestrator (DAN-139), step 0 of the heartbeat. Read-only:
// every gh/git call passes readOnlyCall() first; no files written, no cache.
// Usage: node health.mjs   Exit 0 = all checked, nothing stalls; 1 = something
// stalls (FAIL); 2 = no FAIL, but some check could not run (NEPROVJERENO).
import { execFile } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ghList, toPr } from "./gh.mjs";
import {
  MANUAL, checkFailStalls, checkMainCi, checkQueue, checkSafetyNet, exitCode, hookTargets, joinPath,
  parseWorktrees, queueItems, render, watched,
} from "./health-core.mjs";

export const QUEUE_ISSUE = 87; // coordination issue (docs/ORKESTRATOR.md §8)

/**
 * True only for the calls this script needs: `gh api <path>` (a GET with no
 * flags and a non-empty path, never GraphQL) and `git worktree list`. Lists are read page by page
 * (gh.mjs ghList), so neither `--paginate` nor `gh pr list` is needed; both
 * fail in cloud sessions (Link headers to repositories/{id}, GraphQL 403).
 */
export function readOnlyCall(cmd, args) {
  const a = args.map(String);
  if (cmd === "git") return a.join(" ") === "worktree list --porcelain -z";
  if (cmd !== "gh") return false;
  return a.length === 2 && a[0] === "api" && a[1] !== "" && !a[1].startsWith("-") && !a[1].startsWith("graphql");
}

const run = promisify(execFile);
async function defaultExec(cmd, args) {
  const { stdout } = await run(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return stdout;
}

// `syntax`: true = parses, false = syntax error, null = node --check could not be run.
export const defaultFs = {
  size: (p) => { try { return statSync(p).size; } catch { return null; } },
  read: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } },
  syntax: async (p) => {
    try {
      // --check only parses; NODE_OPTIONS is cleared so no preload runs in the guard.
      await run(process.execPath, ["--check", p], { timeout: 15000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" } });
      return true;
    } catch (e) {
      return typeof e?.code === "number" && !e.killed ? false : null;
    }
  },
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
  // Every page is an array of objects (comments, statuses, PRs); anything else is not a list.
  const list = async (path, key) => {
    const items = await ghList(path, call, { key });
    if (!items.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new Error(`unexpected page for ${path}`);
    return items;
  };
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
    const targets = hookTargets(settings);
    // The syntax check runs a child process, so it is awaited here and the core reads the results.
    const parsed = new Map();
    if (typeof fsView.syntax === "function") {
      await Promise.all(worktrees.flatMap((w) => targets.filter((t) => t.endsWith(".mjs")).map(async (rel) => {
        const file = joinPath(w.path, rel);
        parsed.set(file, (await fsView.size(file)) > 0 ? await fsView.syntax(file) : null);
      })));
    }
    const view = typeof fsView.syntax === "function" ? { ...fsView, syntax: (file) => parsed.get(file) ?? null } : fsView;
    return checkSafetyNet({ worktrees, targets, pinned, fsView: view });
  });

  let prs = null;
  let comments = new Map();
  await guard("pr-list", async () => {
    const all = (await list("repos/{owner}/{repo}/pulls?state=all&per_page=100")).map(toPr);
    if (!all.length) throw new Error("PR list is empty");
    const read = await Promise.all(all.filter(watched).map((pr) =>
      list(`repos/{owner}/{repo}/issues/${pr.number}/comments?per_page=100`).then((c) => [pr.number, c], () => null)));
    comments = new Map(read.filter(Boolean));
    prs = all;
    return [];
  });
  if (prs) {
    await guard("fail-bez-pusha", async () => checkFailStalls({ prs, comments, now }));
    await guard("red-87", async () => {
      const raw = await list(`repos/{owner}/{repo}/issues/${QUEUE_ISSUE}/comments?per_page=100`);
      if (!raw.length) throw new Error(`issue ${QUEUE_ISSUE} returned no comments`);
      const queue = queueItems(raw);
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
    const checkRuns = await list(`repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, "check_runs");
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
