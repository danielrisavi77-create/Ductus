#!/usr/bin/env node
// DAN-540 (M11.3-P04): every step of the operating procedures in
// docs/OPERATIONS.md names a command that exists in this repository
// ("Naredba: `...`") or an owner from the "Nositelji" table ("Nositelj: `...`").
// Usage: node scripts/operations/check-procedures.mjs [path]. Exit 1 lists problems.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_PROCEDURES = Object.freeze(["Pokretanje", "Gašenje", "Povrat", "Incident"]);

const OWNERS_HEADING = "Nositelji";
const PROCEDURES_HEADING = "Postupci";
// A role, never a placeholder: letters, digits, spaces and hyphens only.
const PLAIN_ROLE_RE = /^[\p{L}\d](?:[\p{L}\d -]*[\p{L}\d])?$/u;
// Inside a required procedure the check reads a strict subset of Markdown and
// fails closed: a line it cannot classify with certainty is a problem, never a
// guessed step boundary (#1803, contract #1091 c.6745350612).
// A step: up to three spaces, one to nine digits, `.` or `)`, one to four
// spaces, then content.
const STEP_START_RE = /^( {0,3})(\d+)[.)](?=[ \t]|$)/;
const STEP_FORM_RE = /^ {0,3}(\d{1,9})[.)] {1,4}(?=\S)/;
const FENCE_LINE_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
const THEMATIC_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// A setext underline; a single `-` stays an empty list item.
const SETEXT_RE = /^[ \t]*(?:=+|-{2,})[ \t]*$/;
const BULLET_RE = /^ {0,3}[-+*] +\S/;
const LIST_MARKER_RE = /^(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const HTML_START_RE = /^<[A-Za-z/!?]/;
// A code span: a whole run of backticks up to the next run of the same length.
const CODE_SPAN_RE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const MARKER_RE = /(?<!\p{L})(Naredba|Nositelj):/gu;
// After a code span, another span follows only after a comma or a joining word.
const NEXT_SPAN_RE = /^(?:\s*,\s*|\s+(?:i|ili|pa)\s+)(?=`)/u;
const ENV_RE = /^[A-Z_][A-Z0-9_]*=/;
// A placeholder such as <pid> is a value, not a redirect.
const PLACEHOLDER_RE = /<[\p{L}\d_-]+>/gu;
// Shell chains, pipes, redirects and substitutions: only one command per span.
const SHELL_OPERATOR_RE = /[;&|<>]|\$\(/;
const BUILT_IN_PNPM = new Set(["install"]);
// curl reads every argument that is not an option as a URL, so options are a
// closed list without values: no option can carry a URL or a config file.
const CURL_FLAGS_RE = /^(?:-[fsSi]+|--fail|--fail-with-body|--silent|--show-error|--include)$/;
const STOP_SIGNALS = new Set(["-TERM", "-INT", "-SIGTERM", "-SIGINT"]);

/**
 * @typedef {{ number: number, line: number, text: string }} Step
 * @typedef {{ name: string, line: number, steps: Step[] }} Procedure
 * @typedef {{ name: string, line: number }} Owner
 * @typedef {{ owners: Owner[], procedures: Procedure[], proceduresLine: number | null, unsupported: Problem[] }} Operations
 * @typedef {{ procedure: string, step: number | null, line: number, message: string }} Problem
 * @typedef {{ scripts: Set<string>, fileExists: (path: string) => boolean, routeExists: (route: string) => boolean }} Context
 */

/**
 * Why a line's content (without its indentation) is outside the subset, after
 * any list markers: an empty item or one followed by a tab or more than four
 * spaces, a quote, HTML outside code spans, a link reference definition, or a
 * fence or thematic break inside a list item: each can hide or move a marker.
 * @param {string} content
 * @returns {string | null}
 */
function blockProblem(content) {
  let rest = content;
  for (let marker = LIST_MARKER_RE.exec(rest); marker; marker = LIST_MARKER_RE.exec(rest)) {
    const after = rest.slice(marker[0].length);
    const gap = /^[ \t]*/.exec(after)?.[0] ?? "";
    if (gap === after || gap.includes("\t") || gap.length > 4) return "list item form";
    rest = after.slice(gap.length);
  }
  if (rest.startsWith(">")) return "block quote";
  if (HTML_START_RE.test(rest)) return "HTML block";
  if (/^\[[^\]]*\]:/.test(rest)) return "link reference definition";
  if (rest !== content && FENCE_LINE_RE.test(rest)) return "fence after a list marker";
  if (rest !== content && THEMATIC_RE.test(rest)) return "thematic break";
  if (/<[A-Za-z/!?]/.test(rest.replace(CODE_SPAN_RE, ""))) return "inline HTML";
  return null;
}

/** @param {string} row */
function cells(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Reads the owners table and the procedures under "## Postupci". Lines inside
 * code fences are never headings, steps or markers. Inside a procedure a line
 * outside the strict subset goes to `unsupported` with its line.
 * @param {string} text
 * @returns {Operations}
 */
export function parseOperations(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  /** @type {Owner[]} */
  const owners = [];
  /** @type {Procedure[]} */
  const procedures = [];
  /** @type {Problem[]} */
  const unsupported = [];
  /** @type {number | null} */
  let proceduresLine = null;
  let section = "";
  /** @type {Procedure | null} */
  let procedure = null;
  // `paragraph`: the step's last line was paragraph text, so a less indented
  // line could continue it lazily. `offset`: the step's content column.
  /** @type {{ step: Step, parts: string[], paragraph: boolean, offset: number } | null} */
  let open = null;
  // `prose`: the last line in the procedure was paragraph text outside a step.
  let prose = false;
  // `strict`: opened inside a procedure; `inStep`: opened at the step's content.
  /** @type {{ indent: string, mark: string, line: number, strict: boolean, inStep: boolean, procedure: string, step: number | null } | null} */
  let fence = null;
  let tableHeaderSeen = false;

  const closeStep = () => {
    if (open) open.step.text = open.parts.join("\n");
    open = null;
  };
  /** @param {number} line @param {string} what @param {number | null} [step] */
  const refuse = (line, what, step = open ? open.step.number : null) =>
    unsupported.push({ procedure: procedure?.name ?? (section || "-"), step, line, message: `unsupported markdown: ${what}` });
  /** @param {string} indent @param {RegExpExecArray} match @param {number} line @param {boolean} inStep */
  const openFence = (indent, match, line, inStep) => {
    fence = {
      indent,
      mark: match[2] ?? "",
      line,
      strict: procedure !== null,
      inStep,
      procedure: procedure?.name ?? (section || "-"),
      step: inStep && open ? open.step.number : null,
    };
  };

  /** @param {string} line @param {number} lineNumber @returns {boolean} the line was a heading */
  const readHeading = (line, lineNumber) => {
    const heading = HEADING_RE.exec(line);
    if (!heading) return false;
    closeStep();
    prose = false;
    const level = heading[1]?.length ?? 0;
    const title = (heading[2] ?? "").trim();
    if (level <= 2) {
      section = level === 2 ? title : "";
      procedure = null;
      tableHeaderSeen = false;
      if (section === PROCEDURES_HEADING && proceduresLine === null) proceduresLine = lineNumber;
    } else if (level === 3 && section === PROCEDURES_HEADING) {
      procedure = { name: title, line: lineNumber, steps: [] };
      procedures.push(procedure);
    } else if (level === 3) {
      procedure = null;
    }
    return true;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
    const content = line.slice(lead.length);
    const fenceLine = FENCE_LINE_RE.exec(line);

    if (fence !== null) {
      const sameMark = fenceLine !== null && (fenceLine[2] ?? "")[0] === fence.mark[0];
      const closes =
        sameMark &&
        (fenceLine?.[2] ?? "").length >= fence.mark.length &&
        (fenceLine?.[3] ?? "").trim() === "" &&
        (fence.strict ? lead === fence.indent : /^ {0,3}$/.test(lead));
      if (closes) {
        fence = null;
        if (open) open.paragraph = false;
        prose = false;
        return;
      }
      const leaves = fence.inStep && content !== "" && !lead.startsWith(fence.indent);
      if (sameMark && fence.strict) {
        refuse(lineNumber, "fence closing line with text or another indentation", fence.step);
      }
      if (!leaves) return;
      // A less indented line ends the step, and the fence with it (CommonMark).
      refuse(lineNumber, "fence in a step ends before its closing line", fence.step);
      fence = null;
      closeStep();
      prose = false;
      readHeading(line, lineNumber);
      return;
    }

    if (readHeading(line, lineNumber)) return;

    if (procedure === null) {
      // An HTML block can hide a heading anywhere, so the document refuses it.
      if (/^ {0,3}$/.test(lead) && HTML_START_RE.test(content)) {
        refuse(lineNumber, "HTML block");
        return;
      }
      if (fenceLine && /^ {0,3}$/.test(lead) && !(fenceLine[2]?.startsWith("`") && fenceLine[3]?.includes("`"))) {
        openFence(lead, fenceLine, lineNumber, false);
        return;
      }
      if (section === OWNERS_HEADING && content.startsWith("|")) {
        const row = cells(line);
        if (row.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
        if (!tableHeaderSeen) {
          tableHeaderSeen = true;
          return;
        }
        const name = (row[0] ?? "").replace(/^`(.*)`$/, "$1").trim();
        if (name) owners.push({ name, line: lineNumber });
      }
      return;
    }

    if (content === "") {
      if (open) open.paragraph = false;
      prose = false;
      return;
    }

    if (fenceLine) {
      const atStep = open !== null && lead === " ".repeat(open.offset);
      if (fenceLine[2]?.startsWith("`") && fenceLine[3]?.includes("`")) {
        refuse(lineNumber, "fence info string with a backtick");
        closeStep();
        return;
      }
      if (lead !== "" && !atStep) refuse(lineNumber, "fence indentation");
      if (atStep && open) open.paragraph = false;
      else closeStep();
      openFence(lead, fenceLine, lineNumber, atStep);
      prose = false;
      return;
    }

    /** @param {string} what */
    const refuseLine = (what) => {
      refuse(lineNumber, what);
      closeStep();
      prose = false;
    };
    if (lead.includes("\t")) return refuseLine("tab in indentation");
    if (THEMATIC_RE.test(line)) return refuseLine("thematic break");
    if (SETEXT_RE.test(line)) return refuseLine("setext heading underline");
    const inContent = open !== null && lead.length >= open.offset;
    if (!inContent && lead !== "" && HEADING_RE.test(content)) return refuseLine("indented heading");

    const start = inContent ? null : STEP_START_RE.exec(line);
    if (start) {
      const digits = start[2] ?? "";
      const number = digits.length <= 9 ? Number(digits) : null;
      const form = STEP_FORM_RE.exec(line);
      const afterProse = open === null && prose;
      closeStep();
      if (afterProse) refuse(lineNumber, "list item right after a paragraph", number);
      else if (!form) refuse(lineNumber, "list item form", number);
      const problem = form && !afterProse ? blockProblem(content) : null;
      if (problem) refuse(lineNumber, problem, number);
      prose = false;
      if (number === null) return;
      const step = { number, line: lineNumber, text: "" };
      procedure.steps.push(step);
      if (form && !afterProse && !problem) {
        open = { step, parts: [line.slice(form[0].length)], paragraph: true, offset: form[0].length };
      }
      return;
    }

    if (open && inContent) {
      if (lead.length >= open.offset + 4) return refuseLine("indented code");
      const problem = blockProblem(content);
      if (problem) return refuseLine(problem);
      open.parts.push(content);
      open.paragraph = true;
      return;
    }

    const problem = blockProblem(content);
    if (problem) return refuseLine(problem);
    if (open && open.paragraph && !BULLET_RE.test(line)) return refuseLine("lazy continuation");
    closeStep();
    prose = true;
  });

  if (fence !== null && fence.strict) {
    unsupported.push({ procedure: fence.procedure, step: fence.step, line: fence.line, message: "unsupported markdown: unclosed fence" });
  }
  closeStep();

  return { owners, procedures, proceduresLine, unsupported };
}

/**
 * The code spans right after a marker: `a`, `b` i `c`. Null when none follows.
 * @param {string} rest
 * @returns {string[] | null}
 */
function spansAfter(rest) {
  /** @type {string[]} */
  const spans = [];
  let tail = rest.replace(/^\s*/, "");
  for (;;) {
    const span = /^`([^`]*)`/.exec(tail);
    if (!span) break;
    spans.push((span[1] ?? "").trim());
    tail = tail.slice(span[0].length);
    const next = NEXT_SPAN_RE.exec(tail);
    if (!next) break;
    tail = tail.slice(next[0].length);
  }
  return spans.length > 0 && spans.every(Boolean) ? spans : null;
}

/**
 * @param {string} url
 * @param {Context} context
 * @returns {string | null}
 */
function curlUrlProblem(url, context) {
  if (!/^https?:\/\//.test(url)) return `curl argument is not an http(s) URL: ${url}`;
  // curl expands {a,b} and [1-2] into several URLs.
  if (/[{}[\]]/.test(url)) return `curl URL globbing is not allowed: ${url}`;
  let pathname;
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return `curl URL is not under /api/: ${url}`;
  }
  if (!pathname.startsWith("/api/")) return `curl URL is not under /api/: ${url}`;
  return context.routeExists(pathname) ? null : `no route app${pathname}/route.ts`;
}

/**
 * @param {string} command
 * @param {Context} context
 * @returns {string | null}
 */
function commandProblem(command, context) {
  if (SHELL_OPERATOR_RE.test(command.replace(PLACEHOLDER_RE, ""))) {
    return `command chains, pipes or redirects are not allowed: ${command}`;
  }
  const tokens = command.split(/\s+/).filter(Boolean);
  while (tokens[0] && ENV_RE.test(tokens[0])) tokens.shift();
  const [program, ...args] = tokens;
  const firstPlain = (/** @type {string[]} */ list) => list.find((arg) => !arg.startsWith("-"));

  switch (program) {
    case undefined:
      return "Naredba: is not followed by a command in inline code";
    case "pnpm": {
      const rest = args[0] === "run" ? args.slice(1) : args;
      const script = firstPlain(rest);
      if (!script) return "pnpm command names no script";
      if (BUILT_IN_PNPM.has(script) || context.scripts.has(script)) return null;
      return `pnpm script not in package.json: ${script}`;
    }
    case "node": {
      const file = firstPlain(args);
      if (!file) return "node command names no file";
      return context.fileExists(file) ? null : `node file does not exist: ${file}`;
    }
    case "curl": {
      const options = args.filter((arg) => arg.startsWith("-"));
      const refused = options.find((arg) => !CURL_FLAGS_RE.test(arg));
      if (refused) return `curl option not allowed: ${refused}`;
      // curl fetches every non-option argument, so exactly one may follow.
      const urls = args.filter((arg) => !arg.startsWith("-"));
      const url = urls[0];
      if (!url) return "curl command names no URL";
      if (urls.length > 1) return `curl names more than one URL: ${urls.join(" ")}`;
      return curlUrlProblem(url, context);
    }
    case "docker":
      return args[0] === "compose" && args[1] && !args[1].startsWith("-")
        ? null
        : "docker command is not docker compose <subcommand>";
    case "kill":
      return args.some((arg) => STOP_SIGNALS.has(arg)) ? null : "kill sends neither -TERM nor -INT";
    default:
      return `program not allowed: ${program}`;
  }
}

/**
 * @param {string} text
 * @param {Context} context
 * @returns {Problem[]}
 */
export function checkOperations(text, context) {
  const { owners, procedures, proceduresLine, unsupported } = parseOperations(text);
  /** @type {Problem[]} */
  const problems = [];
  const known = new Set();

  if (owners.length === 0) {
    problems.push({ procedure: OWNERS_HEADING, step: null, line: 1, message: "owners table is missing or empty" });
  }
  for (const owner of owners) {
    if (PLAIN_ROLE_RE.test(owner.name)) known.add(owner.name);
    else {
      problems.push({
        procedure: OWNERS_HEADING,
        step: null,
        line: owner.line,
        message: `owner is not a plain role name: ${owner.name}`,
      });
    }
  }

  problems.push(...unsupported);

  const seen = new Set();
  for (const procedure of procedures) {
    /** @param {number | null} step @param {number} line @param {string} message */
    const report = (step, line, message) => problems.push({ procedure: procedure.name, step, line, message });
    if (seen.has(procedure.name)) {
      report(null, procedure.line, "procedure appears more than once");
      continue;
    }
    seen.add(procedure.name);
    if (procedure.steps.length === 0) report(null, procedure.line, "procedure has no steps");

    let previous = 0;
    for (const step of procedure.steps) {
      if (step.number !== previous + 1) {
        report(step.number, step.line, `step is numbered ${step.number}, expected ${previous + 1}`);
      }
      previous = step.number;

      const body = step.text.replace(/\*\*(Naredba|Nositelj):\*\*/g, "$1:");
      // A marker written inside a code span is an example, not a marker.
      const codeSpans = [...body.matchAll(CODE_SPAN_RE)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
      const markers = [...body.matchAll(MARKER_RE)].filter(
        (m) => !codeSpans.some(([from, to]) => (m.index ?? 0) >= from && (m.index ?? 0) < to),
      );
      if (markers.length === 0) report(step.number, step.line, "step has neither Naredba: nor Nositelj:");
      for (const marker of markers) {
        const kind = marker[1];
        const spans = spansAfter(body.slice((marker.index ?? 0) + marker[0].length));
        if (kind === "Naredba") {
          if (!spans) report(step.number, step.line, "Naredba: is not followed by a command in inline code");
          for (const command of spans ?? []) {
            const problem = commandProblem(command, context);
            if (problem) report(step.number, step.line, problem);
          }
        } else {
          if (!spans) report(step.number, step.line, "Nositelj: is not followed by an owner in inline code");
          for (const owner of spans ?? []) {
            if (!known.has(owner)) report(step.number, step.line, `owner not in Nositelji: ${owner}`);
          }
        }
      }
    }
  }

  for (const name of REQUIRED_PROCEDURES) {
    if (!seen.has(name)) {
      problems.push({ procedure: name, step: null, line: proceduresLine ?? 1, message: "required procedure is missing" });
    }
  }
  return problems;
}

/**
 * Scripts, files and API routes of the repository at `root`. Paths that leave
 * the root never exist.
 * @param {URL} root
 * @returns {Context}
 */
export function repoContext(root) {
  const base = fileURLToPath(root);
  const pkg = JSON.parse(readFileSync(resolve(base, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  /** @param {string} path */
  const fileExists = (path) => {
    const target = resolve(base, path);
    const inside = relative(base, target);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return false;
    return existsSync(target) && statSync(target).isFile();
  };
  /** @param {string} route */
  const routeExists = (route) => {
    if (!route.startsWith("/api/")) return false;
    const segments = route.slice(1).split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
    return fileExists(`app/${segments.join("/")}/route.ts`);
  };
  return { scripts, fileExists, routeExists };
}

function main() {
  const root = new URL("../../", import.meta.url);
  const file = process.argv[2] ?? "docs/OPERATIONS.md";
  const text = readFileSync(resolve(fileURLToPath(root), file), "utf8");
  const problems = checkOperations(text, repoContext(root));
  for (const p of problems) {
    console.error(`${file}:${p.line}: ${p.procedure}#${p.step ?? "-"}: ${p.message}`);
  }
  if (problems.length > 0) process.exit(1);
  console.log(`${file}: ${REQUIRED_PROCEDURES.length} procedures, every step has a command or an owner`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
