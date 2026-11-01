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
const ROW_ID = new RegExp(`^\\| *(${ID}) *\\|`);
const HEADING_ID = new RegExp(`^#{1,6} +(${ID})(?![0-9])`);
// Destination, then an optional CommonMark title ("t", 't' or (t)).
const LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const ID_ONLY = new RegExp(`^${ID}$`);

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

/** Relative link targets of a text outside inline code (no scheme, no pure anchor), with their link text. */
function relativeLinks(text) {
  const out = [];
  for (const m of text.replace(/`[^`\n]*`/g, "").matchAll(LINK)) {
    const target = m[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    out.push({ label: m[1], target: target.split("#")[0] });
  }
  return out;
}

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
    errors.push(...formatErrors(where, entry.text));
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

  errors.push(...formatErrors(INDEX, tree.index));
  // A section may open with a heading and repeat its ID in a table row (D-177),
  // so a duplicate is counted per kind.
  for (const [kind, re] of [["row", ROW_ID], ["heading", HEADING_ID]]) {
    const counts = new Map();
    for (const id of definedIds(tree.index, [re])) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, n] of counts) if (n > 1) errors.push(`${INDEX} has ${n} ${kind}s for ${id}`);
  }
  const indexRows = new Set(definedIds(tree.index));
  const linked = new Map();
  for (const { label, target } of relativeLinks(tree.index)) {
    const resolved = path.posix.normalize(path.posix.join("docs", target));
    if (ID_ONLY.test(label)) {
      if (resolved !== `${DIR}/${canonicalName(label)}`) {
        errors.push(`${INDEX}: link ${label} points to ${target}, not odluke/${canonicalName(label)}`);
        continue;
      }
      linked.set(label, (linked.get(label) ?? 0) + 1);
      if (indexRows.has(label)) errors.push(`${label} is both full text in ${INDEX} and a file in ${DIR}/`);
    }
    if (!has(resolved)) {
      errors.push(`${INDEX}: link ${target} points to a missing file`);
    }
  }
  for (const [name, id] of files) {
    const n = linked.get(id) ?? 0;
    if (n !== 1) errors.push(`${DIR}/${name} is linked ${n} times from ${INDEX}, not once`);
  }

  for (const entry of tree.entries) {
    if (entry.kind !== "file") continue;
    for (const { target } of relativeLinks(entry.text)) {
      const resolved = path.posix.normalize(path.posix.join(DIR, target));
      if (!has(resolved)) {
        errors.push(`${DIR}/${entry.name}: link ${target} points to a missing file`);
      }
    }
  }

  for (const doc of tree.docs) {
    if (matchesPath(doc.path, [INDEX, `${DIR}/`])) continue;
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

function lineCounts(texts) {
  const counts = new Map();
  for (const text of texts) {
    for (const line of text.split("\n")) if (!isScaffold(line)) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** B1, B2: every non-scaffold line of the base is in the head exactly as often, byte for byte, and no new one. */
export function checkVerbatim(baseTexts, headTexts) {
  const base = lineCounts(baseTexts);
  const head = lineCounts(headTexts);
  const errors = [];
  for (const [line, n] of base) {
    const m = head.get(line) ?? 0;
    if (m !== n) errors.push(`line occurs ${n} times in the base and ${m} in the head: ${JSON.stringify(line)}`);
  }
  for (const [line, m] of head) if (!base.has(line)) errors.push(`new line in the head (${m}): ${JSON.stringify(line)}`);
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
  return [INDEX, ...names.filter((n) => !n.endsWith(`/${README}`))].map((p) => git(["show", `${sha}:${p}`]));
}

function main(argv) {
  if (!(argv.length === 0 || (argv[0] === "--verbatim" && argv.length === 2))) {
    throw new Error("usage: decisions-index.mjs [--verbatim <sha>]");
  }
  const tree = readTree();
  const errors = checkTree(tree);
  if (argv[0] === "--verbatim") {
    const head = [tree.index, ...tree.entries.filter((e) => e.kind === "file" && e.name !== README).map((e) => e.text)];
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
