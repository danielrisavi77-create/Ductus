// Claude Code PostToolUse hook: after `gh pr create` opens a PR that declares
// `Risk: low`, turns on GitHub auto-merge (squash). GitHub then merges only
// when every required check on `main` is green, including the Engineering
// review gate, so a review or an Owner Override is still needed. Standard
// and critical PRs are left to the orchestrator.
// `--dry-run` prints the decision instead of calling gh (used by the tests).
import { execFileSync } from "node:child_process";

import { field } from "../engineering/metadata-parser.mjs";
import { extractBody, prAction, readInput } from "./pr-command.mjs";

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

function output(response) {
  if (typeof response === "string") return response;
  return [response?.stdout, response?.output, response?.stderr].filter(Boolean).join("\n");
}

const input = readInput();
const command = input.tool_input?.command ?? "";
if (prAction(command) !== "create") process.exit(0);

const url = output(input.tool_response).match(PR_URL)?.[0];
const body = extractBody(command, input.cwd ?? process.cwd());
const risk = field(body ?? "", "Risk")?.toLowerCase();
if (!url || risk !== "low") process.exit(0);

if (process.argv.includes("--dry-run")) {
  console.log(url);
  process.exit(0);
}

let note;
try {
  execFileSync("gh", ["pr", "merge", "--auto", "--squash", url], { stdio: "ignore" });
  note = `Auto-merge enabled for ${url} (Risk: low). It merges once all required checks pass.`;
} catch {
  note = `Could not enable auto-merge for ${url}; merge it manually once the checks pass.`;
}
console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note },
  }),
);
