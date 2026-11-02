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

test("C1: only the first cell of an index row is an entry; a reference in a decision's text is not (review and QA, #1179)", () => {
  const ref = `${INDEX}| D-07 | Vidi [D-05](odluke/D-05.md). | Razlog. |\n## D-08: odjeljak\n\nKao [D-05](odluke/D-05.md \"naslov\").\n`;
  assert.deepEqual(checkTree(tree({ index: ref })), []);
  // A reference still has to reach the canonical file of a moved decision.
  fails(tree({ index: `${INDEX}| D-07 | Vidi [D-05](odluke/D-5.md). | R. |\n` }), /link D-05 points to odluke\/D-5\.md/);
  fails(tree({ index: `${INDEX}| D-07 | Vidi [D-06](odluke/D-06.md). | R. |\n` }), /link odluke\/D-06\.md points to a missing file/);
  // References never stand in for the entry, and a second entry row still counts.
  const noEntry = ref.replace("| [D-05](odluke/D-05.md) | Naslov | 1. 1. 2026. | ODLUČENO |\n", "");
  fails(tree({ index: noEntry }), /D-05\.md is linked 0 times/);
  fails(tree({ index: `${ref}  | [D-05](odluke/D-05.md) | opet |\n` }), /D-05\.md is linked 2 times/);
  // Inline code is visible text: a first cell with code beside the link, or a
  // link inside code, is not an entry (review, #1179).
  for (const cell of ["`Vidi` [D-05](odluke/D-05.md)", "[D-05](odluke/D-05.md) `x`", "`[D-05](odluke/D-05.md)`"]) {
    fails(tree({ index: `${noEntry}| ${cell} | Referenca | R. |\n` }), /D-05\.md is linked 0 times/);
  }
});

test("C5: a reference link definition is refused, in the index and in a decision file (QA, #1179)", () => {
  const empty = [file("README.md", "# Odluke\n")];
  for (const text of ["| [D-999][missing] | x |\n\n[missing]: odluke/D-999.md\n", "[D-999]\n\n   [D-999]: odluke/D-999.md \"t\"\n", "> [x]: odluke/D-999.md\n", "- [x]: ../nema.md\n"]) {
    fails(tree({ index: text, entries: empty }), /DECISIONS\.md: reference link definition .* is refused/);
  }
  fails(tree({ entries: [decision("D-05", `${ROW} [plan][p]\n\n[p]: ../nema.md`)] }), /D-05\.md: reference link definition "\[p\]: \.\.\/nema\.md" is refused/);
  // A footnote and an inline link are not definitions.
  assert.deepEqual(checkTree(tree({ index: `${INDEX}Tekst[^1].\n\n[^1]: Bilješka.\n` })), []);
});

