// P1-1: the checks the orchestrator runs before it starts review or QA
// (docs/ORKESTRATOR.md, "prije pokretanja reviewa ili QA-e"). Pure: no gh/git.
import { closesFence, fenceInfo, field } from "../engineering/metadata-parser.mjs";
import { evaluateChecks, GATE_CONTEXT, latestChecks } from "./orchestrator-core.mjs";

// ENGINEERING_SYSTEM §14 lines the orchestrator requires besides `Task:`.
export const CONTRACT_LINES = [
  "Stvarni pozivatelj",
  "Poznate granice",
  "Što bi ovaj PR moglo oboriti na QA-i?",
];
export const CRITICAL_CONTRACT_LINES = ["Invarijanta", "Mjesta"];

const SHA_RE = /^[0-9a-f]{40}$/i;
const PLACEHOLDER_RE = /^<[^>]*>$/;
// Same allow-list as health-core: anything else is author- or app-controlled
// text that is not echoed to the terminal.
const SAFE_NAME = /^[\w .,()/:-]{1,80}$/;
const shown = (s) => (SAFE_NAME.test(String(s ?? "")) ? String(s) : "<not printed>");
const names = (list) => list.map(shown).join(", ");

const filled = (v) => {
  const t = String(v ?? "").trim();
  return t !== "" && !PLACEHOLDER_RE.test(t);
};

