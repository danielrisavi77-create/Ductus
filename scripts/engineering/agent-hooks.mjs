#!/usr/bin/env node
// Claude Code hooks that enforce the token rules of docs/SESSIONS.md §4.
// Wired in .claude/settings.json as `node scripts/engineering/agent-hooks.mjs <mode>`.
// Every mode reads the hook JSON from stdin and fails open: a broken hook
// must never block work, so any error exits 0 with no output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROTATE_AT = 150_000;
// Upper safety limit for the permanent orchestrator session (docs/ORKESTRATOR.md §7).
// Owner decision 10 Oct 2026: 400k. The first reminder comes earlier, at 300k.
export const ORCHESTRATOR_REMIND_AT = 300_000;
export const ORCHESTRATOR_LIMIT = 400_000;
export const HARD_AT = 250_000;
export const LARGE_DOC_BYTES = 16_000;
// Other text files above this size are read only in ranges (offset/limit), DAN-213.
export const LARGE_FILE_BYTES = 64_000;
// Images and PDFs reach the model as pages or pictures, not as text lines; the size rule skips them.
const VISUAL = /\.(png|jpe?g|gif|webp|bmp|pdf)$/i;
export const OUTLINE_LIMIT = 80;
// Hook additionalContext is capped at 10,000 characters by Claude Code.
export const STATE_LIMIT = 9_000;
// Node major the repo runs on (.nvmrc, package.json "engines"); a test keeps them in step.
export const NODE_MAJOR = 24;

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

// Where a path really is once every link in it is resolved: `file` is the real
// path and `relative` its place under the real project root. Null when the
// hook must not open it: it resolves outside the project (a link in the repo
// can point anywhere on the machine) or under a Read deny rule. The deny rules
// are matched against the place under the root, as the permission rules are,
// so a repo cloned below a directory named secrets/ still works. Throws when
// the path does not exist, which the caller treats as "do nothing".
export function realProjectPath(root, file, realpath = fs.realpathSync) {
  const real = realpath(file);
  const relative = path.relative(realpath(root), real);
  const outside = !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return outside || isProtected(relative) ? null : { file: real, relative: toPosix(relative) };
}

const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

