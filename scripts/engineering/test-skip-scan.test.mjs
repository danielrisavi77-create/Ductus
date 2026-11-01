import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// F-035c: the gate's own tests under scripts/engineering must not be skipped,
// marked todo or focused with only. ci-test-step.test.mjs covers
// scripts/orchestrator; this file covers scripts/engineering, itself included.

const engineeringDir = new URL("./", import.meta.url);

const word = "(?:test|describe|it|suite|t)";
const mode = "(?:skip|todo|only)";
// Dotted calls, bracket access with a quoted name, and the node:test option keys.
const PATTERNS = [
  new RegExp(String.raw`\b${word}\s*\.\s*${mode}\b`, "g"),
  new RegExp(String.raw`\b${word}\s*\[\s*["'\x60]${mode}["'\x60]\s*\]`, "g"),
  new RegExp(String.raw`[{,]\s*${mode}\s*[:,}]`, "g"),
];

// Runtime skips that guard a platform the case cannot run on. Each still runs
// on Linux CI. A new skip site fails this test until it is listed here, so a
// reviewer sees it in the diff of this file.
const ALLOWED = new Map([
  ["agent-hooks.test.mjs", 2],
  ["safety-net-wrapper.test.mjs", 1],
]);

export function skipSites(src) {
  const sites = [];
  for (const pattern of PATTERNS) {
    for (const match of src.matchAll(pattern)) sites.push(match[0]);
  }
  return sites;
}

test("engineering tests are not skipped, todo or focused beyond the listed platform guards", async () => {
  const names = (await readdir(engineeringDir)).filter((n) => n.endsWith(".test.mjs"));
  assert.ok(names.includes("review-gate.test.mjs"), "the scan must see the gate's tests");
  for (const name of names) {
    const src = await readFile(new URL(name, engineeringDir), "utf8");
    const sites = skipSites(src);
    const allowed = ALLOWED.get(name) ?? 0;
    assert.ok(
      sites.length <= allowed,
      `${name} has ${sites.length} skip, todo or only site(s), allowed ${allowed}: ${sites.join(", ")}`,
    );
    if (allowed > 0) {
      // A listed site stays a runtime skip on the test context, never a static one.
      assert.ok(sites.every((s) => /^t\s*\.\s*skip$/.test(s)), `${name}: only a runtime context skip is allowed, got ${sites.join(", ")}`);
    }
  }
  for (const name of ALLOWED.keys()) assert.ok(names.includes(name), `${name} is listed but missing`);
});

test("the scan catches the static, bracket and option forms", () => {
  // Built from parts so this file's own source does not match the scan.
  const dot = (a, b) => `${a}.${b}`;
  const hits = [
    dot("test", "skip('x', () => {})"),
    dot("describe", "only('x', () => {})"),
    dot("it", "todo('x')"),
    dot("t", "only()"),
    dot("test ", " skip('x')"),
    "test[" + "'skip']('x')",
    "test[" + '"only"]("x")',
    "test(`x`, { " + "skip: true }, () => {})",
    "test('x', { " + "todo: 'later' }, fn)",
    "test('x', { " + "only }, fn)",
    "test('x', { a: 1, " + "skip: true }, fn)",
    dot("suite", "skip('x')"),
  ];
  for (const src of hits) assert.ok(skipSites(src).length > 0, src);
  const misses = [
    "test('x', () => {})",
    "const skipped = 1;",
    "t.skipped",
    "options.skipList",
    "contest.skip",
    "{ skipDocs: true }",
    "{ onlyIf: false }",
  ];
  for (const src of misses) assert.deepEqual(skipSites(src), [], src);
});