// Markdown decoration around a label: list markers, headings, quotes, emphasis.
const bare = (line) => line.replace(/[*_`]/g, "").replace(/^[\s>#\-+]*(\d+\.\s*)?/, "").trim();
const isHeading = (line) => /^\s{0,3}#{1,6}\s/.test(line);

function quotePrefix(line) {
  const prefix = /^(?: {0,3})>(?:[\t ]?)/.exec(line);
  return prefix ? line.slice(prefix[0].length) : null;
}

function blockquoteContent(line) {
  let content = line;
  let depth = 0;
  while (true) {
    const inner = quotePrefix(content);
    if (inner === null) break;
    depth += 1;
    content = inner;
  }
  return { content, depth };
}

function listItemContent(line) {
  const match = /^( {0,3})([-+*]|\d+[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  let indent = match[1].length + match[2].length;
  for (const char of match[3]) indent += char === "\t" ? 4 - (indent % 4) : 1;
  return { content: match[4], indent };
}

function stripIndent(line, columns) {
  let current = 0;
  let index = 0;
  while (current < columns && index < line.length) {
    const char = line[index];
    if (char !== " " && char !== "\t") return null;
    const next = current + (char === "\t" ? 4 - (current % 4) : 1);
    index += 1;
    if (next > columns) return `${" ".repeat(next - columns)}${line.slice(index)}`;
    current = next;
  }
  return current === columns ? line.slice(index) : null;
}

function lazyParagraphLine(line) {
  return line.trim() !== ""
    && !/^(?: {4}|\t)/.test(line)
    && quotePrefix(line) === null
    && listItemContent(line) === null
    && fenceInfo(line) === null
    && !/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)
    && !/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)
    && !/^ {0,3}(?:=+|-{3,})[ \t]*$/.test(line)
    && !/^ {0,3}(?:<!--|<\?|<![A-Z]|<!\[CDATA\[|<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$))/i.test(line);
}

function stripContainerPath(line, containers, { allowLazy = false } = {}) {
  if (line.trim() === "") return { content: line, containers };
  let content = line;
  const retained = [];
  for (const container of containers) {
    if (container.type === "quote") {
      const inner = quotePrefix(content);
      if (inner === null) break;
      content = inner;
    } else {
      const stripped = stripIndent(content, container.indent);
      if (stripped === null) {
        if (allowLazy && container.lazy && lazyParagraphLine(content)) retained.push(container);
        break;
      }
      content = stripped;
    }
    retained.push(container);
  }
  return { content, containers: retained };
}

function blockContainers(line) {
  let content = line;
  const containers = [];
  while (true) {
    const quoted = quotePrefix(content);
    if (quoted !== null) {
      containers.push({ type: "quote" });
      content = quoted;
      continue;
    }
    const item = listItemContent(content);
    if (!item) break;
    containers.push({ type: "list", indent: item.indent, lazy: lazyParagraphLine(item.content) });
    content = item.content;
  }
  return { content, containers };
}

function withoutHtmlComments(input) {
  let output = "";
  let inComment = false;
  for (let index = 0; index < input.length;) {
    if (!inComment && input.startsWith("<!--", index)) {
      inComment = true;
      output += "    ";
      index += 4;
      continue;
    }
    if (inComment) {
      if (input.startsWith("-->", index)) {
        inComment = false;
        output += "   ";
        index += 3;
        continue;
      }
      const char = input[index];
      output += char === "\r" || char === "\n" ? char : " ";
      index += 1;
      continue;
    }
    output += input[index];
    index += 1;
  }
  return output;
}

function fencedContent(line, containers) {
  const normalized = stripContainerPath(line, containers);
  return normalized.containers.length === containers.length ? normalized.content : null;
}

function maskCode(lines) {
  const visible = [...lines];
  let fence = null;
  let activeContainers = [];
  for (let i = 0; i < visible.length; i += 1) {
    const raw = visible[i];
    const normalized = stripContainerPath(raw, activeContainers, { allowLazy: !fence });
    activeContainers = normalized.containers;
    if (fence) {
      // A fenced block ends with its enclosing blockquote/list item. Do not
      // let an unclosed example hide real contract text after that container.
      const content = fencedContent(raw, fence.containers);
      if (content === null) fence = null;
      else {
        if (closesFence(content, fence)) fence = null;
        visible[i] = null;
        continue;
      }
    }
    const parsed = blockContainers(normalized.content);
    if (parsed.containers.length > 0 || !lazyParagraphLine(parsed.content)) {
      for (const container of activeContainers) if (container.type === "list") container.lazy = false;
    }
    activeContainers = [...activeContainers, ...parsed.containers];
    const opened = fenceInfo(parsed.content);
    if (opened) {
      for (const container of activeContainers) if (container.type === "list") container.lazy = false;
      fence = { ...opened, containers: activeContainers };
      visible[i] = null;
      continue;
    }
    if (lazyParagraphLine(parsed.content)) {
      for (const container of activeContainers) if (container.type === "list") container.lazy = true;
    }
    // CommonMark indented code can also occur inside a blockquote.
    if (/^(?: {4}|\t)/.test(parsed.content)) visible[i] = null;
  }
  return visible;
}

/**
 * Text of a contract line: what follows "<label>:" on the same line, or, when
 * the label line is empty ("**label:**" alone, or a "## label" heading), the
 * next paragraph, which ends at a blank line, a heading or another bold
 * "**field:**" item. Code fences and HTML comments do not count, so the
 * template's own examples never satisfy a line. null when the label is
 * missing; "" when it is there but empty.
 */
export function contractText(body, label) {
  const want = label.toLowerCase().replace(/\?$/, "");
  const source = withoutHtmlComments(String(body ?? "")).split(/\r?\n/);
  const lines = maskCode(source);
  const fieldItem = (l) => /^\s*([-+*]|\d+\.)?\s*\*\*[^*]+\*\*/.test(blockquoteContent(l).content);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === null) continue;
    const b = bare(lines[i]);
    if (!b.toLowerCase().startsWith(want)) continue;
    const tail = b.slice(want.length).replace(/^\?/, "");
    let rest;
    if (isHeading(lines[i])) rest = "";
    else if (tail.trimStart().startsWith(":")) rest = tail.trimStart().slice(1).trim();
    else continue;
    if (rest !== "") return rest;
    const after = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== null && lines[j].trim() === "") j += 1;
    if (j < lines.length && lines[j] === null) return "";
    for (; j < lines.length; j += 1) {
      const l = lines[j];
      if (l === null || l.trim() === "" || isHeading(l) || fieldItem(l)) break;
      after.push(bare(l));
    }
    return after.join(" ").trim();
  }
  return null;
}

const AUTHORIZATION_CONTEXT = "Merge authorization";
const RUNNING_STATES = new Set(["PENDING", "QUEUED", "IN_PROGRESS"]);

/**
 * Preflight verdict for one PR. Every check is PASS or FAIL; there is no
 * "unknown counts as pass". Input:
 *   pr        toPr() shape (state, isDraft, headRefOid, baseRefName, body, mergeable)
 *   mainSha   main head the PR is compared against
 *   compare   REST compare of mainSha...head ({status, behind_by}) or null when unread
 *   mainPaths paths changed by the main commits the head lacks (compare head...main), or null
 *             when unread or cut at the API cap; only read when the head is behind
 *   prPaths   every path the PR changes (renames under both names), or null when unread
 *   rollup    checkRollup(head) or null when unread
 *   required  required status contexts of main's branch protection, or null when unread;
 *             each one except the review gate must be reported on the head
 *   expectHead optional head the caller planned for; a different head fails
 */
export function evaluatePreflight({ pr, mainSha, compare, rollup, required, expectHead = null, mainPaths = null, prPaths = null }) {
  const out = [];
  const add = (ok, id, text) => out.push({ level: ok ? "PASS" : "FAIL", id, text });
  const head = String(pr.headRefOid ?? "");

  add(pr.state === "OPEN", "open", `state ${shown(pr.state)}`);
  add(!pr.isDraft, "draft", pr.isDraft ? "PR is a draft" : "not a draft");
  add(pr.baseRefName === "main", "base", `base ${shown(pr.baseRefName)}`);
  if (expectHead != null) {
    add(SHA_RE.test(head) && head.toLowerCase() === String(expectHead).toLowerCase(), "head",
      head.toLowerCase() === String(expectHead).toLowerCase()
        ? `head ${head.slice(0, 8)} as expected`
        : `head is ${head.slice(0, 8)}, expected ${String(expectHead).slice(0, 8)}: the head moved`);
  }

  // compare main...head: behind_by counts main commits the head lacks.
  if (!SHA_RE.test(String(mainSha ?? ""))) add(false, "main", "main head could not be read");
  else if (!compare || !Number.isInteger(compare.behind_by)) add(false, "main", `head vs main ${mainSha.slice(0, 8)} could not be compared`);
  else if (compare.behind_by > 0) {
    // D-101 and the owner's decision of 31. 10. 2026. (#87 issuecomment-6549357009, point 1;
    // D-197 point 2): for every risk, critical and D-97 included, a lagging head may enter
    // review unless it conflicts with main. Only GitHub's mergeability decides; a file that
    // main also changed is reported, not refused. An undecided mergeability fails closed.
    const lack = `head lacks ${compare.behind_by} commit(s) of main ${mainSha.slice(0, 8)}`;
    if (pr.mergeable === "CONFLICTING") add(false, "main", `${lack} and conflicts with main: merge main first`);
    else if (pr.mergeable !== "MERGEABLE") add(false, "main", `${lack} and whether it merges cleanly could not be read: run preflight again`);
    else if (!Array.isArray(mainPaths) || !Array.isArray(prPaths) || prPaths.length === 0) {
      add(true, "main", `${lack}, without a conflict`);
    } else {
      const mine = new Set(prPaths);
      const shared = mainPaths.filter((p) => mine.has(p));
      if (shared.length > 0) add(true, "main", `${lack}; main changed ${shared.length} file(s) of this PR, without a conflict (${names(shared.slice(0, 3))})`);
      else add(true, "main", `${lack}, but none of its ${mainPaths.length} changed file(s) is in this PR`);
    }
  }
  else add(true, "main", `head contains main ${mainSha.slice(0, 8)}`);

  const task = field(pr.body ?? "", "Task");
  add(filled(task), "task", filled(task) ? "`Task:` filled" : "description lacks a filled `Task:` line");
  for (const label of CONTRACT_LINES) {
    const text = contractText(pr.body, label);
    add(filled(text), `contract:${label}`, filled(text)
      ? `"${label}" present`
      : `description lacks a filled "${label}" line${text === null ? "" : " (label without text)"}`);
  }
  if (/^critical$/i.test(field(pr.body ?? "", "Risk") ?? "")) {
    for (const label of CRITICAL_CONTRACT_LINES) {
      const text = contractText(pr.body, label);
      add(filled(text), `critical-contract:${label}`, filled(text)
        ? `"${label}" present`
        : `critical description lacks a filled "${label}" line${text === null ? "" : " (label without text)"}`);
    }
  }

  // "CI green" means every required context of main reported green on this
  // head; other check runs (the pull_request_target gate evaluator, GitGuardian)
  // must not stand in for a pull_request run that never started.
  const req = Array.isArray(required)
    ? [...new Map(required
      .map((item) => typeof item === "string" ? { context: item, appId: null } : item)
      .filter((item) => item?.context && item.context !== GATE_CONTEXT && item.context !== AUTHORIZATION_CONTEXT && (item.appId == null || Number.isInteger(item.appId)))
      .map((item) => [`${item.context}\n${item.appId ?? "*"}`, { context: item.context, appId: item.appId ?? null }])).values()]
    : [];
  if (!rollup) add(false, "ci", "CI checks could not be read");
  else if (!req.length) add(false, "ci", "required checks of main could not be read");
  else {
    const reported = latestChecks(rollup);
    const missing = req.filter((r) => !reported.some((c) =>
      (c.name ?? c.context) === r.context && (r.appId == null || c.appId === r.appId)));
    // D-161 (b): review and QA start without waiting for CI, so a check that is still
    // PENDING, QUEUED or IN_PROGRESS does not fail preflight; FAILURE, CANCELLED, ERROR and
    // anything unknown still do. "Merge authorization" waits for the owner command by
    // design (like the review gate), so it never counts as CI here; the shared
    // merge-readiness check in orchestrator-core stays strict.
    // At equal or missing times latestChecks keeps the first non-green entry, so a
    // running entry is ordered after a failed one: the verdict must not depend on input order.
    const isRunning = (c) => RUNNING_STATES.has(String(c.conclusion || c.state || c.status || "UNKNOWN").toUpperCase());
    const ordered = rollup.filter((c) => (c.name ?? c.context) !== AUTHORIZATION_CONTEXT)
      .map((c, i) => ({ c, i })).sort((a, b) => (isRunning(a.c) - isRunning(b.c)) || a.i - b.i).map(({ c }) => c);
    const ck = evaluateChecks(ordered);
    const running = ck.bad.filter((c) => RUNNING_STATES.has(c.state));
    const bad = ck.bad.filter((c) => !RUNNING_STATES.has(c.state));
    if (missing.length) add(false, "ci", `required check(s) not reported on the head: ${names(missing.map((r) => r.appId == null ? r.context : `${r.context} app ${r.appId}`))}`);
    else if (bad.length) add(false, "ci", `CI not green: ${bad.map((b) => `${shown(b.name)}=${shown(b.state)}`).join(", ")}`);
    else add(true, "ci", running.length ? `CI not red (${req.length} required, ${running.length} of ${ck.total} checks still running)` : `CI green (${req.length} required, ${ck.total} checks)`);
  }
  return out;
}

export const preflightPass = (checks) => checks.length > 0 && checks.every((c) => c.level === "PASS");

export function requiredStatusChecks(statusChecks) {
  if (!statusChecks || typeof statusChecks !== "object") return null;
  const checks = Array.isArray(statusChecks.checks) ? statusChecks.checks : [];
  const contexts = Array.isArray(statusChecks.contexts) ? statusChecks.contexts : [];
  const configured = [];
  const checkContexts = new Set(checks.filter((item) => typeof item?.context === "string" && item.context)
    .map((item) => item.context));
  for (const item of checks) {
    if (typeof item?.context !== "string" || !item.context) continue;
    const appId = Number.isInteger(item.app_id) && item.app_id >= 0 ? item.app_id : null;
    configured.push({ context: item.context, appId });
  }
  for (const context of contexts) {
    if (typeof context === "string" && context && !checkContexts.has(context)) configured.push({ context, appId: null });
  }
  return [...new Map(configured.map((item) => [`${item.context}\n${item.appId ?? "*"}`, item])).values()];
}

export function preflightExitCode(checks, readErrors = []) {
  if (readErrors.length > 0) return 2;
  return preflightPass(checks) ? 0 : 1;
}
