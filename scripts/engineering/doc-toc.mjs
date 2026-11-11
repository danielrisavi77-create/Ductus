#!/usr/bin/env node
// Table of contents with line ranges for the long rule documents (DAN-695, #1880 step 6), so a
// session can read one section with Read offset/limit instead of the whole file.
//   node scripts/engineering/doc-toc.mjs --check   exit 1 when a table is stale
//   node scripts/engineering/doc-toc.mjs --write   rewrite the stale tables
// ATX headings and fenced blocks follow CommonMark: up to three spaces of indent, closing #s are
// not part of the title, and a fence closes only with the same character, at least as long.
// Setext headings and HTML blocks are not recognised; the documents use neither.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DOCS = ["docs/ORKESTRATOR.md", "docs/SESSIONS.md"];
const START = "<!-- toc:start -->";
const END = "<!-- toc:end -->";
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const NUMBER = /^(\d+[a-z]?(?:\.\d+[a-z]?)*)\.?[ \t]+/;

/** Lines without their end-of-line characters; a final newline does not start another line. */
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** For each line, whether it is inside a fenced code block (fence lines included). */
function fenced(lines) {
  let open = null;
  return lines.map((line) => {
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open[0] && m[1].length >= open.length && m[2].trim() === "") open = null;
      return true;
    }
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = m[1];
      return true;
    }
    return false;
  });
}

function heading(line) {
  const m = HEADING.exec(line);
  if (!m) return null;
  const title = (m[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "").trim();
  return { level: m[1].length, title };
}

function label(title) {
  const m = NUMBER.exec(title);
  return m ? `§${m[1]} ${title.slice(m[0].length)}` : title;
}

/** Level 2 and 3 headings outside fenced blocks, each with its 1-based line range. */
export function docSections(text) {
  const lines = splitLines(text);
  const inFence = fenced(lines);
  const headings = [];
  lines.forEach((line, i) => {
    const h = !inFence[i] && heading(line);
    if (h) headings.push({ ...h, start: i + 1 });
  });
  return headings
    .map((h, i) => {
      const next = headings.slice(i + 1).find((o) => o.level <= h.level);
      return { level: h.level, label: label(h.title), start: h.start, end: next ? next.start - 1 : lines.length };
    })
    .filter((s) => s.level === 2 || s.level === 3);
}

// Literal patterns for START and END (semgrep flags RegExp built from a variable).
const IS_START = /^ {0,3}<!-- toc:start -->[ \t]*$/;
const IS_END = /^ {0,3}<!-- toc:end -->[ \t]*$/;

function markers(lines) {
  const inFence = fenced(lines);
  const find = (re) => lines.flatMap((line, i) => (!inFence[i] && re.test(line) ? [i] : []));
  const starts = find(IS_START);
  const ends = find(IS_END);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error(`toc markers: expected one ${START} before one ${END}`);
  }
  return [starts[0], ends[0]];
}

const entry = (s) => `${s.level === 3 ? "  " : ""}- ${s.label}: retci ${s.start}-${s.end}`;

/**
 * The text with its table of contents current; throws on unpaired, duplicate or reversed markers.
 * Lines outside the block keep their own line endings; new lines use CRLF when the text has any.
 */
export function applyToc(text) {
  const raw = text.split("\n");
  if (text.endsWith("\n")) raw.pop();
  if (text === "") raw.pop();
  const range = markers(splitLines(text));
  const cr = text.includes("\r\n") ? "\r" : "";
  let before;
  let after;
  if (range) {
    before = raw.slice(0, range[0]);
    after = raw.slice(range[1] + 1);
  } else {
    const first = docSections(text)[0];
    if (!first) return text;
    before = raw.slice(0, first.start - 1);
    after = [cr, ...raw.slice(first.start - 1)];
  }
  // A final newline keeps a last empty line a line when the pieces are joined.
  const final = text.endsWith("\n") ? "\n" : "";
  const join = (lines) => lines.join("\n") + final;
  const count = docSections(join([...before, ...after])).length;
  const placeholder = [START, ...Array(count).fill("-"), END];
  const sections = docSections(join([...before, ...placeholder, ...after]));
  const block = [START, ...sections.map(entry), END].map((line, i, all) =>
    i === all.length - 1 && !after.length && !final ? line : line + cr,
  );
  return join([...before, ...block, ...after]);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** CLI: 0 when every table is current (or was written), 1 when one is stale or has bad markers. */
export function main(argv, root = ROOT, log = console) {
  const mode = argv[0];
  if (argv.length !== 1 || (mode !== "--check" && mode !== "--write")) {
    log.error("usage: node scripts/engineering/doc-toc.mjs --check|--write");
    return 2;
  }
  let failed = 0;
  for (const rel of DOCS) {
    const file = path.join(root, rel);
    const text = readFileSync(file, "utf8");
    let next;
    try {
      next = applyToc(text);
    } catch (error) {
      failed++;
      log.error(`${rel}: ${error.message}`);
      continue;
    }
    if (next === text) continue;
    if (mode === "--write") {
      writeFileSync(file, next);
      log.log(`${rel}: table of contents updated`);
    } else {
      failed++;
      log.error(`${rel}: table of contents is stale; run node scripts/engineering/doc-toc.mjs --write`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
