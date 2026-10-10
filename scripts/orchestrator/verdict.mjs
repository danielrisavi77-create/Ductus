// Compose a canonical review/QA verdict with its report as one PR comment.
// Usage: node verdict.mjs <pr> --agent <runtime:slot:reviewer|qa> --head <sha> --verdict PASS|FAIL|BLOCK
//        [--report <file>] [--qa-scope <text>] [--model <name>] [--fallback <slug — reason>] [--post]
// Without --post it only prints the body. Exit: 0 ok, 1 refused (stale head, bad report,
// comment not App-authenticated), 2 usage or read error.
import { readFile } from "node:fs/promises";

import { APP_RUNTIMES } from "../engineering/review-gate-core.mjs";
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

if (!o.post) {
  process.stdout.write(body);
  process.exit(0);
}

let posted;
try {
  posted = await ghJson(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${o.pr}/comments`, "-f", `body=${body}`]);
} catch (e) {
  console.error(`post failed: ${String(e?.stderr || e?.message || e).trim().split("\n")[0]}`);
  process.exit(2);
}
const slug = posted.performed_via_github_app?.slug ?? null;
const runtime = o.agent.split(":")[0];
console.log(posted.html_url);
if (!slug || !APP_RUNTIMES.get(slug)?.has(runtime)) {
  refuse(`comment posted as ${slug ?? "a user token"}, not an App registered for ${runtime}; the gate will not count it. Delete it and post through the runtime's App.`);
}
console.log(`orchestrator: #${o.pr} ${o.role === "qa" ? "QA" : "review"} ${o.verdict} on ${o.head.slice(0, 8)} by ${o.agent}: ${posted.html_url}`);
