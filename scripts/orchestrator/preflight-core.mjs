// P1-1: the checks the orchestrator runs before it starts review or QA
// (docs/ORKESTRATOR.md, "prije pokretanja reviewa ili QA-e"). Pure: no gh/git.
import { field } from "../engineering/metadata-parser.mjs";
import { evaluateChecks, GATE_CONTEXT, latestChecks } from "./orchestrator-core.mjs";

// ENGINEERING_SYSTEM §14 lines the orchestrator requires besides `Task:`.
export const CONTRACT_LINES = [
  "Stvarni pozivatelj",
  "Poznate granice",
  "Što bi ovaj PR moglo oboriti na QA-i?",
];

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
  const lines = String(body ?? "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const fenceLine = (l) => /^\s*(```|~~~)/.test(l);
  const fieldItem = (l) => /^\s*([-+*]|\d+\.)?\s*\*\*[^*]+\*\*/.test(l);
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (fenceLine(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
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
    while (j < lines.length && lines[j].trim() === "") j += 1;
    for (; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() === "" || fenceLine(l) || isHeading(l) || fieldItem(l)) break;
      after.push(bare(l));
    }
    return after.join(" ").trim();
  }
  return null;
}

/**
 * Preflight verdict for one PR. Every check is PASS or FAIL; there is no
 * "unknown counts as pass". Input:
 *   pr        toPr() shape (state, isDraft, headRefOid, baseRefName, body)
 *   mainSha   main head the PR is compared against
 *   compare   REST compare of mainSha...head ({status, behind_by}) or null when unread
 *   rollup    checkRollup(head) or null when unread
 *   required  required status contexts of main's branch protection, or null when unread;
 *             each one except the review gate must be reported on the head
 *   expectHead optional head the caller planned for; a different head fails
 */
export function evaluatePreflight({ pr, mainSha, compare, rollup, required, expectHead = null }) {
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
  else if (compare.behind_by > 0) add(false, "main", `head lacks ${compare.behind_by} commit(s) of main ${mainSha.slice(0, 8)}: merge main first`);
  else add(true, "main", `head contains main ${mainSha.slice(0, 8)}`);

  const task = field(pr.body ?? "", "Task");
  add(filled(task), "task", filled(task) ? "`Task:` filled" : "description lacks a filled `Task:` line");
  for (const label of CONTRACT_LINES) {
    const text = contractText(pr.body, label);
    add(filled(text), `contract:${label}`, filled(text)
      ? `"${label}" present`
      : `description lacks a filled "${label}" line${text === null ? "" : " (label without text)"}`);
  }

  // "CI green" means every required context of main reported green on this
  // head; other check runs (the pull_request_target gate evaluator, GitGuardian)
  // must not stand in for a pull_request run that never started.
  const req = Array.isArray(required) ? [...new Set(required.filter((n) => n && n !== GATE_CONTEXT))] : [];
  if (!rollup) add(false, "ci", "CI checks could not be read");
  else if (!req.length) add(false, "ci", "required checks of main could not be read");
  else {
    const reported = new Set(latestChecks(rollup).map((c) => c.name ?? c.context));
    const missing = req.filter((n) => !reported.has(n));
    const ck = evaluateChecks(rollup);
    if (missing.length) add(false, "ci", `required check(s) not reported on the head: ${names(missing)}`);
    else if (ck.bad.length) add(false, "ci", `CI not green: ${ck.bad.map((b) => `${shown(b.name)}=${shown(b.state)}`).join(", ")}`);
    else add(true, "ci", `CI green (${req.length} required, ${ck.total} checks)`);
  }
  return out;
}

export const preflightPass = (checks) => checks.length > 0 && checks.every((c) => c.level === "PASS");
