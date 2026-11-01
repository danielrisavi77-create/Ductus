// DAN-372: docs/DECISIONS.md is the index of decisions and docs/odluke/ holds
// one file per decision. The check keeps the two consistent; plan #1173 (C1-C8,
// A3) lists what it must catch. It checks IDs, links and files, never the status
// written in the index (orchestrator, #1173 issuecomment-6552184068).
//
//   node scripts/engineering/decisions-index.mjs                  check the tree
//   node scripts/engineering/decisions-index.mjs --verbatim SHA   also compare text with SHA
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { matchesPath } from "./protected-paths.mjs";

export const INDEX = "docs/DECISIONS.md";
export const DIR = "docs/odluke";
const README = "README.md";
const ID = "D-\\d{2,}";
// Up to three spaces of indentation are still a heading or a table row in
// CommonMark and GFM; four make a code block (QA, #1179).
const ROW_ID = new RegExp(`^ {0,3}\\| *(${ID}) *\\|`);
const HEADING_ID = new RegExp(`^ {0,3}#{1,6}[ \\t]+(${ID})(?![0-9])`);
// A CommonMark inline link: optional spaces, a destination that is <...> (spaces
// allowed) or a run without spaces with one level of balanced parentheses, an
// optional title ("t", 't' or (t)), optional spaces (review and QA, #1179).
const DEST = String.raw`<(?:[^<>\n\\]|\\.)*>|(?:[^\s()<\\]|\\.|\([^\s()]*\))(?:[^\s()\\]|\\.|\([^\s()]*\))*`;
const LINK_SOURCE = String.raw`\[([^\]]*)\]\(\s*(${DEST})?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)`;
const LINK = new RegExp(LINK_SOURCE, "g");
const ID_ONLY = new RegExp(`^${ID}$`);
// Backslash escapes and numeric character references, as GitHub renders them.
const unescape = (s) =>
  s
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&#(\d{1,7});|&#[xX]([0-9a-fA-F]{1,6});/g, (all, d, h) => {
      const n = d ? Number(d) : parseInt(h, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    })
    .replace(/&amp;/g, "&");
