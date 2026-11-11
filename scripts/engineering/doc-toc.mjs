#!/usr/bin/env node
// Table of contents with line ranges for the long rule documents (DAN-695, #1880 step 6), so a
// session can read one section with Read offset/limit instead of the whole file.
//   node scripts/engineering/doc-toc.mjs --check   exit 1 when a table is stale
//   node scripts/engineering/doc-toc.mjs --write   rewrite the stale tables
// ATX headings, fenced blocks and list items follow CommonMark: up to three spaces of indent,
// closing #s are not part of the title, a fence closes only with the same character, at least as
// long, and a heading or fence inside a list item stays in the item. Setext headings, block quotes
// and HTML blocks are not recognised; the documents use none of them. A CR outside CRLF (a line
// ending in CommonMark) is an error, so line numbers never disagree with the reader.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DOCS = ["docs/ORKESTRATOR.md", "docs/SESSIONS.md"];
const START = "<!-- toc:start -->";
const END = "<!-- toc:end -->";
// Only the opening hashes are matched by a regex; the title is trimmed by hand, so a long run of
// spaces stays linear. U+2028 and U+2029 are not line endings in CommonMark, so they belong to the
// title or to the info string (the s flag on FENCE); only spaces and tabs are trimmed around them.
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
const NUMBER = /^(\d+[a-z]?(?:\.\d+[a-z]?)*)\.[ \t]+/;
// The patterns below match a line after its indentation.
const FENCE = /^(`{3,}|~{3,})(.*)$/s;
const LIST = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const BREAK = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX = /^#{1,6}(?=[ \t]|$)/;
const SETEXT = /^(?:=+|-+)[ \t]*$/;

/** Lines without their end-of-line characters; a final newline does not start another line. */
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

const blank = (c) => c === " " || c === "\t";

/** Skips spaces and tabs from index i at column col; a tab advances to the next multiple of 4. */
function indent(line, i = 0, col = 0) {
  while (i < line.length && blank(line[i])) {
    col = line[i] === "\t" ? col + 4 - (col % 4) : col + 1;
    i++;
  }
  return { i, col };
}

/** The fence a line opens, or null; a backtick fence cannot have a backtick in its info string. */
function opening(rest) {
  const m = FENCE.exec(rest);
  return m && !(m[1][0] === "`" && m[2].includes("`")) ? m[1] : null;
}

// Where a line belongs: top level, inside a list item, or inside a fenced code block.
const TOP = 0;
const ITEM = 1;
const CODE = 2;

/**
 * For each line, TOP, ITEM or CODE (fence lines included). List items are followed as in
 * CommonMark: an item's content starts after the marker and one to four spaces, a line indented
 * less ends the item (and a fence opened in it) unless it continues a paragraph lazily, and a fence
 * closes only with the same character, at least as long, followed by spaces and tabs only.
 */
function blocks(lines) {
  const items = []; // content columns of the open list items, innermost last
  let open = null; // the open fence: its run of backticks or tildes and the column it belongs to
  let para = false; // whether the last line continues a paragraph
  const top = () => (items.length ? items[items.length - 1].col : 0);
  return lines.map((line) => {
    let { i, col } = indent(line);
    if (i === line.length) {
      para = false;
      if (open) return CODE;
      if (items.length && items[items.length - 1].empty) items.pop(); // an item starts with at most one blank line
      return items.length ? ITEM : TOP;
    }
    if (open && col >= open.base) {
      const m = col - open.base <= 3 && FENCE.exec(line.slice(i));
      if (
        m &&
        m[1][0] === open.mark[0] &&
        m[1].length >= open.mark.length &&
        /^[ \t]*$/.test(m[2])
      )
        open = null;
      return CODE;
    }
    open = null;
    let depth = items.length;
    while (depth && col < items[depth - 1].col) depth--;
    const base = depth ? items[depth - 1].col : 0;
    const rest = line.slice(i);
    // A lazy line continues the paragraph of an item it is not indented into.
    if (para && depth < items.length && (col - base > 3 || !starts(rest)))
      return ITEM;
    // The paragraph goes on in this line's container only when no item was left.
    let interrupting = para && depth === items.length;
    items.length = depth;
    if (depth) items[depth - 1].empty = false;
    for (;;) {
      const at = items.length ? ITEM : TOP;
      if (col - top() > 3) {
        para = interrupting; // a paragraph continued, otherwise indented code
        return at;
      }
      const text = line.slice(i);
      // A setext underline ends the paragraph; it is not counted as a heading.
      if (BREAK.test(text) || (interrupting && SETEXT.test(text))) {
        para = false;
        return at;
      }
      const mark = opening(text);
      if (mark) {
        open = { mark, base: top() };
        para = false;
        return CODE;
      }
      const m = LIST.exec(text);
      const after = m && indent(line, i + m[0].length, col + m[0].length);
      const empty = m && after.i === line.length;
      // A list item interrupts a paragraph only when it is not empty and, if ordered, starts at 1.
      if (
        m &&
        !(
          interrupting &&
          (empty || (/\d/.test(m[0]) && Number(m[0].slice(0, -1)) !== 1))
        )
      ) {
        const marker = col + m[0].length;
        const content =
          empty || after.col - marker > 4 ? marker + 1 : after.col;
        items.push({ col: content, empty });
        if (empty) {
          para = false;
          return ITEM;
        }
        // Content indented five or more is indented code in the item.
        ({ i, col } = after);
        interrupting = false;
        continue;
      }
      para = !ATX.test(text) && !text.startsWith("<!--");
      return at;
    }
  });
}

/** Whether a line (after its indentation) starts a block that can interrupt a paragraph. */
function starts(rest) {
  return (
    ATX.test(rest) ||
    BREAK.test(rest) ||
    Boolean(opening(rest)) ||
    LIST.test(rest) ||
    /^(?:>|<!--)/.test(rest)
  );
}

/** The text without leading and trailing spaces and tabs. */
function trimBlank(text) {
  let from = 0;
  let to = text.length;
  while (from < to && blank(text[from])) from++;
  while (to > from && blank(text[to - 1])) to--;
  return text.slice(from, to);
}

function heading(line) {
  const m = HEADING.exec(line);
  if (!m) return null;
  let title = trimBlank(line.slice(m[0].length));
  // A closing run of #s is not part of the title when it stands alone or after a space or tab.
  let hashes = title.length;
  while (hashes > 0 && title[hashes - 1] === "#") hashes--;
  if (hashes < title.length && (hashes === 0 || blank(title[hashes - 1])))
    title = trimBlank(title.slice(0, hashes));
  return { level: m[1].length, title };
}

function label(title) {
  const m = NUMBER.exec(title);
  return m ? `§${m[1]} ${title.slice(m[0].length)}` : title;
}

/** Level 2 and 3 headings at top level (outside list items and fenced blocks), with 1-based line ranges. */
export function docSections(text) {
  const lines = splitLines(text);
  const where = blocks(lines);
  const sections = [];
  const stack = []; // sections still open, by rising level
  lines.forEach((line, i) => {
    const h = where[i] === TOP && heading(line);
    if (!h) return;
    // A heading closes the open sections of the same or a deeper level.
    while (stack.length && stack[stack.length - 1].level >= h.level)
      stack.pop().end = i;
    const section = {
      level: h.level,
      label: label(h.title),
      start: i + 1,
      end: lines.length,
    };
    sections.push(section);
    stack.push(section);
  });
  return sections.filter((s) => s.level === 2 || s.level === 3);
}

// Literal patterns for START and END (semgrep flags RegExp built from a variable).
const IS_START = /^ {0,3}<!-- toc:start -->[ \t]*$/;
const IS_END = /^ {0,3}<!-- toc:end -->[ \t]*$/;

function markers(lines) {
  const where = blocks(lines);
  const find = (re) =>
    lines.flatMap((line, i) => (where[i] !== CODE && re.test(line) ? [i] : []));
  const starts = find(IS_START);
  const ends = find(IS_END);
  if (!starts.length && !ends.length) return null;
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    throw new Error(`toc markers: expected one ${START} before one ${END}`);
  }
  return [starts[0], ends[0]];
}

const entry = (s) =>
  `${s.level === 3 ? "  " : ""}- ${s.label}: retci ${s.start}-${s.end}`;

/**
 * The text with its table of contents current; throws on unpaired, duplicate or reversed markers
 * and on a CR outside CRLF.
 * Lines outside the block keep their own line endings; new lines use CRLF when the text has any.
 */
export function applyToc(text) {
  if (/\r(?!\n)/.test(text))
    throw new Error("toc: a CR outside CRLF is not supported");
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

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

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
    let text;
    let next;
    try {
      text = readFileSync(file, "utf8");
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
      log.error(
        `${rel}: table of contents is stale; run node scripts/engineering/doc-toc.mjs --write`,
      );
    }
  }
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
