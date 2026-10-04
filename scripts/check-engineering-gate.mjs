import fs from "node:fs";

const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!eventPath || !token || !repository) {
  throw new Error("GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
}

const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const pr = event.pull_request;

if (!pr) {
  console.log("Not a pull_request event; engineering gate skipped.");
  process.exit(0);
}

const body = pr.body ?? "";
const head = pr.head?.sha ?? "";
const number = pr.number;
const [owner, repo] = repository.split("/");

function capture(text, pattern) {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? "";
}

const agent = capture(body, /^Agent:\s*(.+)$/im);
const risk = capture(body, /^Risk:\s*(low|standard|critical)\s*$/im).toLowerCase();
const task = capture(body, /^Task:\s*(.+)$/im);

const errors = [];
const agentPattern =
  /^(claude|codex):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;

if (!agent) errors.push("Missing PR metadata: Agent: <runtime>:<slot>:<role>");
else if (!agentPattern.test(agent)) errors.push(`Invalid Agent metadata: ${agent}`);

if (!risk) errors.push("Missing or invalid Risk: low | standard | critical");
if (!task) errors.push("Missing Task: <ID or short identifier>");

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ductus-engineering-gate",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const comments = [];
for (let page = 1; page <= 10; page += 1) {
  const batch = await github(
    `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
  );
  comments.push(...batch);
  if (batch.length < 100) break;
}

function extractBlock(text, fields) {
  const out = {};
  for (const [key, pattern] of Object.entries(fields)) {
    out[key] = capture(text, pattern);
  }
  return out;
}

function validOwnerOverride(text) {
  const block = extractBlock(text, {
    verdict: /^Owner-Override:\s*(PASS)\s*$/im,
    reviewHead: /^Override-Head:\s*([0-9a-f]{40})\s*$/im,
    reason: /^Override-Reason:\s*(.+)$/im,
  });
  return block.verdict === "PASS" && block.reviewHead === head && Boolean(block.reason);
}

function validReview(text) {
  const block = extractBlock(text, {
    reviewer: /^Agent-Review:\s*(.+)$/im,
    reviewHead: /^Review-Head:\s*([0-9a-f]{40})\s*$/im,
    verdict: /^Review-Verdict:\s*(PASS)\s*$/im,
  });
  const reviewerPattern = /^(claude|codex):[A-Za-z0-9_-]+:reviewer$/;
  return (
    reviewerPattern.test(block.reviewer) &&
    block.reviewer !== agent &&
    block.reviewHead === head &&
    block.verdict === "PASS"
  );
}

function validQa(text) {
  const block = extractBlock(text, {
    qa: /^QA-Agent:\s*(.+)$/im,
    qaHead: /^QA-Head:\s*([0-9a-f]{40})\s*$/im,
    verdict: /^QA-Verdict:\s*(PASS)\s*$/im,
    scope: /^QA-Scope:\s*(.+)$/im,
  });
  const qaPattern = /^(claude|codex):[A-Za-z0-9_-]+:qa$/;
  return (
    qaPattern.test(block.qa) &&
    block.qa !== agent &&
    block.qaHead === head &&
    block.verdict === "PASS" &&
    Boolean(block.scope)
  );
}

const override = comments.find((comment) => validOwnerOverride(comment.body ?? ""));
const review = comments.find((comment) => validReview(comment.body ?? ""));
const qa = comments.find((comment) => validQa(comment.body ?? ""));

if (!override) {
  if (!review) {
    errors.push(
      `Missing independent review PASS for current head ${head}. Add Agent-Review, Review-Head and Review-Verdict: PASS.`,
    );
  }
  if (risk === "critical" && !qa) {
    errors.push(
      `Critical PR requires QA PASS for current head ${head}. Add QA-Agent, QA-Head, QA-Verdict and QA-Scope.`,
    );
  }
}

if (errors.length > 0) {
  console.error("Engineering review gate FAILED:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Engineering review gate PASSED");
console.log(`Agent: ${agent}`);
console.log(`Risk: ${risk}`);
console.log(`Task: ${task}`);
console.log(`Head: ${head}`);
if (override) {
  console.log("Gate satisfied by explicit Owner Override on this head.");
} else {
  console.log("Independent review: PASS");
  if (risk === "critical") console.log("QA/adversarial: PASS");
}
