import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReady, overlapPairs, renderOverlap, safePath } from "./orchestrator-core.mjs";

// F-027: file names come from any PR, so the tools print them as one inert
// line each, and a PR whose head is not in this repository is marked.
const long = `src/${"a".repeat(400)}.ts`;
const pathClasses = [
  ["ordinary path", "src/domain/a.ts", "src/domain/a.ts"],
  ["unicode letters", "docs/odluke/čšž.md", "docs/odluke/čšž.md"],
  ["line feed", "a\nINJECTED", "a\\u000aINJECTED"],
  ["carriage return", "a\rb", "a\\u000db"],
  ["tab", "a\tb", "a\\u0009b"],
  ["escape sequence", "a\u001b[2Jb", "a\\u001b[2Jb"],
  ["line separator", "a\u2028b", "a\\u2028b"],
  ["bidirectional override", "a\u202eb", "a\\u202eb"],
  ["NUL", "a\u0000b", "a\\u0000b"],
];

for (const [name, input, expected] of pathClasses) {
  test(`F-027 path class "${name}"`, () => {
    assert.equal(safePath(input), expected);
  });
}

test("F-027 path class \"too long\": cut with a marker, no line break", () => {
  const out = safePath(long);
  assert.ok(out.length <= 201, String(out.length));
  assert.ok(out.endsWith("…"));
  assert.ok(!/[\r\n]/.test(out));
});

test("F-027 path class \"long escapes\": the cap counts the printed form", () => {
  assert.ok(safePath("\n".repeat(300)).length <= 201);
});

for (const value of [null, undefined, 42, {}, ["a"]]) {
  test(`F-027 path class "not a string" (${JSON.stringify(value) ?? "undefined"})`, () => {
    assert.equal(safePath(value), "?");
  });
}

const REPO = "owner1/repo1";
const shared = "x\nfake line";
const prsOf = (headRepo) => [
  { number: 1, isDraft: false, headRepo: REPO, paths: [shared, "b.ts"] },
  { number: 2, isDraft: false, headRepo, paths: [shared] },
];

test("F-027: renderOverlap prints every shared file on one line", () => {
  const prs = prsOf(REPO);
  const lines = renderOverlap(prs, overlapPairs(prs), 10, REPO);
  for (const line of lines) assert.ok(!/[\r\n]/.test(line), JSON.stringify(line));
  assert.ok(lines.includes("  x\\u000afake line"));
});

test("F-027: a directory name with a control or bidi character prints as one inert line", () => {
  const prs = prsOf(REPO);
  const pair = { a: 1, b: 2, count: 0, files: [], dirs: ["src/x\nINJECTED", "db\u202emigrations", "a\u001b[2J"] };
  const lines = renderOverlap(prs, [pair], 10, REPO);
  for (const line of lines) assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e]/.test(line), JSON.stringify(line));
  assert.match(lines[0], /same directory: src\/x\\u000aINJECTED, db\\u202emigrations, a\\u001b\[2J$/);
});

const prClasses = [
  ["head in this repository", REPO, false],
  ["fork", "outsider/repo1", true],
  ["deleted fork (null)", null, true],
  ["unknown (undefined)", undefined, true],
  ["empty", "", true],
  ["other letter case", "Owner1/Repo1", true],
];

for (const [name, headRepo, marked] of prClasses) {
  test(`F-027 PR class "${name}"`, () => {
    const prs = prsOf(headRepo);
    const header = renderOverlap(prs, overlapPairs(prs), 10, REPO)[0];
    assert.equal(/#2 VANJSKI/.test(header), marked, header);
    assert.ok(!/#1 VANJSKI/.test(header), header);
  });
}

test("F-027: without a known repository every PR is marked, never none", () => {
  const prs = prsOf(REPO);
  const header = renderOverlap(prs, overlapPairs(prs), 10, "")[0];
  assert.match(header, /#1 VANJSKI/);
  assert.match(header, /#2 VANJSKI/);
});

test("F-027: pr-ready lines print file names inertly", () => {
  const checks = evaluateReady({
    head: "e".repeat(40),
    gate: { state: "success" },
    rollup: [{ name: "ci", conclusion: "SUCCESS" }],
    pr: { headRepo: REPO, author: { login: "owner1", type: "User" } },
    repository: REPO,
    ownerLogin: "owner1",
    base: "main",
    mergeable: "MERGEABLE",
    overlap: [shared],
    threads: { count: 0, authors: [] },
    autoMerge: false,
    files: [".github/workflows/x\ny.yml", "docs/DECISIONS.md\n"],
    agent: "claude:w1:platforma",
    draft: false,
  });
  for (const c of checks) assert.ok(!/[\r\n]/.test(c.text), JSON.stringify(c.text));
});
