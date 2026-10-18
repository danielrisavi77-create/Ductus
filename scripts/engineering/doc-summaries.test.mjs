// Guards the section summaries of the rule documents (DAN-213, #424): every `§x`
// a summary cites must exist as a numbered heading in the document it points at,
// so a renumbered or removed section fails CI instead of leaving a stale summary.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUMMARIES = [
  { summary: "docs/ENGINEERING_SYSTEM-SAZETAK.md", full: "docs/ENGINEERING_SYSTEM.md" },
  { summary: "docs/ORKESTRATOR-SAZETAK.md", full: "docs/ORKESTRATOR.md" },
];
const MAX_CHARS = 4000;

const read = (rel) => readFileSync(path.join(root, rel), "utf8").replace(/^﻿/, "");

/** Section ids from numbered headings: "## 5. Risk razine" -> "5", "### 4a. Kako ..." -> "4a". */
export function headingIds(markdown) {
  const ids = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(\d+[a-z]?)\.\s/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * Every `§x` in `text`, with the document it refers to: a file name written right
 * before the sign (`PRODUCT.md` §5, PLAN-DEMO.md §4) or `fallback` when none is.
 */
export function sectionRefs(text, fallback) {
  const refs = [];
  const re = /(?:`?([\w./-]+\.md)`?\s*)?§\s?(\d+[a-z]?)/g;
  for (const m of text.matchAll(re)) refs.push({ doc: m[1] ?? fallback, id: m[2] });
  return refs;
}

function resolveDoc(name) {
  for (const rel of [name, path.posix.join("docs", name)]) {
    if (existsSync(path.join(root, rel))) return rel;
  }
  return null;
}

/** Problems with one summary; empty when it is consistent with the documents it cites. */
export function checkSummary(text, full, loadDoc) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim() && !l.startsWith("#")) ?? "";
  if (!first.includes("nije izvor pravila") || !first.includes(full)) {
    problems.push(`first paragraph must say the summary is not a source of rules and name ${full}`);
  }
  if (text.length > MAX_CHARS) problems.push(`summary has ${text.length} characters, limit ${MAX_CHARS}`);
  for (const line of lines) {
    if (/^\s*-\s/.test(line) && !line.includes("§")) problems.push(`item without §: ${line.trim()}`);
  }
  const refs = sectionRefs(text, full);
  if (!refs.some((r) => r.doc === full)) problems.push(`no § reference to ${full}`);
  const cache = new Map();
  for (const { doc, id } of refs) {
    if (!cache.has(doc)) cache.set(doc, loadDoc(doc));
    const ids = cache.get(doc);
    if (!ids) problems.push(`§${id} refers to ${doc}, which does not exist`);
    else if (!ids.has(id)) problems.push(`§${id} is not a heading in ${doc}`);
  }
  return problems;
}

const loadRepoDoc = (name) => {
  const rel = resolveDoc(name);
  return rel ? headingIds(read(rel)) : null;
};

for (const { summary, full } of SUMMARIES) {
  test(`${summary} cites only sections that exist`, () => {
    assert.deepEqual(checkSummary(read(summary), full, loadRepoDoc), []);
  });
}

test("the check is wired to CI's engineering test glob", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /node --test scripts\/engineering\/\*\.test\.mjs/);
});

test("a missing section, a missing document and an item without § are reported", () => {
  const full = "docs/X.md";
  const docs = { "docs/X.md": new Set(["1", "4a"]), "Y.md": new Set(["2"]) };
  const load = (d) => docs[d] ?? null;
  const ok = "# S\n\nSažetak nije izvor pravila; vrijedi docs/X.md.\n\n- a (§1)\n- b (§4a, `Y.md` §2)\n";
  assert.deepEqual(checkSummary(ok, full, load), []);
  const bad = checkSummary(`${ok}- c (§9)\n- d (\`Z.md\` §1)\n- e bez oznake\n`, full, load);
  assert.deepEqual(bad, [
    "item without §: - e bez oznake",
    "§9 is not a heading in docs/X.md",
    "§1 refers to Z.md, which does not exist",
  ]);
  assert.match(checkSummary("# S\n\nNešto drugo.\n\n- a (§1)\n", full, load)[0], /not a source of rules/);
  assert.match(checkSummary(`${ok}${"x".repeat(MAX_CHARS)}`, full, load).join(), /limit 4000/);
});

test("headings are read only when numbered", () => {
  const ids = headingIds("# 1. Naslov\n## 5. Risk\n### 4a. Daniel\n### low\n## Bez broja\ntekst 7. nije\n");
  assert.deepEqual([...ids].sort(), ["1", "4a", "5"]);
});
