// Compose a canonical review/QA verdict with its report as one PR comment body.
// Usage: node verdict.mjs <pr> --agent <runtime:slot:reviewer|qa> --head <sha> --verdict PASS|FAIL|BLOCK
//        [--report <file>] [--qa-scope <text>] [--model <name>] [--fallback <slug — reason>]
// Print only: stdout is exactly the body, the reviewer posts it through its runtime's App.
// Reads are three GETs of this repository, each checked by readOnlyCall before it runs.
// Exit: 0 printed, 1 refused (author, stale head, bad report), 2 usage or read error.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  EXPECTED_REPO, authorProblem, checkReport, composeVerdict, headProblem, parseVerdictArgs,
  readOnlyCall, verifyComposed,
} from "./verdict-core.mjs";

const COMMENT_MAX = 65_000;
// gh would otherwise let these point the reads at another repository or host
const DROPPED_ENV = new Set(["GH_REPO", "GH_HOST", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]);

export const ghEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !DROPPED_ENV.has(k)));

async function execRead(cmd, args, env) {
  const { stdout } = await promisify(execFile)(cmd, args, { env: ghEnv(env), maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/** Testable entry: the gh reader, readFile, env and the two streams are injected. Returns the exit code. */
export async function run(argv, { ghRead = execRead, read = readFile, env = process.env, out, err }) {
  const o = parseVerdictArgs(argv);
  if (o.error) {
    err(`${o.error}\n`);
    return 2;
  }
  const get = async (path) => {
    const args = ["api", path];
    if (!readOnlyCall("gh", args)) throw new Error(`not a read-only call: gh ${args.join(" ")}`);
    const text = String(await ghRead("gh", args, env)).trim();
    if (!text) throw new Error(`empty response from gh api ${path}`);
    return JSON.parse(text);
  };

  let report = "";
  let pr;
  let refHead;
  try {
    if (o.report) report = await read(o.report, "utf8");
    const repo = await get("repos/{owner}/{repo}");
    if (String(repo.full_name ?? "").toLowerCase() !== EXPECTED_REPO.toLowerCase()) {
      err(`refused: this checkout points at ${repo.full_name ?? "?"}, not ${EXPECTED_REPO}\n`);
      return 1;
    }
    pr = await get(`repos/${EXPECTED_REPO}/pulls/${o.pr}`);
    const ref = pr.head?.ref;
    if (!ref) throw new Error("no head ref in PR response");
    if (pr.head?.repo?.full_name?.toLowerCase() !== EXPECTED_REPO.toLowerCase()) {
      err("refused: the PR head is in a fork; the branch ref cannot be checked here\n");
      return 1;
    }
    const enc = ref.split("/").map(encodeURIComponent).join("/");
    refHead = (await get(`repos/${EXPECTED_REPO}/git/ref/heads/${enc}`)).object?.sha ?? null;
  } catch (e) {
    err(`read failed: ${String(e?.stderr || e?.message || e).trim().split("\n")[0]}\n`);
    return 2;
  }

  const problem =
    authorProblem(pr.body, o.agent) ??
    headProblem({ reviewed: o.head, prHead: pr.head?.sha, refHead, state: pr.state }) ??
    checkReport(report, o);
  if (problem) {
    err(`refused: ${problem}\n`);
    return 1;
  }
  const body = composeVerdict({ ...o, report });
  const parsed = verifyComposed(body, o);
  if (parsed) {
    err(`refused: ${parsed}\n`);
    return 1;
  }
  if (body.length > COMMENT_MAX) {
    err(`refused: comment is ${body.length} characters; shorten the report\n`);
    return 1;
  }
  out(body);
  err(`bound to head ${o.head} of #${o.pr}; check the head again right before posting\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await run(process.argv.slice(2), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
