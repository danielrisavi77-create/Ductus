#!/usr/bin/env node
// Claude Code hooks that enforce the token rules of docs/SESSIONS.md §4.
// Wired in .claude/settings.json as `node scripts/engineering/agent-hooks.mjs <mode>`.
// Every mode reads the hook JSON from stdin and fails open: a broken hook
// must never block work, so any error exits 0 with no output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROTATE_AT = 150_000;
export const HARD_AT = 250_000;
export const LARGE_DOC_BYTES = 16_000;

const GENERATED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /\.tsbuildinfo$/,
  /(^|\/)(\.next|playwright-report|test-results)\//,
];

const toPosix = (file) => String(file ?? "").replace(/\\/g, "/");

// Markdown headings with their 1-based line numbers, skipping fenced code.
export function outline(text) {
  const headings = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{1,3} /.test(line)) headings.push(`${index + 1}: ${line.trim()}`);
  });
  return headings;
}

// Decide whether a Read call may proceed. Returns null to allow, or the
// reason shown to the agent when the call is denied.
export function reviewRead(input, stat, readText) {
  const file = toPosix(input?.file_path);
  if (!file) return null;
  if (GENERATED.some((pattern) => pattern.test(file))) {
    return `${path.posix.basename(file)} is generated output. Use Grep for the entry you need instead of reading it.`;
  }
  const ranged = input.offset !== undefined || input.limit !== undefined;
  if (ranged || !file.endsWith(".md") || !stat || stat.size <= LARGE_DOC_BYTES) return null;
  const headings = outline(readText()).slice(0, 80).join("\n");
  return (
    `${path.posix.basename(file)} is ${Math.round(stat.size / 1000)} KB; docs/SESSIONS.md §4 says read only the sections named in the task. ` +
    `Read again with offset and limit for the section you need. Headings (line: title):\n${headings}`
  );
}

// Context size of the last model call recorded in a transcript tail.
export function lastContext(tail) {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"usage"')) continue;
    try {
      const entry = JSON.parse(lines[i]);
      const usage = entry.message?.usage;
      if (entry.type !== "assistant" || !usage || entry.isSidechain) continue;
      return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    } catch {
      // First line of the tail is usually cut mid-record.
    }
  }
  return 0;
}

export function budgetNotice(tokens) {
  if (tokens < ROTATE_AT) return null;
  const size = `${Math.round(tokens / 1000)}k`;
  if (tokens >= HARD_AT) {
    return (
      `Context is ${size} tokens, past the ${HARD_AT / 1000}k hard limit. Every further call re-reads all of it. ` +
      "Do not start new work in this session: finish only the step in progress, write the handoff with the ductus-handoff skill, and tell the user to continue in a fresh session."
    );
  }
  return (
    `Context is ${size} tokens, past the ${ROTATE_AT / 1000}k rotation point in docs/SESSIONS.md §4. ` +
    "Finish the current step, then write the handoff with the ductus-handoff skill and tell the user this session should be rotated. Do not take on a new task here."
  );
}

function readTail(file, bytes = 400_000) {
  const { size } = fs.statSync(file);
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(file, "r");
  try {
    fs.readSync(handle, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(handle);
  }
  return buffer.toString("utf8");
}

const emit = (hookSpecificOutput) => process.stdout.write(JSON.stringify({ hookSpecificOutput }));

const modes = {
  // PreToolUse(Read)
  read(event) {
    const input = event.tool_input ?? {};
    const file = path.resolve(event.cwd ?? ".", String(input.file_path ?? ""));
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    const reason = reviewRead(input, stat, () => fs.readFileSync(file, "utf8"));
    if (reason) emit({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason });
  },
  // UserPromptSubmit
  budget(event) {
    const notice = budgetNotice(lastContext(readTail(event.transcript_path)));
    if (notice) emit({ hookEventName: "UserPromptSubmit", additionalContext: notice });
  },
  // SessionStart: saves the model call every session spends on reading STATE.md.
  start(event) {
    const state = fs.readFileSync(path.join(process.env.CLAUDE_PROJECT_DIR ?? event.cwd, "STATE.md"), "utf8");
    emit({
      hookEventName: "SessionStart",
      additionalContext: `STATE.md as of session start (already loaded; do not Read it again unless it changes):\n\n${state}`,
    });
  },
};

function main() {
  try {
    const mode = modes[process.argv[2]];
    if (mode) mode(JSON.parse(fs.readFileSync(0, "utf8")));
  } catch {
    // Fail open.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
