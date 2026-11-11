// Table of contents with line ranges for the long rule documents (DAN-695, #1880 step 6).
// Tests were written before doc-toc.mjs; contract #1836 (OBLAK w695 · UGOVOR, korak 6).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import { applyToc, DOCS, docSections, main } from "./doc-toc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const START = "<!-- toc:start -->";
const END = "<!-- toc:end -->";
const block = (...entries) => [START, ...entries, END].join("\n");

test("docSections lists level 2 and 3 headings with their line ranges", () => {
  const text = [
    "# Naslov", // 1
    "", // 2
    "## 1. Prvi", // 3
    "tekst", // 4
    "### 1a. Pod", // 5
    "#### Dublje", // 6
    "## 2. Drugi ##", // 7
    "```", // 8
    "## U bloku", // 9
    "```", // 10
    "   ### Zadatak (orkestrator → sesija)", // 11
    "    ## uvučeno četiri razmaka", // 12
    "# Opet jedan", // 13
    "## 6.1. Točka", // 14
    "",
  ].join("\n");
  assert.deepEqual(
    docSections(text).map(({ level, label, start, end }) => ({ level, label, start, end })),
    [
      { level: 2, label: "§1 Prvi", start: 3, end: 6 },
      { level: 3, label: "§1a Pod", start: 5, end: 6 },
      { level: 2, label: "§2 Drugi", start: 7, end: 12 },
      { level: 3, label: "Zadatak (orkestrator → sesija)", start: 11, end: 12 },
      { level: 2, label: "§6.1 Točka", start: 14, end: 14 },
    ],
  );
});

const cases = [
  {
    name: "no markers: block goes before the first level 2 heading",
    input: "# D\n\nUvod.\n\n## 1. A\na\n### 1a. B\nb\n",
    output: `# D\n\nUvod.\n\n${block("- §1 A: retci 10-13", "  - §1a B: retci 12-13")}\n\n## 1. A\na\n### 1a. B\nb\n`,
  },
  {
    name: "no markers, first heading is level 3",
    input: "# D\n### Zadatak (x)\ny\n",
    output: `# D\n${block("  - Zadatak (x): retci 6-7")}\n\n### Zadatak (x)\ny\n`,
  },
  {
    name: "no level 2 or 3 heading: unchanged",
    input: "# D\n\n#### Duboko\ntekst\n",
    output: "# D\n\n#### Duboko\ntekst\n",
  },
  { name: "empty text: unchanged", input: "", output: "" },
  {
    name: "current block: unchanged",
    input: `# D\n${block("- §1 A: retci 6-7")}\n\n## 1. A\na\n`,
    output: `# D\n${block("- §1 A: retci 6-7")}\n\n## 1. A\na\n`,
  },
  {
    name: "stale ranges are corrected",
    input: `# D\n${block("- §1 A: retci 1-2")}\n\n## 1. A\na\nb\n`,
    output: `# D\n${block("- §1 A: retci 6-8")}\n\n## 1. A\na\nb\n`,
  },
  {
    name: "added section moves later ranges",
    input: `# D\n${block("- §1 A: retci 6-7")}\n\n## 1. A\na\n## 2. B\nb\n`,
    output: `# D\n${block("- §1 A: retci 7-8", "- §2 B: retci 9-10")}\n\n## 1. A\na\n## 2. B\nb\n`,
  },
  {
    name: "removed section drops its entry",
    input: `# D\n${block("- §1 A: retci 7-8", "- §2 B: retci 9-10")}\n\n## 1. A\na\n`,
    output: `# D\n${block("- §1 A: retci 6-7")}\n\n## 1. A\na\n`,
  },
  {
    name: "markers inside a fence do not count",
    input: `# D\n\n## 1. A\n~~~~\n${START}\n${END}\n~~~~\n`,
    output: `# D\n\n${block("- §1 A: retci 7-11")}\n\n## 1. A\n~~~~\n${START}\n${END}\n~~~~\n`,
  },
  {
    name: "fence closes only with the same character, at least as long",
    input: "# D\n\n## 1. A\n````\n```\n~~~~\n## U bloku\n````\n## 2. B\n",
    output: `# D\n\n${block("- §1 A: retci 8-13", "- §2 B: retci 14-14")}\n\n## 1. A\n\`\`\`\`\n\`\`\`\n~~~~\n## U bloku\n\`\`\`\`\n## 2. B\n`,
  },
  {
    name: "only spaces and tabs may follow a closing fence; a no-break space keeps it open",
    input: "# D\n\n## 1. A\n~~~\n~~~ \n## U bloku\n~~~ \t\n## 2. B\n",
    output: `# D\n\n${block("- §1 A: retci 8-12", "- §2 B: retci 13-13")}\n\n## 1. A\n~~~\n~~~ \n## U bloku\n~~~ \t\n## 2. B\n`,
  },
  {
    // U+2028 and U+2029 are not line endings in CommonMark: they belong to the info string or title.
    name: "a line separator in the info string still opens a fence",
    input: "# D\n\n## 1. A\n~~~\u2028x\n## U bloku\n~~~\n## 2. B\n",
    output: `# D\n\n${block("- §1 A: retci 8-11", "- §2 B: retci 12-12")}\n\n## 1. A\n~~~\u2028x\n## U bloku\n~~~\n## 2. B\n`,
  },
  {
    name: "a paragraph separator and a final no-break space stay in the title",
    input: "## 1. A\u2029B\u00a0\nc\n",
    output: `${block("- §1 A\u2029B\u00a0: retci 5-6")}\n\n## 1. A\u2029B\u00a0\nc\n`,
  },
  {
    name: "last section without a final newline",
    input: "## 1. A\na",
    output: `${block("- §1 A: retci 5-6")}\n\n## 1. A\na`,
  },
  {
    name: "CRLF is kept on every line",
    input: "# D\r\n\r\n## 1. A\r\na\r\n",
    output: `# D\r\n\r\n${START}\r\n- §1 A: retci 7-8\r\n${END}\r\n\r\n## 1. A\r\na\r\n`,
  },
  {
    name: "closing hashes and numbered subsections",
    input: "## 6. Dizajn ###\n### 6.1. Cilj #\nc\n",
    output: `${block("- §6 Dizajn: retci 6-8", "  - §6.1 Cilj: retci 7-8")}\n\n## 6. Dizajn ###\n### 6.1. Cilj #\nc\n`,
  },
];

