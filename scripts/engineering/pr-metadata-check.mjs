import fs from "node:fs";

import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths } from "./protected-paths.mjs";

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const pr = event.pull_request;

if (!pr) {
  console.log("Not a pull_request event; metadata check skipped.");
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository) throw new Error("Missing GitHub runtime environment.");

const [owner, repo] = repository.split("/");
const files = [];

for (let page = 1; page <= 30; page += 1) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ductus-pr-metadata-check",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  const batch = await response.json();
  files.push(...batch);
  if (batch.length < 100) break;
}

// GitHub lists at most 3000 files; an unread tail would hide paths from the floor.
if (!(pr.changed_files <= files.length)) throw new Error("Changed file list is incomplete.");

const result = evaluateMetadata({ body: pr.body ?? "", files: changedPaths(files) });
if (!result.ok) {
  console.error(`Engineering metadata FAILED: ${result.message}`);
  for (const reason of result.reasons ?? []) console.error(`  ${JSON.stringify(reason)}`);
  process.exit(1);
}

console.log("Engineering metadata PASSED");
console.log(`Agent: ${result.agent}`);
console.log(`Declared risk: ${result.risk}`);
console.log(`Minimum risk from changed paths: ${result.minimumRisk}`);
console.log(`Task: ${result.task}`);