// The label as shown: escapes decoded, emphasis marks and outer spaces dropped.
const shownLabel = (s) => unescape(s).replace(/[*_~]/g, "").trim();
function decodeTarget(raw) {
  const t = unescape(raw.startsWith("<") ? raw.slice(1, -1) : raw);
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}
// An index entry is a table row whose first cell is only a link labelled with a
// decision ID; a link in the text of a decision is a reference, not an entry (#1179).
const FIRST_CELL = /^ {0,3}\|([^|]*)\|/;
const CELL_LINK = new RegExp(`^${LINK_SOURCE}$`);
// A link reference definition ("[x]: target"), also inside a quote or a list
// item, is refused: only inline links are checked (QA, #1179). A footnote is not one.
const REF_DEF = /^(?:\s*(?:>|[-*+]|\d{1,9}[.)]))*\s*\[(?!\^)[^\]]+\]:/;
const stripCode = (text) => text.replace(/`[^`\n]*`/g, "");

/** "D-05.md" for 5: two digits at least, no other leading zero. */
export const canonicalName = (id) => `D-${String(Number(id.slice(2))).padStart(2, "0")}.md`;

/** IDs a text defines: a table row or a heading that starts with a D-ID (`re` picks one kind). */
export function definedIds(text, re = [ROW_ID, HEADING_ID]) {
  const ids = [];
  for (const line of text.split("\n")) {
    const m = re.map((r) => r.exec(line)).find(Boolean);
    if (m) ids.push(m[1]);
  }
  return ids;
}

function formatErrors(name, text) {
  const errors = [];
  if (text.startsWith("﻿")) errors.push(`${name} starts with a BOM`);
  if (text.includes("\r")) errors.push(`${name} has a CR line ending`);
  if (text.length > 0 && !text.endsWith("\n")) errors.push(`${name} does not end with a newline`);
  return errors;
}

/** Link targets of a text outside inline code, with their link text; `relative` is false for a scheme or a pure anchor. */
function links(text) {
  const out = [];
  for (const m of stripCode(text).matchAll(LINK)) {
    const target = decodeTarget(m[2] ?? "");
    const relative = !(/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#"));
    out.push({ label: shownLabel(m[1]), target: relative ? target.split("#")[0] : target, relative });
  }
  return out;
}

// What the link pattern does not read is refused rather than skipped: a "](" left
// after the links are removed, or an HTML link (review and QA, #1179).
function unreadLinkErrors(name, text) {
  const errors = [];
  const rest = stripCode(text).replace(LINK, "");
  for (const line of rest.split("\n")) {
    if (line.includes("](")) errors.push(`${name}: link in ${JSON.stringify(line.trim())} is not understood`);
    if (/<a\s[^>]*href/i.test(line)) errors.push(`${name}: HTML link in ${JSON.stringify(line.trim())} is refused, use a Markdown link`);
  }
  return errors;
}

/** IDs of the index entries, once per entry row (labels as written). */
function entryIds(text) {
  const ids = [];
  for (const line of stripCode(text).split("\n")) {
    const m = CELL_LINK.exec(FIRST_CELL.exec(line)?.[1].trim() ?? "");
    if (m && ID_ONLY.test(shownLabel(m[1]))) ids.push(shownLabel(m[1]));
  }
  return ids;
}

const refErrors = (name, text) =>
  text.split("\n").filter((line) => REF_DEF.test(line)).map((line) => `${name}: reference link definition ${JSON.stringify(line)} is refused, use an inline link`);

/**
 * Errors of a tree. `tree` = { dir: "missing" | "symlink" | "dir", entries:
 * [{ name, kind: "file" | "symlink" | "other", text }], index: text, docs:
 * [{ path, text }] (every other tracked *.md), exists(repoPath) }.
 */
export function checkTree(tree) {
  const errors = [];
  if (tree.dir === "missing") return [`${DIR}/ is missing`];
  if (tree.dir === "symlink") return [`${DIR}/ is a symbolic link`];
  const files = new Map();
  for (const entry of tree.entries) {
    const where = `${DIR}/${entry.name}`;
    if (entry.kind !== "file") {
      errors.push(`${where} is not a plain file`);
      continue;
    }
    errors.push(...formatErrors(where, entry.text), ...refErrors(where, entry.text));
    if (entry.name === README) {
      const ids = definedIds(entry.text);
      if (ids.length > 0) errors.push(`${where} holds a decision record (${ids[0]})`);
      continue;
    }
    const m = /^(D-\d{2,})\.md$/.exec(entry.name);
    if (!m || canonicalName(m[1]) !== entry.name) {
      errors.push(`${where}: name is not D-NN.md (two digits at least, no extra leading zero)`);
      continue;
    }
    const id = m[1];
    files.set(entry.name, id);
    if (entry.text.split("\n")[0] !== `# ${id}`) errors.push(`${where}: first line is not "# ${id}"`);
    const other = [...new Set(definedIds(entry.text))].filter((x) => x !== id);
    if (other.length > 0) errors.push(`${where} defines ${other.join(", ")}, not only ${id}`);
  }

  const plain = new Set(tree.entries.filter((e) => e.kind === "file").map((e) => `${DIR}/${e.name}`));
  const has = (p) => plain.has(p) || (!p.startsWith(`${DIR}/`) && tree.exists(p));

  errors.push(...formatErrors(INDEX, tree.index), ...refErrors(INDEX, tree.index));
  // A section may open with a heading and repeat its ID in a table row (D-177),
  // so a duplicate is counted per kind.
  for (const [kind, re] of [["row", ROW_ID], ["heading", HEADING_ID]]) {
    const counts = new Map();
    for (const id of definedIds(tree.index, [re])) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) if (n > 1) errors.push(`${INDEX} has ${n} ${kind}s for ${id}`);
  }
  const indexRows = new Set(definedIds(tree.index));
  const linked = new Map();
  for (const id of entryIds(tree.index)) {
    linked.set(id, (linked.get(id) ?? 0) + 1);
    if (indexRows.has(id)) errors.push(`${id} is both full text in ${INDEX} and a file in ${DIR}/`);
  }
  // Every link labelled with a decision ID, entry or reference, must reach its
  // canonical file, so an external address or an anchor is checked too; the same
  // holds in the index and in every file of docs/odluke/ (QA, #1179).
  const linkErrors = (name, base, text) => {
    const out = unreadLinkErrors(name, text);
    for (const { label, target, relative } of links(text)) {
      const id = ID_ONLY.test(label) ? label : null;
      if (!relative && !id) continue;
      const resolved = relative ? path.posix.normalize(path.posix.join(base, target)) : target;
      const canonical = id && `${DIR}/${canonicalName(id)}`;
      if (id && resolved !== canonical) {
        out.push(`${name}: link ${id} points to ${target}, not ${path.posix.relative(base, canonical)}`);
      } else if (!has(resolved)) {
        out.push(`${name}: link ${target} points to a missing file`);
      }
    }
    return out;
  };
  errors.push(...linkErrors(INDEX, "docs", tree.index));
  for (const [name, id] of files) {
    const n = linked.get(id) ?? 0;
    if (n !== 1) errors.push(`${DIR}/${name} is linked ${n} times from ${INDEX}, not once`);
  }

  for (const entry of tree.entries) {
    if (entry.kind === "file") errors.push(...linkErrors(`${DIR}/${entry.name}`, DIR, entry.text));
  }

  // Only the index and docs/odluke/ as spelled here are checked above. Another
  // spelling (docs/Odluke/, docs/decisions.md) is distinct on Linux, so a file
  // there is refused whatever it holds (QA, #1179).
  for (const doc of tree.docs) {
    if (doc.path === INDEX || doc.path.startsWith(`${DIR}/`)) continue;
    if (matchesPath(doc.path, [INDEX, `${DIR}/`])) {
      errors.push(`${doc.path} is another spelling of ${INDEX} or ${DIR}/`);
      continue;
    }
    const ids = definedIds(doc.text);
    if (ids.length > 0) errors.push(`${doc.path} holds a decision record (${ids[0]}) outside ${INDEX} and ${DIR}/`);
  }
  return errors;
}

