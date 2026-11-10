#!/usr/bin/env node
// DAN-540 (M11.3-P04): every step of the operating procedures in
// docs/OPERATIONS.md names a command that exists in this repository
// ("Naredba: `...`") or an owner from the "Nositelji" table ("Nositelj: `...`").
// Usage: node scripts/operations/check-procedures.mjs [path]. Exit 1 lists problems.
//
// The check does not interpret CommonMark (#1803, contract #1091 c.6750197325).
// In the sections "Nositelji" and "Postupci" it reads only this line subset and
// refuses every other line with `unsupported markdown: <what>`:
// - a blank line, or a heading `#`, `##` or `###` at column 0 (a closing run
//   of `#` after a space or tab is not part of the title, as in CommonMark);
// - a step: one line `N. ` (one to nine digits, a dot, one space) followed by a
//   letter or `**`, at column 0, inside a `###` procedure, after a blank line,
//   a heading, a fence or another step; a step never continues on the next line;
// - a paragraph line starting with a letter or `**`, not right after a step;
// - in "Nositelji", one table: a header row after a blank line or heading, then
//   a separator row of `---` cells with the same column count, then rows;
// - a fence of three or more backticks at column 0 with an optional one-word
//   info string, closed by a line of at least as many backticks and nothing else.
// On those lines code is single backticks closed on the same line; a run of two
// or more backticks, a backslash before a backtick, HTML outside code and, on
// a step line, `Naredba:` or `Nositelj:` inside a code span and a `[` outside
// code (a link or an image) are refused.
// Anywhere in the document a tilde fence, an indented fence, an indented
// heading, an HTML block, a setext underline and an unclosed fence are refused,
// because each could hide or move a heading, step or marker.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_PROCEDURES = Object.freeze(["Pokretanje", "Gašenje", "Povrat", "Incident"]);