// Opens `real` (a path realProjectPath or realpath already approved) once and
// hands `read` the descriptor and size, so the content read is the content that
// was checked. Opening by name again would resolve every part of the path a
// second time, and a link swapped in after the check would lead elsewhere.
// After the open the descriptor must be a regular file, the name must still
// resolve to itself, and the file now at that name must be the open one (same
// device and inode; a file system that reports no inode cannot be verified).
// On Linux the kernel's own record of the descriptor's path must match too,
// which holds however the names are swapped during the checks; elsewhere only
// the name checks exist. Returns undefined when anything differs.
export function withCheckedFile(real, read, io = fs) {
  const fd = io.openSync(real, READ_FLAGS);
  try {
    const opened = io.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || io.realpathSync(real) !== real) return undefined;
    const named = io.lstatSync(real, { bigint: true });
    if (!named.isFile() || opened.ino === 0n || opened.ino !== named.ino || opened.dev !== named.dev) return undefined;
    if ((io.platform ?? process.platform) === "linux" && io.readlinkSync(`/proc/self/fd/${fd}`) !== real) return undefined;
    return read(fd, Number(opened.size));
  } finally {
    io.closeSync(fd);
  }
}

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
  // `pages` is not a range here: it belongs to PDFs, which VISUAL exempts anyway (#429 review).
  const ranged = input.offset !== undefined || input.limit !== undefined;
  if (ranged || !stat) return null;
  if (!/\.md$/i.test(file)) {
    if (stat.size <= LARGE_FILE_BYTES || VISUAL.test(file)) return null;
    return (
      `${path.posix.basename(file)} is ${Math.round(stat.size / 1000)} KB. ` +
      "Use Grep to find the lines you need, then Read with offset and limit."
    );
  }
  if (stat.size <= LARGE_DOC_BYTES) return null;
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
  // A count that is not a finite number (NaN, a string) gives no notice instead of "NaNk".
  if (typeof tokens !== "number" || !Number.isFinite(tokens)) return null;
  if (tokens < (role === "orchestrator" ? ORCHESTRATOR_REMIND_AT : ROTATE_AT)) return null;
  const size = `${Math.round(tokens / 1000)}k`;
  const hard = tokens >= HARD_AT;
  if (role === "orchestrator") {
    const limit = tokens >= ORCHESTRATOR_LIMIT ? ` This has reached the ${ORCHESTRATOR_LIMIT / 1000}k upper safety limit in §7, so compact before the next unit.` : "";
    return `Context is ${size} tokens. Reminder, not a stop: ${ORCHESTRATOR_RULE}.${limit}`;
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

// The Owner queue is for the owner and the orchestrator (CLAUDE.md, STATE.md).
// A writer or control session gets STATE.md with the body of that section
// replaced by one line naming the lines left out; every other role, including
// a session with no detectable role, gets the text unchanged (DAN-695).
// ATX headings and fenced blocks follow CommonMark: up to three spaces of
// indent, and a fence closes only with the same character, at least as long.
// Only a space or a tab counts as blank there, never what JavaScript trim(),
// \s or "." also take for one (NBSP, U+3000, U+2028 and the like). A text
// with a lone CR, which CommonMark reads as a line ending, or with a leading
// byte order mark, which a reader may drop before the first line, is not cut
// at all.
// Setext headings and HTML blocks are not recognised; STATE.md uses neither.
const OWNER_QUEUE = /^ {0,3}##[ \t]+Owner queue\b/i;
const SECTION = /^ {0,3}#{1,2}(?:[ \t]|$)/;
const BLANK = /^[ \t]*$/;
const CUT_ROLES = new Set(["worker", "control"]);

const ownerQueueNote = (from, to, cr, last = false, lastCr = cr) => [
  "" + cr,
  `> Owner queue left out for this session's role: STATE.md lines ${from}-${to}. It is for the owner and the orchestrator.` + (last ? lastCr : cr),
  ...(last ? [] : ["" + cr]),
];
// A body is cut only when it is longer than the longest note, so the text
// handed over is never longer than the file, and a second pass keeps the note
// as it is: the decision does not depend on where the section sits.
const size = (lines) => lines.reduce((sum, line) => sum + line.length + 1, 0);
const noteRoom = (cr) => size(ownerQueueNote(9_999_999, 9_999_999, cr));

// Fenced blocks inside list items (review cxcr1949 on 96973234): CommonMark
// closes such a block when its item ends, that is at a non-blank line indented
// less than the item's content that is not a lazy paragraph line. The tracker
// keeps the content column of each open item; a tab in indent counts to the
// next multiple of four columns. A tab right after a list marker splits into
// columns the tracker does not follow, and a block quote holds lists, fences
// and lazy lines of its own: either throws UNSURE and nothing is cut. A text
// already cut carries the note, itself a block quote, so it stays as it is.
const UNSURE = Symbol("unsure");
const MARKER = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
const THEMATIC = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const OPENS = /^(`{3,}|~{3,})([^]*)$/;
const BLOCK = /^(?:#{1,6}(?:[ \t]|$)|>)/;
const isFence = (rest) => {
  const match = OPENS.exec(rest);
  return match && !(match[1][0] === "`" && match[2].includes("`")) ? match[1] : null;
};

// The column of the first character that is not a space or a tab, and that character's index.
function indentOf(line) {
  let column = 0;
  let index = 0;
  for (; index < line.length && (line[index] === " " || line[index] === "\t"); index += 1) {
    column = line[index] === "\t" ? column + 4 - (column % 4) : column + 1;
  }
  return { column, index };
}

// Whether `rest`, at `relative` columns past its container, would start a
// block that ends a paragraph instead of continuing it lazily.
const startsBlock = (rest, relative) =>
  relative < 4 && (BLOCK.test(rest) || THEMATIC.test(rest) || isFence(rest) !== null || MARKER.test(rest));

const MAX_DEPTH = 16;

function fenceTracker() {
  const items = []; // content column of each open list item, { width, empty }
  let fence = null; // { mark, depth, base }
  let paragraph = false;
  const base = () => (items.length ? items.at(-1).width : 0);
  return (bare) => {
    if (BLANK.test(bare)) {
      if (fence) return true;
      // An item can start with at most one blank line.
      if (items.length && items.at(-1).empty) items.pop();
      paragraph = false;
      return false;
    }
    const { column, index } = indentOf(bare);
    let rest = bare.slice(index);
    if (items.length && column < base()) {
      const kept = items.filter((item) => item.width <= column);
      const lazy = !fence && paragraph && !startsBlock(rest, column - (kept.at(-1)?.width ?? 0));
      // The items that end close the paragraph in them too.
      if (!lazy) {
        items.length = kept.length;
        paragraph = false;
      }
    }
    if (items.length) items.at(-1).empty = false;
    if (fence && items.length < fence.depth) {
      fence = null;
      paragraph = false;
    }
    if (fence) {
      const match = OPENS.exec(rest);
      const closes = column - fence.base < 4 && match && match[1][0] === fence.mark[0] && match[1].length >= fence.mark.length && BLANK.test(match[2]);
      if (closes) fence = null;
      return true;
    }
    let at = column;
    for (;;) {
      const relative = at - base();
      // Indented code, or a paragraph line that goes on: neither opens a block.
      if (relative >= 4) return false;
      if (THEMATIC.test(rest)) return (paragraph = false);
      const mark = isFence(rest);
      if (mark) {
        fence = { mark, depth: items.length, base: base() };
        paragraph = false;
        return true;
      }
      const marker = MARKER.exec(rest);
      // A block quote can hold its own lists, fences and lazy lines, which
      // this tracker does not follow: hand the text over as it is.
      if (rest[0] === ">") throw UNSURE;
      if (!marker) {
        paragraph = !BLOCK.test(rest);
        return false;
      }
      // Deeper nesting than any real STATE.md holds is handed over as it is,
      // which also keeps a long line of markers from taking quadratic time.
      if (items.length >= MAX_DEPTH) throw UNSURE;
      const after = rest.slice(marker[0].length);
      const content = after.replace(/^ +/, "");
      // Only an item with content, and an ordered one only from 1, interrupts a paragraph.
      if (paragraph && (BLANK.test(after) || (marker[1] !== undefined && Number(marker[1]) !== 1))) return false;
      if (after[0] === "\t" || content[0] === "\t") throw UNSURE;
      const gap = after.length - content.length;
      if (content === "" || gap > 4) {
        items.push({ width: at + marker[0].length + 1, empty: content === "" });
        paragraph = false;
        return false;
      }
      at += marker[0].length + gap;
      items.push({ width: at, empty: false });
      paragraph = false;
      rest = content;
    }
  };
}

export function stateForRole(text, role) {
  if (!CUT_ROLES.has(role) || text.startsWith("\uFEFF") || /\r(?!\n)/.test(text)) return text;
  // A final newline ends the last line; it is not one more line to count.
  const ends = text.endsWith("\n");
  const lines = (ends ? text.slice(0, -1) : text).split("\n");
  const out = [];
  const fenced = fenceTracker();
  let body = null; // the Owner queue body being collected: { from (1-based), lines, cr }
  const flush = (last = false) => {
    const kept = body.lines;
    const to = body.from + kept.length - 1;
    const lastCr = kept.length && kept.at(-1).endsWith("\r") ? "\r" : "";
    if (size(kept) > noteRoom(body.cr)) out.push(...ownerQueueNote(body.from, to, body.cr, last, lastCr));
    else out.push(...kept);
    body = null;
  };
  for (const [index, line] of lines.entries()) {
    const bare = line.replace(/\r$/, "");
    let inFence;
    try {
      inFence = fenced(bare);
    } catch (error) {
      if (error === UNSURE) return text;
      throw error;
    }
    const section = !inFence && SECTION.test(bare);
    const queue = section && OWNER_QUEUE.test(bare);
    if (body && section) flush();
    if (body) {
      body.lines.push(line);
      continue;
    }
    out.push(line);
    if (queue) body = { from: index + 2, lines: [], cr: line.endsWith("\r") ? "\r" : "" };
  }
  if (body) flush(true);
  return out.join("\n") + (ends ? "\n" : "");
}

// STATE.md as session-start context, or null when it would be truncated.
export function stateContext(file, text) {
  if (text.length > STATE_LIMIT) return null;
  return (
    `${toPosix(file)} as of session start. This satisfies the CLAUDE.md rule to read STATE.md first; ` +
    `read it again only if you switch branch or worktree, or it changes.\n\n${text}`
  );
}

// One line on what is wrong with the checkout's toolchain, or null when it is
// ready. `lock` is the checked-out pnpm-lock.yaml and `installed` the copy pnpm
// keeps of the lockfile it last installed (node_modules/.pnpm/lock.yaml);
// undefined means the file is missing or could not be read safely.
export function envNotice({ node, lock, installed }) {
  const problems = [];
  if (!(Number(String(node).split(".")[0]) >= NODE_MAJOR)) {
    problems.push(`Node ${node} is older than ${NODE_MAJOR} (.nvmrc); CI runs ${NODE_MAJOR}, so a local pass here is not proof, say so in your report`);
  }
  // An install runs the checked-out root lifecycle scripts, so the notice never
  // tells a session to install a head it did not write (F-059).
  const install = "run pnpm install --frozen-lockfile before tests or commits, but only on main or a branch you write, never on a head you review or test (docs/SESSIONS.md 4a)";
  if (installed === undefined) problems.push(`node_modules is missing; ${install}`);
  else if (lock !== installed) problems.push(`node_modules does not match pnpm-lock.yaml; ${install}`);
  return problems.length ? `Environment check: ${problems.join(". ")}.` : null;
}

// A project file's text, read as STATE.md is: only when the path resolves to
// that same place under the project root, never through a link elsewhere.
function projectText(root, relative, io) {
  try {
    const real = realProjectPath(root, path.join(root, relative), io.realpathSync);
    if (real?.relative !== relative) return undefined;
    const text = withCheckedFile(real.file, (fd) => io.readFileSync(fd, "utf8"), io);
    return typeof text === "string" ? text : undefined;
  } catch {
    return undefined;
  }
}

function readTail(io, fd, size, bytes) {
  const length = Math.min(size, bytes);
  const buffer = Buffer.alloc(length);
  io.readSync(fd, buffer, 0, length, size - length);
  return buffer.toString("utf8");
}

const projectDir = (event, env) => env.CLAUDE_PROJECT_DIR ?? event.cwd ?? ".";

// Each mode returns its hookSpecificOutput, or nothing. Files are read only
// through withCheckedFile, never by name.
const modes = {
  // PreToolUse(Read)
  read(event, io, env) {
    const input = event.tool_input ?? {};
    const file = path.resolve(event.cwd ?? ".", String(input.file_path ?? ""));
    const root = path.resolve(projectDir(event, env));
    let relative = path.relative(root, file);
    let inProject = !relative.startsWith("..") && !path.isAbsolute(relative);
    if (!inProject) {
      // The names alone can miss our own file: the project root may be given
      // as a link while Read names the real path, or the other way round.
      // Resolving opens nothing; a missing file throws and nothing is decided.
      const resolved = realProjectPath(root, file, io.realpathSync);
      if (!resolved) return undefined;
      relative = resolved.relative;
      inProject = true;
    }
    if (isProtected(relative)) return undefined;
    const named = { ...input, file_path: relative || input.file_path };
    const deny = (reason) => (reason ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } : undefined);
    if (!io.statSync(file, { throwIfNoEntry: false })) return deny(reviewRead(named, undefined, () => "", inProject));
    // A link inside the repo may point at a deny-listed file or out of the
    // repo. Neither is opened here; the permission system decides the call.
    const real = realProjectPath(root, file, io.realpathSync);
    if (!real) return undefined;
    return withCheckedFile(real.file, (fd, size) => deny(reviewRead(named, { size }, () => io.readFileSync(fd, "utf8"), inProject)), io);
  },
  // UserPromptSubmit
  budget(event, io) {
    // The transcript lives outside the repo by design and only its size is
    // reported, but a path that resolves under a Read deny rule is not opened.
    const transcript = io.realpathSync(event.transcript_path);
    if (isProtected(event.transcript_path) || isProtected(transcript)) return undefined;
    // A long turn can push the last call out of a small tail; widen once.
    const tokens = withCheckedFile(transcript, (fd, size) => lastContext(readTail(io, fd, size, 400_000)) || lastContext(readTail(io, fd, size, 4_000_000)), io);
    const notice = budgetNotice(tokens ?? 0, sessionRole(event));
    return notice ? { hookEventName: "UserPromptSubmit", additionalContext: notice } : undefined;
  },
  // SessionStart: saves the model call every session spends on reading STATE.md
  // and the calls it spends finding out that its toolchain is not ready.
  start(event, io, env) {
    const root = projectDir(event, env);
    // Only the project's own files are read. Git checks out links, so a branch
    // can make STATE.md point at .env or any other file; a path that resolves
    // anywhere but the same place under <root> is not read.
    const text = projectText(root, "STATE.md", io);
    // The limit is measured on the text handed over, after the role's cut.
    const state = text === undefined ? null : stateContext(path.join(root, "STATE.md"), stateForRole(text, sessionRole(event)));
    // A directory without a lockfile is not a checkout to install, so it gets no notice.
    const lock = projectText(root, "pnpm-lock.yaml", io);
    const installed = lock === undefined ? undefined : projectText(root, "node_modules/.pnpm/lock.yaml", io);
    const notice = lock === undefined ? null : envNotice({ node: process.versions.node, lock, installed });
    const context = [notice, state].filter(Boolean).join("\n\n");
    return context ? { hookEventName: "SessionStart", additionalContext: context } : undefined;
  },
};

// Every mode opens a file; agent-hooks.test.mjs probes each name listed here.
export const MODE_NAMES = Object.keys(modes);

// One hook run without the process around it. `io` is the file system the
// hook sees; tests pass one that changes between the check and the read.
export function runHook(name, event, io = fs, env = process.env) {
  return Object.hasOwn(modes, name) ? modes[name](event, io, env) : undefined;
}

function main() {
  try {
    const hookSpecificOutput = runHook(process.argv[2], JSON.parse(fs.readFileSync(0, "utf8")));
    if (hookSpecificOutput) process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  } catch {
    // Fail open.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
