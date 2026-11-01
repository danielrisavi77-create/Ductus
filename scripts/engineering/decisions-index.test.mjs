// DAN-372, plan #1173 C1-C8, A3, B1, B2: the decisions index check. Every tree
// below is invented; the last tests run the check on this repository, so CI
// fails on every PR whose index and docs/odluke/ disagree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalName, checkTree, checkVerbatim, readTree } from "./decisions-index.mjs";

const ROW = "| D-05 | Izmišljena odluka za test. | Izmišljen razlog. |";
const HEADER = "| Broj | Odluka | Razlog |\n| --- | --- | --- |\n";
const file = (name, text) => ({ name, kind: "file", text });
const decision = (id, row = `| ${id} | Izmišljena odluka. | Razlog. |`) => file(`${id}.md`, `# ${id}\n\n${HEADER}${row}\n`);
const INDEX = `# Registar\n\n## Odlučeno\n\n${HEADER}| [D-05](odluke/D-05.md) | Naslov | 1. 1. 2026. | ODLUČENO |\n| D-06 | Puni tekst. | Razlog. |\n`;
const tree = (over = {}) => ({
  dir: "dir",
  entries: [file("README.md", "# Odluke\n"), decision("D-05")],
  index: INDEX,
  docs: [{ path: "docs/PLAN-DEMO.md", text: "| D-1 | zadatak demoa |\n" }],
  exists: () => false,
  ...over,
});
const fails = (t, pattern) => {
  const errors = checkTree(t);
  assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern}, got ${JSON.stringify(errors)}`);
};

test("a consistent tree passes, a single-digit task row elsewhere is not a decision", () => {
  assert.deepEqual(checkTree(tree()), []);
  assert.deepEqual(checkTree(tree({ entries: [file("README.md", "x\n")], index: "| D-06 | a | b |\n" })), []);
});

test("C7, C8: missing directory, symlinked directory or file, subdirectory", () => {
  assert.deepEqual(checkTree(tree({ dir: "missing" })), ["docs/odluke/ is missing"]);
  assert.deepEqual(checkTree(tree({ dir: "symlink" })), ["docs/odluke/ is a symbolic link"]);
  fails(tree({ entries: [{ name: "D-05.md", kind: "symlink", text: "" }] }), /D-05\.md is not a plain file/);
  fails(tree({ entries: [decision("D-05"), { name: "sub", kind: "other", text: "" }] }), /sub is not a plain file/);
});

test("C2: one canonical name per ID; every other form fails", () => {
  assert.equal(canonicalName("D-5"), "D-05.md");
  assert.equal(canonicalName("D-097"), "D-97.md");
  assert.equal(canonicalName("D-197"), "D-197.md");
  for (const name of ["D-5.md", "D-097.md", "D-005.md", "d-05.md", "D-05.md.orig", "D-05 .md", "D‑05.md", "D-0٥.md", "D-05.MD", "x.json"]) {
    fails(tree({ entries: [decision("D-05"), file(name, "# D-05\n")] }), new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: name is not`));
  }
});

test("C1: wrong heading, a file holding another decision, index and files disagree", () => {
  fails(tree({ entries: [file("D-05.md", `# D-5\n\n${ROW}\n`)] }), /first line is not "# D-05"/);
  fails(tree({ entries: [file("D-05.md", `# D-05\n\n| D-79 | tuđa | odluka |\n`)] }), /D-05\.md defines D-79/);
  fails(tree({ entries: [file("D-05.md", `# D-05\n\n## D-79: tuđa\n`)] }), /D-05\.md defines D-79/);
  fails(tree({ entries: [decision("D-05"), decision("D-07")] }), /D-07\.md is linked 0 times/);
  fails(tree({ entries: [] }), /link odluke\/D-05\.md points to a missing file/);
  fails(tree({ index: `${INDEX}| [D-05](odluke/D-05.md) | opet |\n` }), /D-05\.md is linked 2 times/);
  fails(tree({ index: `${INDEX}| D-06 | opet | isto |\n` }), /2 rows for D-06/);
  fails(tree({ index: `${INDEX}## D-06: a\n## D-06: b\n` }), /2 headings for D-06/);
  fails(tree({ index: `${INDEX}| D-05 | puni tekst | i datoteka |\n` }), /D-05 is both full text/);
  // A section heading may repeat the ID of its own row (D-177).
  assert.deepEqual(checkTree(tree({ index: `${INDEX}## D-06: odjeljak\n` })), []);
});

test("A3: a decision link must point into docs/odluke/ under its canonical name", () => {
  for (const target of ["D-05.md", "privacy/D-05.md", "odluke/D-5.md", "Odluke/D-05.md", "../odluke/D-05.md"]) {
    fails(tree({ index: INDEX.replace("(odluke/D-05.md)", `(${target})`) }), /link D-05 points to/);
  }
  assert.deepEqual(checkTree(tree({ index: INDEX.replace("(odluke/D-05.md)", "(./odluke/D-05.md)") })), []);
});

