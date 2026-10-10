// Compose a canonical review/QA verdict with its report as one PR comment body.
// Usage: node verdict.mjs <pr> --agent <runtime:slot:reviewer|qa> --head <sha> --verdict PASS|FAIL|BLOCK
//        [--report <file>] [--qa-scope <text>] [--model <name>] [--fallback <slug — reason>]
// Print only: the reviewer posts the body through its runtime's App, the gate counts
// nothing else. Exit: 0 printed, 1 refused (stale head, bad report), 2 usage or read error.
import { readFile } from "node:fs/promises";

import { ghJson, sh } from "./gh.mjs";
import { checkReport, composeVerdict, headProblem, parseVerdictArgs, verifyComposed } from "./verdict-core.mjs";

const COMMENT_MAX = 65_000;

const o = parseVerdictArgs(process.argv.slice(2));
if (o.error) {
  console.error(o.error);
  process.exit(2);
}

const refuse = (msg) => {
  console.error(`refused: ${msg}`);
  process.exit(1);
};

let report = "";
let pr;
let refHead;
try {
  if (o.report) report = await readFile(o.report, "utf8");
  pr = await ghJson(["api", `repos/{owner}/{repo}/pulls/${o.pr}`]);
  const ref = pr.head?.ref;
  if (!ref) throw new Error("no head ref in PR response");
  const out = await sh("git", ["ls-remote", "origin", `refs/heads/${ref}`]);
  refHead = out.trim().split(/\s+/)[0] || null;
} catch (e) {
  console.error(`read failed: ${String(e?.stderr || e?.message || e).trim().split("\n")[0]}`);
  process.exit(2);
}

const stale = headProblem({ reviewed: o.head, prHead: pr.head?.sha, refHead, state: pr.state });
if (stale) refuse(stale);
const bad = checkReport(report, o);
if (bad) refuse(bad);

const body = composeVerdict({ ...o, report });
const parsed = verifyComposed(body, o);
if (parsed) refuse(parsed);
if (body.length > COMMENT_MAX) refuse(`comment is ${body.length} characters; shorten the report`);

process.stdout.write(body);
