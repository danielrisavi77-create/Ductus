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
// A list item may start after up to three spaces and end its number with `.`
// or `)` (CommonMark).
const STEP_RE = /^( {0,3})(\d+)[.)]\s+/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const MARKER_RE = /(?<!\p{L})(Naredba|Nositelj):/gu;
// After a code span, another span follows only after a comma or a joining word.
const NEXT_SPAN_RE = /^(?:\s*,\s*|\s+(?:i|ili|pa)\s+)(?=`)/u;
const ENV_RE = /^[A-Z_][A-Z0-9_]*=/;
// A placeholder such as <pid> is a value, not a redirect.
const PLACEHOLDER_RE = /<[\p{L}\d_-]+>/gu;
// Shell chains, pipes, redirects and substitutions: only one command per span.
const SHELL_OPERATOR_RE = /[;&|<>]|\$\(/;
// Blocks that end a paragraph, so a line starting one is never a lazy
// continuation (CommonMark): fence, bullet, quote, thematic break.
const INTERRUPT_RE = /^ {0,3}(?:`{3,}|~{3,}|[-+*][ \t]+\S|>|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;
const BUILT_IN_PNPM = new Set(["install"]);
// curl reads every argument that is not an option as a URL, so options are a
// closed list without values: no option can carry a URL or a config file.
const CURL_FLAGS_RE = /^(?:-[fsSi]+|--fail|--fail-with-body|--silent|--show-error|--include)$/;
const STOP_SIGNALS = new Set(["-TERM", "-INT", "-SIGTERM", "-SIGINT"]);

/**
 * @typedef {{ number: number, line: number, text: string }} Step
 * @typedef {{ name: string, line: number, steps: Step[] }} Procedure
 * @typedef {{ name: string, line: number }} Owner
 * @typedef {{ owners: Owner[], procedures: Procedure[], proceduresLine: number | null }} Operations
 * @typedef {{ procedure: string, step: number | null, line: number, message: string }} Problem
 * @typedef {{ scripts: Set<string>, fileExists: (path: string) => boolean, routeExists: (route: string) => boolean }} Context
 */

/**
 * The column after the spaces and tabs at the start of `text`, which starts at
 * column `from`; a tab advances to the next multiple of four.
 * @param {string} text
 * @param {number} [from]
 */
function indentEnd(text, from = 0) {
  let column = from;
  for (const char of text) {
    if (char === " ") column += 1;
    else if (char === "\t") column += 4 - (column % 4);
    else break;
  }
  return column;
}

/**
 * The content column of a list item (CommonMark): after the marker and the
 * spaces that follow it, or one column after the marker when five or more follow.
 * @param {string} line
 * @param {RegExpExecArray} match
 */
function contentColumn(line, match) {
  const markerEnd = (match[1] ?? "").length + (match[2] ?? "").length + 1;
  const end = indentEnd(line.slice(markerEnd), markerEnd);
  return end - markerEnd >= 5 ? markerEnd + 1 : end;
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
 * code fences are never headings, steps or markers.
 * @param {string} text
 * @returns {Operations}
 */
export function parseOperations(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  /** @type {Owner[]} */
  const owners = [];
  /** @type {Procedure[]} */
  const procedures = [];
  /** @type {number | null} */
  let proceduresLine = null;
  let section = "";
  /** @type {Procedure | null} */
  let procedure = null;
  // `paragraph`: a paragraph of the step is open, so a less indented line may
  // continue it lazily.
  /** @type {{ step: Step, parts: string[], paragraph: boolean, offset: number } | null} */
  let open = null;
  /** @type {string | null} */
  let fence = null;
  let tableHeaderSeen = false;

  const closeStep = () => {
    if (open) open.step.text = open.parts.join("\n");
    open = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (fence !== null) {
      if (line.trim().startsWith(fence)) {
        fence = null;
        if (open) open.paragraph = false;
      }
      return;
    }
    const fenceOpen = FENCE_RE.exec(line);
    const heading = fenceOpen ? null : /^(#{1,6})\s+(.*)$/.exec(line);

    if (heading) {
      closeStep();
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
      return;
    }

    if (section === OWNERS_HEADING && !fenceOpen && line.trim().startsWith("|")) {
      const row = cells(line);
      if (row.every((cell) => /^:?-{3,}:?$/.test(cell))) return;
      if (!tableHeaderSeen) {
        tableHeaderSeen = true;
        return;
      }
      const name = (row[0] ?? "").replace(/^`(.*)`$/, "$1").trim();
      if (name) owners.push({ name, line: lineNumber });
      return;
    }

    if (procedure) {
      const match = fenceOpen ? null : STEP_RE.exec(line);
      // A numbered line indented to the open step's content is nested in it.
      const start = match && (!open || (match[1] ?? "").length < open.offset) ? match : null;
      if (start) {
        closeStep();
        const step = { number: Number(start[2]), line: lineNumber, text: "" };
        procedure.steps.push(step);
        open = { step, parts: [line.slice(start[0].length)], paragraph: true, offset: contentColumn(line, start) };
      } else if (open && line.trim() === "") {
        open.paragraph = false;
      } else if (open && (indentEnd(line) >= open.offset || (open.paragraph && !INTERRUPT_RE.test(line)))) {
        // A line indented to the step's content, or a lazy paragraph continuation.
        if (!fenceOpen) open.parts.push(line.trim());
        open.paragraph = !fenceOpen;
      } else {
        closeStep();
      }
    }

    if (fenceOpen) fence = fenceOpen[1] ?? null;
  });
  closeStep();

  return { owners, procedures, proceduresLine };
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
  const { owners, procedures, proceduresLine } = parseOperations(text);
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
      const markers = [...body.matchAll(MARKER_RE)];
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