test("A3: a decision link must point into docs/odluke/ under its canonical name", () => {
  for (const target of ["D-05.md", "privacy/D-05.md", "odluke/D-5.md", "Odluke/D-05.md", "../odluke/D-05.md"]) {
    fails(tree({ index: INDEX.replace("(odluke/D-05.md)", `(${target})`) }), /link D-05 points to/);
  }
  // An external address or an anchor under a decision ID is no way around the file (QA, #1179).
  for (const target of ["https://example.invalid/missing.md", "#d-05", "mailto:x@example.invalid"]) {
    fails(tree({ index: `${INDEX.replace("| [D-05](odluke/D-05.md) | Naslov | 1. 1. 2026. | ODLUČENO |\n", "")}| [D-999](${target}) | x |\n`, entries: [file("README.md", "# Odluke\n")] }), /link D-999 points to/);
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
  // The README in docs/odluke/ is not a decision file and holds no record either (review, #1179).
  fails(tree({ entries: [file("README.md", "# Odluke\n\n| D-01 | duplikat |\n")] }), /README\.md holds a decision record \(D-01\)/);
  fails(tree({ entries: [file("README.md", "# Odluke\n\n## D-01 Naslov\n")] }), /README\.md holds a decision record \(D-01\)/);
  // Indentation of up to three spaces is still a heading or a row; four is code (QA, #1179).
  for (const text of [" ## D-999: Nova odluka\n", "   # D-999\n", "  | D-999 | a | b |\n", "#\tD-999 tab\n"]) {
    fails(tree({ docs: [{ path: "docs/nova-odluka.md", text }] }), /nova-odluka\.md holds a decision record \(D-999\)/);
  }
  fails(tree({ index: `${INDEX}  | D-06 | uvučeno | opet |\n` }), /2 rows for D-06/);
  assert.deepEqual(checkTree(tree({ docs: [{ path: "docs/kod.md", text: "    ## D-999 u bloku koda\n" }] })), []);
  // Only the exact spelling of the index and docs/odluke/ is exempt; another spelling is refused (QA, #1179).
  for (const p of ["docs/Odluke/D-999.md", "DOCS/ODLUKE/X.md", "docs/decisions.md"]) {
    fails(tree({ docs: [{ path: p, text: "# D-999\n" }] }), new RegExp(`${p.replace(".", "\\.")} is another spelling`));
    fails(tree({ docs: [{ path: p, text: "bez zapisa\n" }] }), /is another spelling/);
  }
  assert.deepEqual(checkTree(tree({ docs: [{ path: "docs/odluke/D-05.md", text: "# D-05\n" }, { path: "docs/DECISIONS.md", text: INDEX }] })), []);
});

test("C5: relative links resolve; https, anchors and inline code are not followed", () => {
  fails(tree({ entries: [decision("D-05", `${ROW} Vidi [plan](../nema.md).`)] }), /D-05\.md: link \.\.\/nema\.md points to a missing file/);
  fails(tree({ index: `${INDEX}Vidi [x](engineering/nema.md).\n` }), /link engineering\/nema\.md points to a missing file/);
  const ok = `${ROW} [a](https://example.invalid/x) [b](#odlučeno) \`[c](odluke/D-NN.md)\` [d](../PRODUCT.md#5)`;
  assert.deepEqual(checkTree(tree({ entries: [decision("D-05", ok)], exists: (p) => p === "docs/PRODUCT.md" })), []);
  // A link with a CommonMark title is still followed (Codex, #1179).
  for (const title of [' "Plan"', " 'Plan'", " (Plan)"]) {
    fails(tree({ entries: [decision("D-05", `${ROW} Vidi [plan](../nema.md${title}).`)] }), /link \.\.\/nema\.md points to a missing file/);
  }
  // A file in docs/odluke/ resolves only to a plain file listed there, never through the checkout.
  fails(tree({ index: `${INDEX}[r](odluke/sub/x.md)\n`, exists: () => true }), /odluke\/sub\/x\.md points to a missing file/);
});

test("C5: links with spaces, <...> destinations and escapes are read, not skipped (review and QA, #1179)", () => {
  const empty = [file("README.md", "# Odluke\n")];
  const only = (row) => tree({ index: `${HEADER}${row}\n`, entries: empty });
  fails(only("| [D-999](<odluke/nema odluke.md>) | Nova odluka |"), /link D-999 points to odluke\/nema odluke\.md/);
  fails(only("| [D-999]( odluke/D-999.md ) | x |"), /link odluke\/D-999\.md points to a missing file/);
  fails(only("| [D-999](\todluke/D-999.md \"t\" ) | x |"), /link odluke\/D-999\.md points to a missing file/);
  fails(only("Vidi [plan](<../nema plana.md>)."), /link \.\.\/nema plana\.md points to a missing file/);
  fails(only("| [D\\-999](odluke/D-999.md) | x |"), /link odluke\/D-999\.md points to a missing file/);
  fails(only("| [**D-999**](odluke/D-999.md) | x |"), /link odluke\/D-999\.md points to a missing file/);
  // What the pattern cannot read, and an HTML link, are refused.
  fails(only("| [D-999](odluke/a(b(c)).md) | x |"), /link in .* is not understood/);
  fails(only('| <a href="odluke/D-999.md">D-999</a> | x |'), /HTML link .* is refused/);
  // The same forms reaching a real file pass, as entry and as reference.
  const forms = `${HEADER}| [D-05](<odluke/D-05.md>) | Naslov |\n| D-06 | Vidi [D-05]( ./odluke/D-05.md "t" ) i [plan](<PRODUCT.md>). | R. |\n`;
  assert.deepEqual(checkTree(tree({ index: forms, exists: (p) => p === "docs/PRODUCT.md" })), []);
});

test("C5: a reference in a decision file reaches the canonical file of its ID (QA, #1179)", () => {
  const index = `${INDEX.replace("| D-06 | Puni tekst. | Razlog. |\n", "")}| [D-06](odluke/D-06.md) | Druga | 1. 1. 2026. | ODLUČENO |\n`;
  const pair = (ref) => tree({ index, entries: [file("README.md", "# Odluke\n"), decision("D-05", `${ROW} Vidi ${ref}.`), decision("D-06")] });
  assert.deepEqual(checkTree(pair("[D-06](D-06.md)")), []);
  assert.deepEqual(checkTree(pair("[D-06](<./D-06.md#razlog>)")), []);
  fails(pair("[D-06](D-05.md)"), /D-05\.md: link D-06 points to D-05\.md, not D-06\.md/);
  fails(pair("[D-999](https://example.invalid/missing)"), /D-05\.md: link D-999 points to https:\/\/example\.invalid\/missing/);
  fails(pair("[D-06](#d-06)"), /D-05\.md: link D-06 points to #d-06/);
  fails(pair("[D-06](../DECISIONS.md#d-06)"), /D-05\.md: link D-06 points to \.\.\/DECISIONS\.md/);
  fails(pair("[D-999](D-999.md)"), /D-05\.md: link D-999\.md points to a missing file/);
  fails(pair("[D\\-06]( D-05.md )"), /D-05\.md: link D-06 points to D-05\.md/);
});

test("file format: BOM, CR and a missing final newline fail, in files and in the index", () => {
  fails(tree({ entries: [file("D-05.md", `﻿# D-05\n${ROW}\n`)] }), /D-05\.md starts with a BOM/);
  fails(tree({ entries: [file("D-05.md", `# D-05\r\n${ROW}\r\n`)] }), /D-05\.md has a CR/);
  fails(tree({ entries: [file("D-05.md", `# D-05\n${ROW}`)] }), /D-05\.md does not end with a newline/);
  fails(tree({ index: INDEX.trimEnd() }), /DECISIONS\.md does not end with a newline/);
});

const ix = (text) => ({ id: null, text });
const df = (id, text) => ({ id, text });

test("B1, B2: a pure move passes; every change of a moved line fails", () => {
  const base = [ix(`# Registar\n\nUvod odjeljka.\n\n${HEADER}${ROW}\n`)];
  const moved = [ix(`# Registar\n\nUvod odjeljka.\n\n${HEADER}| [D-05](odluke/D-05.md) | Naslov | ODLUČENO |\n`), df("D-05", `# D-05\n\n${HEADER}${ROW}\n`)];
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
    assert.notDeepEqual(checkVerbatim(base, [moved[0], df("D-05", `# D-05\n\n${line}\n`)]), [], kind);
  }
  assert.notDeepEqual(checkVerbatim(base, [...moved, df("D-05", `# D-05\n${ROW}\n`)]), [], "duplicated");
  assert.notDeepEqual(checkVerbatim(base, [ix(moved[0].text.replace("Uvod odjeljka.\n", ""))]), [], "lost intro");
  assert.notDeepEqual(checkVerbatim(base, [...moved, df("D-05", "Nova rečenica.\n")]), [], "new line");
  // A full decision that links a moved one stays compared (Codex, #1179).
  const linking = `| D-06 | Vidi [povezanu odluku](odluke/D-05.md). | Razlog. |`;
  const withLink = [ix(`${HEADER}${linking}\n`)];
  assert.deepEqual(checkVerbatim(withLink, withLink), []);
  assert.notDeepEqual(checkVerbatim(withLink, [ix(withLink[0].text.replace("Razlog.", "Drugi razlog."))]), [], "linking row changed");
  assert.notDeepEqual(checkVerbatim(base, [ix(moved[0].text.replace("[D-05](odluke/D-05.md)", "[D-05](odluke/D-06.md)")), moved[1]]), [], "index row to another file");
});

test("B1: text is compared per decision; swapping two decisions' paragraphs fails (review and QA, #1179)", () => {
  const base = [ix(`# Registar\n\n## D-05: Prva\n\nOdlomak A.\n\n## D-06: Druga\n\nOdlomak B.\n\n## Ostalo\n\nOpći tekst.\n`)];
  const index = ix(`# Registar\n\n${HEADER}| [D-05](odluke/D-05.md) | Prva |\n| [D-06](odluke/D-06.md) | Druga |\n\n## Ostalo\n\nOpći tekst.\n`);
  const move = (a, b) => [index, df("D-05", `# D-05\n\n## D-05: Prva\n\n${a}\n`), df("D-06", `# D-06\n\n## D-06: Druga\n\n${b}\n`)];
  assert.deepEqual(checkVerbatim(base, move("Odlomak A.", "Odlomak B.")), []);
  const swapped = checkVerbatim(base, move("Odlomak B.", "Odlomak A."));
  assert.ok(swapped.some((e) => /D-05: "Odlomak A\."/.test(e)) && swapped.some((e) => /D-06: "Odlomak B\."/.test(e)), JSON.stringify(swapped));
  // A row swapped into the other decision's file, or general text moved into a file, fails too.
  assert.notDeepEqual(checkVerbatim([ix(`${HEADER}${ROW}\n| D-06 | Druga. | R. |\n`)], [ix(""), df("D-06", `# D-06\n${ROW}\n`), df("D-05", "# D-05\n| D-06 | Druga. | R. |\n")]), []);
  assert.notDeepEqual(checkVerbatim(base, [ix(index.text.replace("Opći tekst.\n", "")), ...move("Odlomak A.", "Odlomak B.\nOpći tekst.").slice(1)]), []);
  // A subheading without an ID stays in its decision's section.
  const sub = [ix("## D-05: Prva\n\n### Razlog\n\nJer.\n")];
  assert.deepEqual(checkVerbatim(sub, [ix(""), df("D-05", "# D-05\n\n## D-05: Prva\n\n### Razlog\n\nJer.\n")]), []);
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