test("A3: a decision record outside the index and docs/odluke/ fails", () => {
  for (const [p, text] of [
    ["docs/D-200.md", "| D-200 | nova odluka | razlog |\n"],
    ["docs/odluke.md", "## D-200: nova odluka\n"],
    ["docs/privacy/x.md", "|D-200| zbijeno |\n"],
    ["docs/odluke2/x.md", "### D-200 bez dvotočke\n"],
  ]) {
    fails(tree({ docs: [{ path: p, text }] }), new RegExp(`${p.replace(".", "\\.")} holds a decision record \\(D-200\\)`));
  }
  // Spelling of the exempt places follows matchesPath.
  assert.deepEqual(checkTree(tree({ docs: [{ path: "DOCS/ODLUKE/X.md", text: "| D-200 | a |\n" }] })), []);
});

test("C5: relative links resolve; https, anchors and inline code are not followed", () => {
  fails(tree({ entries: [decision("D-05", `${ROW} Vidi [plan](../nema.md).`)] }), /D-05\.md: link \.\.\/nema\.md points to a missing file/);
  fails(tree({ index: `${INDEX}Vidi [x](engineering/nema.md).\n` }), /link engineering\/nema\.md points to a missing file/);
  const ok = `${ROW} [a](https://example.invalid/x) [b](#odlučeno) \`[c](odluke/D-NN.md)\` [d](../PRODUCT.md#5)`;
  assert.deepEqual(checkTree(tree({ entries: [decision("D-05", ok)], exists: (p) => p === "docs/PRODUCT.md" })), []);
  // A file in docs/odluke/ resolves only to a plain file listed there, never through the checkout.
  fails(tree({ index: `${INDEX}[r](odluke/sub/x.md)\n`, exists: () => true }), /odluke\/sub\/x\.md points to a missing file/);
});

test("file format: BOM, CR and a missing final newline fail, in files and in the index", () => {
  fails(tree({ entries: [file("D-05.md", `﻿# D-05\n${ROW}\n`)] }), /D-05\.md starts with a BOM/);
  fails(tree({ entries: [file("D-05.md", `# D-05\r\n${ROW}\r\n`)] }), /D-05\.md has a CR/);
  fails(tree({ entries: [file("D-05.md", `# D-05\n${ROW}`)] }), /D-05\.md does not end with a newline/);
  fails(tree({ index: INDEX.trimEnd() }), /DECISIONS\.md does not end with a newline/);
});

test("B1, B2: a pure move passes; every change of a moved line fails", () => {
  const base = [`# Registar\n\nUvod odjeljka.\n\n${HEADER}${ROW}\n`];
  const moved = [`# Registar\n\nUvod odjeljka.\n\n${HEADER}| [D-05](odluke/D-05.md) | Naslov | ODLUČENO |\n`, `# D-05\n\n${HEADER}${ROW}\n`];
  assert.deepEqual(checkVerbatim(base, moved), []);
  const variants = {
    "trailing space": `${ROW} `,
    nbsp: ROW.replace("Izmišljena odluka", "Izmišljena odluka"),
    nfd: ROW.normalize("NFD"),
    quotes: ROW.replace("odluka", "„odluka”"),
    bold: ROW.replace("odluka", "**odluka**"),
    shortened: ROW.slice(0, -10),
    "split line": ROW.replace(" za test.", "\nza test."),
  };
  for (const [kind, line] of Object.entries(variants)) {
    assert.notDeepEqual(checkVerbatim(base, [moved[0], `# D-05\n\n${line}\n`]), [], kind);
  }
  assert.notDeepEqual(checkVerbatim(base, [...moved, `# D-05\n${ROW}\n`]), [], "duplicated");
  assert.notDeepEqual(checkVerbatim(base, [moved[0].replace("Uvod odjeljka.\n", "")]), [], "lost intro");
  assert.notDeepEqual(checkVerbatim(base, [...moved, "Nova rečenica.\n"]), [], "new line");
});

test("the repository tree passes, with docs/odluke/ present", () => {
  const repo = readTree();
  assert.equal(repo.dir, "dir");
  assert.deepEqual(checkTree(repo), []);
});

test("readTree sees a symlinked file and a missing directory on disk", () => {
  const root = mkdtempSync(path.join(tmpdir(), "decisions-index-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/DECISIONS.md"), INDEX);
    assert.deepEqual(checkTree(readTree(root)), ["docs/odluke/ is missing"]);
    mkdirSync(path.join(root, "docs/odluke"));
    writeFileSync(path.join(root, "docs/x.md"), decision("D-05").text);
    symlinkSync("../x.md", path.join(root, "docs/odluke/D-05.md"));
    assert.ok(checkTree(readTree(root)).includes("docs/odluke/D-05.md is not a plain file"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