const OWNERS_HEADING = "Nositelji";
const PROCEDURES_HEADING = "Postupci";
const STRICT_SECTIONS = new Set([OWNERS_HEADING, PROCEDURES_HEADING]);
// A role, never a placeholder: letters, digits, spaces and hyphens only.
const PLAIN_ROLE_RE = /^[\p{L}\d](?:[\p{L}\d -]*[\p{L}\d])?$/u;
const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
const FENCE_OPEN_RE = /^([ \t]*)(`{3,})(.*)$/;
const STEP_LIKE_RE = /^(\d+)[.)](?:[ \t]|$)/;
const STEP_RE = /^(\d{1,9})\. (?=(?:\*\*)?\p{L})/u;
const PROSE_RE = /^(?:\*\*)?\p{L}/u;
const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const HTML_RE = /<[A-Za-z/!?]/;
// A code span: one backtick up to the next one on the same line.
const CODE_SPAN_RE = /`[^`]*`/g;
const MARKER_RE = /(?<!\p{L})(Naredba|Nositelj):/gu;
// After a code span, another span follows only after a comma or a joining word.
const NEXT_SPAN_RE = /^(?:\s*,\s*|\s+(?:i|ili|pa)\s+)(?=`)/u;
// An environment prefix such as `NODE_OPTIONS=... pnpm x` changes what the command runs.
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
// A placeholder such as <pid> is a value, not a redirect.
const PLACEHOLDER_RE = /<[\p{L}\d_-]+>/gu;
// Shell chains, pipes, redirects and substitutions: only one command per span.
const SHELL_OPERATOR_RE = /[;&|<>]|\$\(/;
const BUILT_IN_PNPM = new Set(["install"]);
// pnpm and node options (`--dir=`, `--filter`, `--import=`, `-r`) change what
// runs or where, so only these install options are allowed, and none elsewhere.
const INSTALL_FLAGS = new Set(["--frozen-lockfile", "--offline", "--prefer-offline"]);
// curl reads every argument that is not an option as a URL, so options are a
// closed list without values: no option can carry a URL or a config file.
const CURL_FLAGS_RE = /^(?:-[fsSi]+|--fail|--fail-with-body|--silent|--show-error|--include)$/;
const STOP_SIGNALS = new Set(["-TERM", "-INT", "-SIGTERM", "-SIGINT"]);

/**
 * @typedef {{ number: number, line: number, text: string, refused?: boolean }} Step
 * @typedef {{ name: string, line: number, steps: Step[] }} Procedure
 * @typedef {{ name: string, line: number }} Owner
 * @typedef {{ owners: Owner[], procedures: Procedure[], proceduresLine: number | null, unsupported: Problem[] }} Operations
 * @typedef {{ procedure: string, step: number | null, line: number, message: string }} Problem
 * @typedef {{ scripts: Set<string>, fileExists: (path: string) => boolean, routeExists: (route: string) => boolean }} Context
 */

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
 * Why a line's inline content is outside the subset, or null.
 * @param {string} line
 * @param {boolean} [step] a step line, whose markers are read
 * @returns {string | null}
 */
function inlineProblem(line, step = false) {
  if (line.includes("\\`")) return "backslash before a backtick";
  if (line.includes("``")) return "two or more backticks in a row";
  if ((line.match(/`/g) ?? []).length % 2 === 1) return "code span not closed on its line";
  if (step && (line.match(CODE_SPAN_RE) ?? []).some((span) => /(?:naredba|nositelj):/i.test(span))) {
    return "marker inside a code span";
  }
  if (HTML_RE.test(line.replace(CODE_SPAN_RE, ""))) return "inline HTML";
  // A link title or an image alt text can carry a marker that is not shown.
  if (step && line.replace(CODE_SPAN_RE, "").includes("[")) return "square bracket outside code (link or image)";
  return null;
}

/**
 * Reads the owners table and the procedures under "## Postupci" in the line
 * subset described at the top of this file. A refused line goes to
 * `unsupported` with its line and changes nothing else; a refused step is kept
 * for numbering, with `refused`, and its markers are not read.
 * @param {string} text
 * @returns {Operations}
 */
export function parseOperations(text) {
  // CommonMark strips only spaces (U+0020) and tabs; trimEnd() would also strip
  // NBSP and other Unicode spaces (QA FAIL on 4203cc68, contract #1836 w540k).
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/, ""));
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
  /** @type {Step | null} the open step: its line was the last line */
  let step = null;
  /** @type {"blank" | "heading" | "fence" | "prose" | "step" | "table"} */
  let prev = "blank";
  /** @type {{ line: number, length: number, procedure: string } | null} */
  let fence = null;
  /** @type {{ state: "separator" | "body" | "bad", columns: number } | null} */
  let table = null;
  let prevNonBlank = false;

  /** @param {number} line @param {string} what */
  const refuse = (line, what) =>
    unsupported.push({ procedure: procedure?.name ?? (section || "-"), step: step?.number ?? null, line, message: `unsupported markdown: ${what}` });
  /** @param {number} line */
  const endTable = (line) => {
    if (table?.state === "separator") refuse(line, "table without a separator row");
    table = null;
  };

  /** @param {string} line @param {number} lineNumber */
  const read = (line, lineNumber) => {
    if (fence !== null) {
      if (new RegExp(`^\`{${fence.length},}$`).test(line)) {
        fence = null;
        prev = "fence";
      } else if (/^[ \t]*(?:`{3,}|~{3,})/.test(line)) refuse(lineNumber, "fence line inside a fence");
      return;
    }
    const strict = STRICT_SECTIONS.has(section);
    if (/^[ \t]*~{3,}/.test(line)) return refuse(lineNumber, "tilde fence");
    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      if (open[1]) return refuse(lineNumber, "indented fence");
      if (!/^[A-Za-z0-9_+-]*$/.test((open[3] ?? "").trimStart())) return refuse(lineNumber, "fence form");
      endTable(lineNumber);
      fence = { line: lineNumber, length: open[2]?.length ?? 3, procedure: procedure?.name ?? (section || "-") };
      step = null;
      prev = "fence";
      return;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 0;
      if (strict && level > 3) return refuse(lineNumber, "heading level");
      endTable(lineNumber);
      step = null;
      prev = "heading";
      // CommonMark ATX: a closing run of `#` after a space or tab is not part
      // of the title, and a title of `#` only is empty (#1803, contract #1836).
      const raw = (heading[2] ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
      const title = /^#+$/.test(raw) ? "" : raw.replace(/[ \t]+#+$/, "");
      if (level <= 2) {
        section = level === 2 ? title : "";
        procedure = null;
        if (section === PROCEDURES_HEADING && proceduresLine === null) proceduresLine = lineNumber;
      } else if (level === 3) {
        procedure = section === PROCEDURES_HEADING ? { name: title, line: lineNumber, steps: [] } : null;
        if (procedure) procedures.push(procedure);
      }
      return;
    }
    if (/^ {1,3}#{1,6}(?:[ \t]|$)/.test(line)) return refuse(lineNumber, "indented heading");
    if (/^ {0,3}<[A-Za-z/!?]/.test(line)) return refuse(lineNumber, "HTML block");
    if (prevNonBlank && /^ {0,3}(?:=+|-+)$/.test(line)) return refuse(lineNumber, "setext heading underline");
    if (!strict) return;

    if (line === "") {
      endTable(lineNumber);
      step = null;
      prev = "blank";
      return;
    }
    if (/^[ \t]/.test(line)) return refuse(lineNumber, "indented line");

    const stepLike = STEP_LIKE_RE.exec(line);
    if (stepLike) {
      const digits = stepLike[1] ?? "";
      const number = digits.length <= 9 ? Number(digits) : null;
      if (procedure === null) return refuse(lineNumber, "step outside a procedure");
      const form = STEP_RE.exec(line);
      const problem = !form ? "step form" : prev === "prose" || prev === "table" ? "step right after a paragraph" : inlineProblem(line, true);
      step = number === null ? null : { number, line: lineNumber, text: form ? line.slice(form[0].length) : "", refused: problem !== null };
      if (step) procedure.steps.push(step);
      if (problem) refuse(lineNumber, problem);
      prev = "step";
      return;
    }

    if (line.startsWith("|")) {
      if (section !== OWNERS_HEADING) return refuse(lineNumber, "line form");
      const row = cells(line);
      const problem = inlineProblem(line);
      if (table === null) {
        if (prev !== "blank" && prev !== "heading") {
          table = { state: "bad", columns: 0 };
          refuse(lineNumber, "table right after a paragraph");
        } else if (problem) {
          table = { state: "bad", columns: 0 };
          refuse(lineNumber, problem);
        } else table = { state: "separator", columns: row.length };
      } else if (table.state === "separator") {
        const separator = row.every((cell) => SEPARATOR_CELL_RE.test(cell));
        if (separator && row.length === table.columns) table.state = "body";
        else {
          table.state = "bad";
          refuse(lineNumber, separator ? "table separator does not match the header" : "table without a separator row");
        }
      } else if (table.state === "body") {
        // A row of another width is not part of this table (QA and review on e472fa77, contract c.5).
        if (problem) refuse(lineNumber, problem);
        else if (row.length !== table.columns) refuse(lineNumber, "table row does not match the header");
        else {
          const name = (row[0] ?? "").replace(/^`(.*)`$/, "$1").trim();
          if (name) owners.push({ name, line: lineNumber });
        }
      }
      prev = "table";
      return;
    }

    if (PROSE_RE.test(line)) {
      if (step !== null) return refuse(lineNumber, "lazy continuation");
      if (prev === "table") return refuse(lineNumber, "line right after a table");
      const problem = inlineProblem(line);
      if (problem) return refuse(lineNumber, problem);
      prev = "prose";
      return;
    }
    refuse(lineNumber, "line form");
  };

  lines.forEach((line, index) => {
    read(line, index + 1);
    prevNonBlank = line !== "";
  });
  endTable(lines.length);
  if (fence !== null) {
    unsupported.push({ procedure: fence.procedure, step: null, line: fence.line, message: "unsupported markdown: unclosed fence" });
  }

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
    // Only spaces and tabs are trimmed; any other space stays and is refused.
    spans.push((span[1] ?? "").replace(/^[ \t]+|[ \t]+$/g, ""));
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
  // Bash drops an unquoted backslash while new URL() reads it as `/` (review
  // FAIL on 4203cc68, contract #1836 w540k), so it is refused before parsing.
  if (url.includes("\\")) return `curl URL contains a backslash: ${url}`;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return `curl URL is not under /api/: ${url}`;
  }
  // new URL() also resolves `.`, `..` and `%2e` segments, so the path it
  // returns must be the path as written, which is what curl sends.
  const written = /^https?:\/\/[^/?#]*([^?#]*)/.exec(url)?.[1] || "/";
  if (written !== parsed.pathname) return `curl URL path is not in normal form: ${url}`;
  const pathname = parsed.pathname.replace(/\/+$/, "");
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
  // Bash splits words only on spaces and tabs, so `pnpm<NBSP>install` is one
  // word that does not exist (Codex c.4523669643 on 0d2fc9fc, #1803 w540k).
  if (/[^\S \t]|\u0085/u.test(command)) return `command contains a space other than U+0020 or a tab: ${command}`;
  const tokens = command.split(/[ \t]+/).filter(Boolean);
  if (tokens[0] && ENV_RE.test(tokens[0])) return `environment prefix not allowed: ${tokens[0]}`;
  const [program, ...args] = tokens;

  switch (program) {
    case undefined:
      return "Naredba: is not followed by a command in inline code";
    case "pnpm": {
      // `pnpm run <x>` always runs the script x; only bare `pnpm install` is built in.
      const run = args[0] === "run";
      const rest = run ? args.slice(1) : args;
      const [script, ...scriptArgs] = rest;
      if (!script) return "pnpm command names no script";
      if (script.startsWith("-")) return `pnpm option not allowed: ${script}`;
      if (!run && BUILT_IN_PNPM.has(script)) {
        // `pnpm install <name>` adds a package, so every argument is from the list.
        const refused = scriptArgs.find((arg) => !INSTALL_FLAGS.has(arg));
        return refused ? `pnpm install argument not allowed: ${refused}` : null;
      }
      if (!context.scripts.has(script)) return `pnpm script not in package.json: ${script}`;
      const option = scriptArgs.find((arg) => arg.startsWith("-"));
      return option ? `pnpm option not allowed: ${option}` : null;
    }
    case "node": {
      // Arguments after the file belong to the script; node reads only those before it.
      const at = args.findIndex((arg) => !arg.startsWith("-"));
      const file = at < 0 ? undefined : args[at];
      if (!file) return "node command names no file";
      if (at > 0) return `node option not allowed: ${args[0]}`;
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
    case "kill": {
      // Exactly one signal, first, then process ids: `kill -9 -TERM <pid>` sends SIGKILL.
      const [signal, ...targets] = args;
      if (!signal || !STOP_SIGNALS.has(signal)) return "kill sends neither -TERM nor -INT";
      if (targets.length === 0) return "kill names no process";
      const extra = targets.find((arg) => arg.startsWith("-"));
      return extra ? `kill takes one signal and process ids only: ${extra}` : null;
    }
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
      if (step.refused) continue;

      const body = step.text.replace(/\*\*(Naredba|Nositelj):\*\*/g, "$1:");
      // A marker inside a code span was refused by the parser, so none is left.
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