for (const { name, input, output } of cases) {
  test(`applyToc: ${name}`, () => {
    assert.equal(applyToc(input), output);
    assert.equal(applyToc(output), output);
  });
}

for (const [name, input] of [
  ["start without end", `${START}\n## 1. A\n`],
  ["end without start", `${END}\n## 1. A\n`],
  ["reversed", `${END}\n${START}\n## 1. A\n`],
  ["two blocks", `${START}\n${END}\n${START}\n${END}\n## 1. A\n`],
  ["CR outside CRLF", "## 1. A\rb\n## 2. B\n"],
]) {
  test(`applyToc: marker error, ${name}`, () => {
    assert.throws(() => applyToc(input), /toc/);
  });
}

// Free documents: any mix of headings, prose, fence lines and markers, balanced or not.
const freeLine = fc.constantFrom(
  "# H", "## 1. A", "## B", "### 2a. C", "### Zadatak (x)", "#### D", "   ## E", "    ## F",
  "tekst", "", "- stavka", "```", "~~~", "````", "```x`", START, END, `   ${END}`,
);
const withEol = (lines, crlf, final) => {
  const eol = crlf ? "\r\n" : "\n";
  return lines.join(eol) + (final && lines.length ? eol : "");
};
const freeDoc = fc
  .record({ lines: fc.array(freeLine, { maxLength: 30 }), crlf: fc.boolean(), final: fc.boolean() })
  .map(({ lines, crlf, final }) => withEol(lines, crlf, final));

// Structured documents: top-level lines, closed fences that may hide headings and markers, and at
// most one real block (possibly stale) at a top-level position. Its line index is known.
const fenceArb = fc
  .record({ fence: fc.constantFrom("```", "~~~~"), inner: fc.array(fc.constantFrom("## U", "kod", START, END, "~~~"), { maxLength: 4 }) })
  .map(({ fence, inner }) => [fence, ...inner.filter((l) => !(fence === "~~~~" && l === "~~~")), fence]);
const topArb = fc.oneof(
  fc.constantFrom("# H", "## 1. A", "## B", "### 2a. C", "### Zadatak (x)", "#### D", "tekst", "").map((l) => [l]),
  fenceArb,
);
const staleBlock = fc
  .array(fc.constantFrom("- §1 A: retci 1-2", "  - x: retci 9-9", "- stara"), { maxLength: 3 })
  .map((entries) => [START, ...entries, END]);
const structuredDoc = fc
  .record({
    parts: fc.array(topArb, { maxLength: 15 }),
    block: fc.option(fc.tuple(staleBlock, fc.nat()), { nil: null }),
    crlf: fc.boolean(),
    final: fc.boolean(),
  })
  .map(({ parts, block, crlf, final }) => {
    const all = [...parts];
    if (block) all.splice(block[1] % (all.length + 1), 0, block[0]);
    return withEol(all.flat(), crlf, final);
  });

