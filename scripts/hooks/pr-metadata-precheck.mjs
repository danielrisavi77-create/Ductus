// Claude Code PreToolUse hook: checks the Engineering metadata of a PR body
// before `gh pr create` or `gh pr edit` reaches GitHub, with the same rules
// CI applies (pr-metadata-core). Exit 2 blocks the tool call and shows the
// reason to the agent; any other outcome lets the call through.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { evaluateMetadata } from "../engineering/pr-metadata-core.mjs";

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// Returns the body text, or null when the command does not set one.
function extractBody(command, cwd) {
  const file = command.match(/(?:--body-file|-F)[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (file) {
    const target = file[1] ?? file[2] ?? file[3];
    try {
      return fs.readFileSync(path.resolve(cwd, target), "utf8");
    } catch {
      // The file may be created earlier in the same command line.
      return null;
    }
  }

  const flag = command.match(/(?:--body|-b)[=\s]+/);
  if (!flag) return null;
  let body = command.slice(flag.index + flag[0].length);
  // Drop the opening quote, or the whole `"$(cat <<'EOF'` line of a heredoc.
  body = /^["']?\$\(/.test(body) ? body.slice(body.indexOf("\n") + 1) : body.replace(/^["']/, "");
  return body;
}

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
const action = command.match(/\bgh\s+pr\s+(create|edit)\b/)?.[1];
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