// Lines the move adds that are not decision text: blank lines, a file heading,
// a table header or separator, and an index row whose first cell is the link
// to that decision's file (a link elsewhere in a line keeps the line compared).
const INDEX_ROW = /^\| *\[(D-\d{2,})\]\((?:\.\/)?odluke\/\1\.md\) *\|/;
const SCAFFOLD = [/^$/, new RegExp(`^# ${ID}$`), /^\| *(?:Broj|ID) *\|/, /^\|(?: *:?-{3,}:? *\|)+$/, INDEX_ROW];
const isScaffold = (line) => SCAFFOLD.some((re) => re.test(line));

const canonicalId = (id) => canonicalName(id).slice(0, -3);
const HEADING = /^ {0,3}(#{1,6})[ \t]/;

/**
 * [owner, line] for each line. A decision file belongs to its ID. In the index
 * a row belongs to its ID and any other line to the nearest heading with an ID
 * above it, down to the next heading that has an ID or is not deeper; "" is
 * outside every decision (review and QA, #1179).
 */
function ownedLines(text, fileId) {
  const out = [];
  let section = null;
  for (const line of text.split("\n")) {
    const h = fileId ? null : HEADING.exec(line);
    if (h) {
      const m = HEADING_ID.exec(line);
      if (m) section = { id: canonicalId(m[1]), level: h[1].length };
      else if (!section || h[1].length <= section.level) section = null;
    }
    const row = fileId ? null : ROW_ID.exec(line);
    out.push([fileId ? canonicalId(fileId) : row ? canonicalId(row[1]) : (section?.id ?? ""), line]);
  }
  return out;
}

function lineCounts(texts) {
  const counts = new Map();
  for (const { id, text } of texts) {
    for (const [owner, line] of ownedLines(text, id)) {
      if (isScaffold(line)) continue;
      const key = JSON.stringify([owner, line]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

const describe = (key) => {
  const [owner, line] = JSON.parse(key);
  return `${owner || "outside a decision"}: ${JSON.stringify(line)}`;
};

/**
 * B1, B2: every non-scaffold line of the base is in the head exactly as often,
 * byte for byte and in the same decision, and no new one. A text is { id, text }:
 * id is the decision of a file in docs/odluke/, null for the index.
 */
export function checkVerbatim(baseTexts, headTexts) {
  const base = lineCounts(baseTexts);
  const head = lineCounts(headTexts);
  const errors = [];
  for (const [key, n] of base) {
    const m = head.get(key) ?? 0;
    if (m !== n) errors.push(`line occurs ${n} times in the base and ${m} in the head, ${describe(key)}`);
  }
  for (const [key, m] of head) if (!base.has(key)) errors.push(`new line in the head (${m}), ${describe(key)}`);
  return errors;
}

function kindOf(p) {
  const st = lstatSync(p);
  return st.isSymbolicLink() ? "symlink" : st.isFile() ? "file" : "other";
}

const git = (args) => execFileSync("git", args, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");

export function readTree(root = ".") {
  const at = (p) => path.join(root, p);
  let dir = "missing";
  try {
    dir = kindOf(at(DIR)) === "symlink" ? "symlink" : "dir";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const entries =
    dir === "dir"
      ? readdirSync(at(DIR))
          .sort()
          .map((name) => {
            const kind = kindOf(at(`${DIR}/${name}`));
            return { name, kind, text: kind === "file" ? readFileSync(at(`${DIR}/${name}`), "utf8") : "" };
          })
      : [];
  const tracked = git(["-C", root, "ls-files", "-z", "--", "*.md"]).split("\0").filter(Boolean);
  const docs = tracked.filter((p) => existsSync(at(p))).map((p) => ({ path: p, text: readFileSync(at(p), "utf8") }));
  return { dir, entries, index: readFileSync(at(INDEX), "utf8"), docs, exists: (p) => existsSync(at(p)) };
}

/** Index and decision files of a commit, read from git objects. */
function readBaseTexts(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`--verbatim needs a full commit SHA, got "${sha}"`);
  const names = git(["ls-tree", "-z", "--name-only", `${sha}^{commit}`, `${DIR}/`]).split("\0").filter(Boolean);
  const files = names.filter((n) => !n.endsWith(`/${README}`)).map((p) => ({ id: path.posix.basename(p, ".md"), text: git(["show", `${sha}:${p}`]) }));
  return [{ id: null, text: git(["show", `${sha}:${INDEX}`]) }, ...files];
}

function main(argv) {
  if (!(argv.length === 0 || (argv[0] === "--verbatim" && argv.length === 2))) {
    throw new Error("usage: decisions-index.mjs [--verbatim <sha>]");
  }
  const tree = readTree();
  const errors = checkTree(tree);
  if (argv[0] === "--verbatim") {
    const files = tree.entries.filter((e) => e.kind === "file" && e.name !== README);
    const head = [{ id: null, text: tree.index }, ...files.map((e) => ({ id: e.name.slice(0, -3), text: e.text }))];
    errors.push(...checkVerbatim(readBaseTexts(argv[1]), head));
  }
  for (const error of errors) console.error(error);
  if (errors.length > 0) return 1;
  const moved = tree.entries.filter((e) => e.name !== README).length;
  console.log(`${INDEX}: ${moved} decisions moved to ${DIR}/${argv[0] === "--verbatim" ? `; text matches ${argv[1].slice(0, 12)}` : ""}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