const splitLines = (text) => {
  if (text === "") return [];
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  if (text.endsWith("\n")) lines.pop();
  return lines;
};
/** The top-level block in a structured document: fences there are always closed by the same line. */
const blockRange = (lines) => {
  let fence = null;
  let start = -1;
  for (const [i, line] of lines.entries()) {
    if (fence) {
      if (line === fence) fence = null;
    } else if (line === "```" || line === "~~~~") fence = line;
    else if (line === START) start = i;
    else if (line === END) return [start, i];
  }
  return null;
};
const tryToc = (text) => {
  try {
    return applyToc(text);
  } catch {
    return null;
  }
};

test("property: applyToc is idempotent", () => {
  fc.assert(
    fc.property(fc.oneof(freeDoc, structuredDoc), (text) => {
      const once = tryToc(text);
      fc.pre(once !== null);
      assert.equal(applyToc(once), once);
    }),
    { numRuns: 1000 },
  );
});

/** ATX heading level of a line with a title, or 0. */
const atxLevel = (line) => /^ {0,3}(#{1,6})[ \t]/.exec(line)?.[1].length ?? 0;

test("property: every range starts at its heading and ends before the next one of its level or above", () => {
  fc.assert(
    fc.property(fc.oneof(freeDoc, structuredDoc), (text) => {
      const out = tryToc(text);
      fc.pre(out !== null);
      const lines = splitLines(out);
      const sections = docSections(out);
      for (const s of sections) {
        assert.equal(atxLevel(lines[s.start - 1]), s.level);
        assert.ok(s.start <= s.end && s.end <= lines.length);
        if (s.end < lines.length) assert.ok(atxLevel(lines[s.end]) >= 1 && atxLevel(lines[s.end]) <= s.level);
      }
      for (const level of [2, 3]) {
        const same = sections.filter((s) => s.level === level);
        for (let i = 1; i < same.length; i++) assert.ok(same[i].start > same[i - 1].end);
      }
    }),
    { numRuns: 1000 },
  );
});

test("property: the block lists every section, and outside it the output equals the input", () => {
  fc.assert(
    fc.property(structuredDoc, (text) => {
      const out = applyToc(text);
      const before = splitLines(text);
      const after = splitLines(out);
      const sections = docSections(out);
      const range = blockRange(after);
      if (!range) {
        assert.equal(out, text);
        assert.equal(sections.length, 0);
        return;
      }
      assert.deepEqual(
        after.slice(range[0] + 1, range[1]),
        sections.map((s) => `${s.level === 3 ? "  " : ""}- ${s.label}: retci ${s.start}-${s.end}`),
      );
      const old = blockRange(before);
      const outside = old
        ? [...before.slice(0, old[0]), ...before.slice(old[1] + 1)]
        : before;
      const kept = [...after.slice(0, range[0]), ...after.slice(range[1] + 1 + (old ? 0 : 1))];
      assert.deepEqual(kept, outside);
      if (!old) assert.equal(after[range[1] + 1], "");
      assert.equal(out.endsWith("\n"), text.endsWith("\n"));
    }),
    { numRuns: 1000 },
  );
});

test("the rule documents have a current table of contents", () => {
  for (const rel of DOCS) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.equal(
      applyToc(text),
      text,
      `${rel}: table of contents is stale; run node scripts/engineering/doc-toc.mjs --write`,
    );
  }
});

test("CLI: --check fails on a stale table, --write fixes it, bad markers fail", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-toc-"));
  try {
    mkdirSync(path.join(dir, "docs"));
    const write = (text) => DOCS.forEach((rel) => writeFileSync(path.join(dir, rel), text));
    const errors = [];
    const log = { log() {}, error: (line) => errors.push(line) };
    write("# D\n\n## 1. A\na\n");
    assert.equal(main(["--check"], dir, log), 1);
    assert.match(errors[0], /node scripts\/engineering\/doc-toc\.mjs --write/);
    assert.equal(main(["--write"], dir, log), 0);
    assert.equal(main(["--check"], dir, log), 0);
    assert.equal(readFileSync(path.join(dir, DOCS[0]), "utf8"), applyToc("# D\n\n## 1. A\na\n"));
    write(`${START}\n## 1. A\n`);
    assert.equal(main(["--write"], dir, log), 1);
    assert.equal(readFileSync(path.join(dir, DOCS[0]), "utf8"), `${START}\n## 1. A\n`);
    assert.equal(main([], dir, log), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--check exits 0 on the repository documents", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/engineering/doc-toc.mjs"), "--check"], {
    cwd: root,
    stdio: "pipe",
  });
});
