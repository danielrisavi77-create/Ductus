// Claude Code PreToolUse hook: checks the Engineering metadata of a PR body
// before `gh pr create` or `gh pr edit` reaches GitHub, with the same rules
// CI applies (pr-metadata-core). Exit 2 blocks the tool call and shows the
// reason to the agent; any other outcome lets the call through.
import { execFileSync } from "node:child_process";

import { evaluateMetadata } from "../engineering/pr-metadata-core.mjs";
import { extractBody, prAction, readInput } from "./pr-command.mjs";

function changedFiles(cwd) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

const input = readInput();
const command = input.tool_input?.command ?? "";
const action = prAction(command);
if (!action) process.exit(0);

const cwd = input.cwd ?? process.cwd();
const body = extractBody(command, cwd);
// `gh pr edit` without a body leaves the description alone; a body file that
// does not exist yet cannot be checked here and is left to CI.
if (body === null && (action === "edit" || /(?:--body-file|-F)[=\s]/.test(command))) {
  process.exit(0);
}

const result = evaluateMetadata({ body: body ?? "", files: changedFiles(cwd) });
if (result.ok) process.exit(0);

console.error(
  [
    `PR metadata check failed: ${result.message}`,
    "The PR body needs these lines outside code blocks (.github/pull_request_template.md):",
    "  Agent: <claude|codex|chatgpt|grok>:<slot>:<orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short>",
    "  Risk: <low|standard|critical>",
    "  Task: <id>",
  ].join("\n"),
);
process.exit(2);
