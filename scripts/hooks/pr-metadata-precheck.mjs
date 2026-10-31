// Claude Code PreToolUse hook: checks the Engineering metadata of a PR body
// before `gh pr create` or `gh pr edit` reaches GitHub, with the same rules
// CI applies (pr-metadata-core). Exit 2 blocks the tool call and shows the
// reason to the agent. For a PR command an internal error blocks too (DAN-137);
// every other command passes untouched.
import { changedFiles, extractBody, prAction, readInput } from "./pr-command.mjs";

const input = readInput();
const command = input.tool_input?.command ?? "";
const action = prAction(command);
// Every other command leaves here, before the metadata rules are loaded: this
// hook runs on each Bash and PowerShell call.
if (!action) process.exit(0);

try {
  const { evaluateMetadata } = await import("../engineering/pr-metadata-core.mjs");
  const cwd = input.cwd ?? process.cwd();
  const body = extractBody(command, cwd);
  // `gh pr edit` without a body leaves the description alone; a body file that
  // does not exist yet cannot be checked here and is left to CI.
  if (body === null && (action === "edit" || /(?:--body-file|-F)[=\s]/.test(command))) {
    process.exit(0);
  }

  // A changed-file list that cannot be read hides the risk floor: block (DAN-137).
  const files = changedFiles(cwd);
  if (files === null) {
    console.error("PR metadata check could not read the changed files (git diff origin/main...HEAD failed); blocking so the risk floor cannot be skipped. Fetch origin/main and retry.");
    process.exit(2);
  }

  const result = evaluateMetadata({ body: body ?? "", files });
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
} catch (error) {
  // DAN-137: once the command is a PR create/edit, an internal error must not
  // let it through unchecked (an uncaught throw would exit 1 = non-blocking).
  console.error(`PR metadata check could not run (${error?.message}); blocking so the PR cannot skip the check. Retry or fix the command.`);
  process.exit(2);
}
