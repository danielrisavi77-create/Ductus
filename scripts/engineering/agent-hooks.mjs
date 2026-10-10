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
export const OUTLINE_LIMIT = 80;
// Hook additionalContext is capped at 10,000 characters by Claude Code.
export const STATE_LIMIT = 9_000;

const GENERATED = [/(^|\/)pnpm-lock\.yaml$/, /\.tsbuildinfo$/, /(^|\/)\.next\//];

// Mirrors the Read deny rules in .claude/settings.json, slightly wider and
// case-insensitive. PreToolUse runs before the permission rules, so the hook
// must not open these files itself; a test keeps the two lists in step.
const PROTECTED = [/(^|\/)secrets\//i, /(^|\/)\.env[^/]*$/i, /\.age$/i];

// Session role by agent profile (.claude/agents/**). The profile is the only
// role signal the runtime attests: Claude Code puts it in the hook input as
// `agent_type` for a session started with that profile. A session without a
// profile has no detectable role and is treated as "unknown".
export const PROFILE_ROLES = {
  "ductus-orchestrator": "orchestrator",
  "ductus-backend-data": "worker",
  "ductus-frontend-editor": "worker",
  "ductus-platform-sre": "worker",
  "ductus-independent-reviewer": "control",
  "ductus-security-reviewer": "control",
  "ductus-adversarial-qa": "control",
  "ductus-bug-hunter": "control",
  "ductus-accessibility": "control",
  "ductus-product-ux": "control",
  "ductus-architecture-performance": "control",
  "ductus-privacy-legal-pilot": "control",
};

const toPosix = (file) => String(file ?? "").replace(/\\/g, "/");

export const isProtected = (file) => PROTECTED.some((pattern) => pattern.test(toPosix(file)));

export function sessionRole(event) {
  const profile = event?.agent_type;
  return typeof profile === "string" && Object.hasOwn(PROFILE_ROLES, profile) ? PROFILE_ROLES[profile] : "unknown";
}

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

function describeOutline(text) {
  const headings = outline(text);
  if (headings.length === 0) return `It has no headings and ${text.split("\n").length} lines; Grep for the term you need.`;
  const shown = headings.slice(0, OUTLINE_LIMIT).join("\n");
  const rest = headings.length - OUTLINE_LIMIT;
  const more = rest > 0 ? `\n+${rest} more headings; Grep "^#{1,3} " for the rest.` : "";
  return `Headings (line: title):\n${shown}${more}`;
}

// Decide whether a Read call may proceed. Returns null to allow, or the
// reason shown to the agent when the call is denied. `inProject` limits the
// document rule to this repo: files elsewhere on the machine are not ours.
// Deny-listed paths are never read here; the permission system decides them.
export function reviewRead(input, stat, readText, inProject = true) {
  const file = toPosix(input?.file_path);
  if (!file || !inProject || isProtected(file)) return null;
  if (GENERATED.some((pattern) => pattern.test(file))) {
    return `${path.posix.basename(file)} is generated output. Use Grep for the entry you need instead of reading it.`;
  }
  const ranged = input.offset !== undefined || input.limit !== undefined;
  if (ranged || !/\.md$/i.test(file) || !stat || stat.size <= LARGE_DOC_BYTES) return null;
  return (
    `${path.posix.basename(file)} is ${Math.round(stat.size / 1000)} KB; docs/SESSIONS.md §4 says read only the sections named in the task. ` +
    `Read again with offset and limit for the section you need. ${describeOutline(readText())}`
  );
}

// Context size of the last real model call in a transcript tail. Returns 0
// when the newest record is a compaction (the old size no longer applies) or
// when the tail holds no call. Synthetic error records carry zero usage and
// are skipped.
export function lastContext(tail) {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true')) return 0;
    if (!line.includes('"usage"')) continue;
    try {
      const entry = JSON.parse(line);
      const usage = entry.message?.usage;
      if (entry.type !== "assistant" || !usage || entry.isSidechain) continue;
      const total = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      if (total > 0) return total;
    } catch {
      // First line of the tail is usually cut mid-record.
    }
  }
  return 0;
}

const ORCHESTRATOR_RULE =
  "the orchestrator session is permanent and not rotated (docs/ORKESTRATOR.md §7), and it keeps taking work; " +
  "at the end of the current logical unit write the handoff to the board and as a comment on the coordination issue, " +
  "then compact the context (yourself if the runtime allows it, otherwise ask Daniel)";

// Where each rotating role writes its handoff (ductus-handoff skill, step 2).
const HANDOFF_AT = {
  worker: "the IZVJEŠTAJ block of your own PR, or your own issue when there is no PR",
  control: "your own comment on the PR or issue you are checking; never edit another author's PR body",
};

// The notice added to a prompt once the context passes the rotation point.
// Only a recognised worker or control role is told to rotate and to take no
// new task. The orchestrator gets a reminder, and so does a session whose
// role is unknown, because it may be the orchestrator.
export function budgetNotice(tokens, role = "unknown") {
  if (tokens < ROTATE_AT) return null;
  const size = `${Math.round(tokens / 1000)}k`;
  const hard = tokens >= HARD_AT;
  if (role === "orchestrator") {
    return `Context is ${size} tokens. Reminder, not a stop: ${ORCHESTRATOR_RULE}.${hard ? " This is past the 200k upper safety limit in §7, so compact before the next unit." : ""}`;
  }
  const where = hard
    ? `Context is ${size} tokens, past the ${HARD_AT / 1000}k hard limit. Every further call re-reads all of it. `
    : `Context is ${size} tokens, past the ${ROTATE_AT / 1000}k rotation point in docs/SESSIONS.md §4. `;
  const target = HANDOFF_AT[role];
  if (!target) {
    return (
      `${where}This session's role could not be detected, so nothing is forbidden here. ` +
      `If you are the orchestrator, ${ORCHESTRATOR_RULE}. ` +
      "Any other role: finish the current step, write the handoff with the ductus-handoff skill at the place it names for your role, and tell the user this session should be rotated."
    );
  }
  const handoff = `write the handoff with the ductus-handoff skill (${target})`;
  if (hard) return `${where}Do not start new work in this session: finish only the step in progress, ${handoff}, and tell the user to continue in a fresh session.`;
  return `${where}Finish the current step, then ${handoff} and tell the user this session should be rotated. Do not take on a new task here.`;
}

// STATE.md as session-start context, or null when it would be truncated.
export function stateContext(file, text) {
  if (text.length > STATE_LIMIT) return null;
  return (
    `${toPosix(file)} as of session start. This satisfies the CLAUDE.md rule to read STATE.md first; ` +
    `read it again only if you switch branch or worktree, or it changes.\n\n${text}`
  );
}

function readTail(file, bytes) {
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
const projectDir = (event) => process.env.CLAUDE_PROJECT_DIR ?? event.cwd ?? ".";

const modes = {
  // PreToolUse(Read)
  read(event) {
    const input = event.tool_input ?? {};
    const file = path.resolve(event.cwd ?? ".", String(input.file_path ?? ""));
    const root = path.resolve(projectDir(event));
    const relative = path.relative(root, file);
    const inProject = !relative.startsWith("..") && !path.isAbsolute(relative);
    if (!inProject || isProtected(relative)) return;
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    // A link inside the repo may point at a deny-listed file.
    if (stat && isProtected(path.relative(fs.realpathSync(root), fs.realpathSync(file)))) return;
    const reason = reviewRead({ ...input, file_path: relative || input.file_path }, stat, () => fs.readFileSync(file, "utf8"), inProject);
    if (reason) emit({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason });
  },
  // UserPromptSubmit
  budget(event) {
    // A long turn can push the last call out of a small tail; widen once.
    const tokens = lastContext(readTail(event.transcript_path, 400_000)) || lastContext(readTail(event.transcript_path, 4_000_000));
    const notice = budgetNotice(tokens, sessionRole(event));
    if (notice) emit({ hookEventName: "UserPromptSubmit", additionalContext: notice });
  },
  // SessionStart: saves the model call every session spends on reading STATE.md.
  start(event) {
    const file = path.join(projectDir(event), "STATE.md");
    const context = stateContext(file, fs.readFileSync(file, "utf8"));
    if (context) emit({ hookEventName: "SessionStart", additionalContext: context });
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
