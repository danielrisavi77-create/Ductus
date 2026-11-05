// F-015 (DAN-144), part B: the orchestrator lists `IZVJEŠTAJ` issues only from
// the owner's account, under which every session opens them. Anyone can open an
// issue on the public repo, so a listing without the author filter would take
// an outsider's text as a worker report.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "danielrisavi77-create";
const ROOTS = ["docs", ".claude/skills", ".agents/skills", ".claude/uloge", ".claude/rules"];

function markdownFiles(dir) {
  const full = path.join(repo, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return markdownFiles(rel);
    return entry.name.endsWith(".md") ? [rel] : [];
  });
}

/** Every `gh issue list` command in the text that searches IZVJEŠTAJ titles. */
function reportListings(text) {
  return [...text.matchAll(/`(gh issue list[^`]*)`/g)].map((m) => m[1]).filter((cmd) => /IZVJE[ŠS]TAJ/i.test(cmd));
}

const hasOwnerFilter = (cmd) => new RegExp(`--author[ =]${OWNER}(?:\\s|$)`).test(cmd);

test("every IZVJEŠTAJ issue listing in the rules filters on the owner's account", () => {
  const found = [];
  for (const file of ROOTS.flatMap(markdownFiles)) {
    for (const cmd of reportListings(fs.readFileSync(path.join(repo, file), "utf8"))) found.push({ file, cmd });
  }
  const files = new Set(found.map((f) => f.file));
  for (const known of ["docs/ORKESTRATOR.md", "docs/SESSIONS.md"]) {
    assert.ok(files.has(known), `no IZVJEŠTAJ listing found in ${known}`);
  }
  assert.deepEqual(found.filter((f) => !hasOwnerFilter(f.cmd)), [], "IZVJEŠTAJ listing without the owner author filter");
});

test("a listing without the author filter, or with another author, is caught", () => {
  for (const cmd of [
    'gh issue list --search "IZVJEŠTAJ in:title" --state open',
    'gh issue list --search "IZVJEŠTAJ in:title" --author someone-else',
    `gh issue list --search "IZVJEŠTAJ in:title" --author ${OWNER}-x`,
  ]) {
    assert.deepEqual(reportListings(`\`${cmd}\``), [cmd]);
    assert.equal(hasOwnerFilter(cmd), false, cmd);
  }
  assert.equal(hasOwnerFilter(`gh issue list --search "IZVJEŠTAJ in:title" --author ${OWNER} --state open`), true);
  assert.deepEqual(reportListings("`gh issue list --label bug`"), []);
});
