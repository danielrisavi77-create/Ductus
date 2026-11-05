// F-035 c (DAN-168): no node test that CI runs is skipped, left as todo or
// focused, except at the listed places. CI runs `node --test` over these
// directories (.github/workflows/ci.yml, "Engineering system unit tests"), and
// a marked test there passes silently. Each file is parsed with the TypeScript
// parser (already a devDependency) and its syntax tree is walked, so comments,
// strings, regular expressions, local variables and class fields are never
// markers. A marker is each form of t.2 of the orchestrator contract (#1458
// c.6626687486) and each form the earlier version already caught:
// - a member `skip`, `todo`, `only` or `runOnly` in callee position
//   (`t.skip()`, `test.skip.each([])()`, `ctx?.todo()`, `t.skip.call(t)`), or
//   `skip`, `todo` or `only` read from `describe`, `it`, `test` or `suite`;
// - a `skip`, `todo` or `only` key in an object literal (node:test options);
// - `skip`, `todo` or `only` imported from node:test, or destructured from
//   `describe`, `it`, `test` or `suite`.
// Names are compared after escapes are cooked (`t.sk\u0069p`, `t["sk\ip"]`).
// A file that does not parse is an error, never clean. The scan may be
// conservative: a rare valid form may be reported and fail CI loudly, but a
// marker that node:test applies is never passed silently. Out of reach: names
// built at run time (`t[name]`), a method passed on uncalled (`run(t.skip)`),
// options taken from a class instance or JSON, and destructuring from the test
// function under another name (`const { skip } = await import("node:test")`).
// TypeScript also parses syntax that Node rejects in a .mjs file (types, JSX,
// `with`); such a file fails loudly when CI runs it, so it is never silent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DIRS = ["scripts/engineering", "scripts/orchestrator", "scripts/hooks"];
const MEMBERS = new Set(["skip", "todo", "only", "runOnly"]);
const OPTIONS = new Set(["skip", "todo", "only"]);
const ROOTS = new Set(["describe", "it", "test", "suite"]);

// A place is a file and the exact trimmed text of its line; each must exist
// exactly once (ENGINEERING_SYSTEM §14 t.8), so a stale entry fails.
const ALLOWED = [
  [
    "scripts/engineering/agent-hooks.test.mjs",
    't.skip("Windows without the symlink privilege cannot create a file link; this case runs on Linux CI");',
  ],
  [
    "scripts/engineering/agent-hooks.test.mjs",
    'if (process.platform !== "linux") return t.skip("needs /proc/self/fd; other platforms have only the name checks (docs/SESSIONS.md §4a)");',
  ],
  [
    "scripts/engineering/safety-net-wrapper.test.mjs",
    'return t.skip("bash not found; run on Linux CI or install Git Bash");',
  ],
  [
    "scripts/engineering/safety-net-wrapper.test.mjs",
    'return t.skip("mkfifo is Linux-only here; this case runs on Linux CI");',
  ],
];

const isWrap = (n) =>
  ts.isParenthesizedExpression(n) ||
  ts.isNonNullExpression(n) ||
  ts.isAsExpression(n);
const isAccess = (n) =>
  ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n);

// The cooked static name of a key or member, or null (`#skip`, `t[name]`,
// `{ [name]: 1 }`): computed, only a string literal is a static name.
function staticName(n, computed = false) {
  if (!n) return null;
  if (ts.isComputedPropertyName(n) || ts.isParenthesizedExpression(n))
    return staticName(n.expression, true);
  if (ts.isStringLiteralLike(n)) return n.text;
  return ts.isIdentifier(n) && !computed ? n.text : null;
}
const keyOf = (n) =>
  ts.isPropertyAccessExpression(n) ? n.name : n.argumentExpression;
const memberName = (n) => staticName(keyOf(n), ts.isElementAccessExpression(n));

// The identifier an access or call chain starts from (`test` in `test.skip.each([])`).
function rootName(n) {
  while (isWrap(n) || isAccess(n) || ts.isCallExpression(n)) n = n.expression;
  return ts.isIdentifier(n) ? n.text : null;
}

// True when the access, possibly through further members, is what is called.
function called(n) {
  let p = n.parent;
  while (isWrap(p) || (isAccess(p) && p.expression === n))
    [n, p] = [p, p.parent];
  return (
    (ts.isCallExpression(p) && p.expression === n) ||
    (ts.isTaggedTemplateExpression(p) && p.tag === n)
  );
}

// The values an object literal or binding pattern destructures, or undefined
// when it is not a pattern. A nested pattern takes the outer value and, when
// that is undefined, its default, so both are sources
// (`{ nested: { skip } = test } = {}`, `{ test: { skip } } = test`).
function destructured(n) {
  const values = [];
  let pattern = false;
  for (let p = n.parent; ; p = n.parent) {
    if (ts.isBindingElement(p) && p.name === n) {
      if (p.initializer) values.push(p.initializer);
      n = p.parent;
    } else if (
      ts.isBinaryExpression(p) &&
      p.left === n &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      values.push(p.right);
      pattern = true;
      n = p;
    } else if (
      ts.isPropertyAssignment(p) ||
      // A default (`{ opts = { skip: true } } = {}`) is options, not the pattern.
      (ts.isShorthandPropertyAssignment(p) &&
        p.objectAssignmentInitializer !== n) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isSpreadElement(p) ||
      ts.isSpreadAssignment(p) ||
      ts.isObjectLiteralExpression(p) ||
      isWrap(p)
    )
      n = p;
    else {
      if (ts.isVariableDeclaration(p) && p.name === n) {
        const loop = p.parent.parent;
        if (ts.isForOfStatement(loop) || ts.isForInStatement(loop))
          values.push(loop.expression);
        else if (p.initializer) values.push(p.initializer);
      } else if (
        (ts.isForOfStatement(p) || ts.isForInStatement(p)) &&
        p.initializer === n
      )
        values.push(p.expression);
      else if (ts.isParameter(p) && p.name === n) {
        if (p.initializer) values.push(p.initializer);
      } else if (!pattern) return undefined;
      return values;
    }
  }
}
// True when a source can evaluate to a test root: through members, calls,
// `await` and type assertions, and through each operand a logical, comma,
// conditional or assignment expression can return (`test || {}`,
// `(0, test)`, `c ? {} : test`, `await test`).
const VALUE_OF = (n) =>
  isWrap(n) ||
  isAccess(n) ||
  ts.isCallExpression(n) ||
  ts.isAwaitExpression(n) ||
  ts.isSatisfiesExpression(n) ||
  ts.isTypeAssertionExpression(n);
const EITHER = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const RIGHT = new Set([ts.SyntaxKind.CommaToken, ts.SyntaxKind.EqualsToken]);
function fromRoot(value) {
  while (value && VALUE_OF(value)) value = value.expression;
  if (!value) return false;
  if (ts.isConditionalExpression(value))
    return fromRoot(value.whenTrue) || fromRoot(value.whenFalse);
  if (ts.isBinaryExpression(value)) {
    const op = value.operatorToken.kind;
    if (RIGHT.has(op)) return fromRoot(value.right);
    if (EITHER.has(op)) return fromRoot(value.left) || fromRoot(value.right);
  }
  return ts.isIdentifier(value) && ROOTS.has(value.text);
}

// The parse errors and the marker lines (1-based, counted by LF) of a source.
export function scan(src, file = "a.test.mjs") {
  const kind = /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (n) => src.slice(0, n.getStart(sf)).split("\n").length;
  const errors = sf.parseDiagnostics.map(
    (d) =>
      `${file}:${src.slice(0, d.start).split("\n").length}: cannot be parsed, so it is not clean: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
  );
  const found = new Set();
  const visit = (n) => {
    if (isAccess(n) && MEMBERS.has(memberName(n) ?? "")) {
      const name = memberName(n);
      if (
        called(n) ||
        (OPTIONS.has(name) && ROOTS.has(rootName(n.expression) ?? ""))
      )
        found.add(lineOf(keyOf(n)));
    }
    if (ts.isObjectLiteralExpression(n)) {
      const values = destructured(n);
      for (const p of n.properties)
        if (p.name && OPTIONS.has(staticName(p.name) ?? ""))
          if (!values || values.some(fromRoot)) found.add(lineOf(p.name));
    }
    if (ts.isObjectBindingPattern(n) && destructured(n)?.some(fromRoot))
      for (const e of n.elements)
        if (OPTIONS.has(staticName(e.propertyName ?? e.name) ?? ""))
          found.add(lineOf(e));
    if (
      ts.isImportDeclaration(n) &&
      staticName(n.moduleSpecifier) === "node:test" &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    )
      for (const s of n.importClause.namedBindings.elements)
        if (OPTIONS.has(staticName(s.propertyName ?? s.name) ?? ""))
          found.add(lineOf(s));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { errors, lines: [...found].sort((a, b) => a - b) };
}

function scanFiles() {
  const files = [];
  for (const dir of DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).sort())
      if (name.endsWith(".test.mjs")) files.push(`${dir}/${name}`);
  }
  return files;
}

export function check(sources, allowed) {
  const problems = [];
  const places = new Map();
  for (const [file, src] of sources) {
    const { errors, lines } = scan(src, file);
    problems.push(...errors);
    const text = src.split(/\r?\n/);
    for (const n of lines) {
      const key = `${file}\n${text[n - 1].trim()}`;
      places.set(key, [...(places.get(key) ?? []), n]);
    }
  }
  const listed = new Set();
  for (const [file, text] of allowed) {
    const key = `${file}\n${text}`;
    if (listed.has(key)) problems.push(`${file}: listed twice: ${text}`);
    listed.add(key);
    const at = places.get(key) ?? [];
    if (at.length !== 1)
      problems.push(
        `${file}: listed place found ${at.length} times (must be exactly once): ${text}`,
      );
  }
  for (const [key, at] of places) {
    if (listed.has(key)) continue;
    const [file, text] = key.split("\n");
    for (const n of at)
      problems.push(`${file}:${n}: skip, todo or only marker: ${text}`);
  }
  return problems;
}

test("F-035 c: no node test that CI runs is skipped, todo or focused outside the listed places", () => {
  const files = scanFiles();
  assert.ok(files.length > 50, `found only ${files.length} test files`);
  assert.ok(
    files.includes("scripts/engineering/test-skip-scan.test.mjs"),
    "the scan covers itself",
  );
  const problems = check(
    files.map((file) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]),
    ALLOWED,
  );
  assert.deepEqual(problems, []);
});

// [marked, clean, line]: every earlier FAIL and Codex finding in both
// directions (#1458), plus the classes K1 to K5 of the contract.
const LS = "\u2028";
const CASES = [
  // K1: a member in callee position, or read from a test root.
  ["t.skip();", "t.skipped();"],
  ["test.skip.each([])();", "test.each([])();"],
  ["ctx?.todo();", "ctx?.done();"],
  ["t.skip.call(t);", "t.call(t);"],
  ["(t.skip)();", "(t.skip) + 1;"],
  ["t.skip!();", "t.skip!;", 1, "a.test.ts"],
  ["const v = <T>t; t.skip();", "const v = <T>t.skip;", 1, "a.test.ts"],
  ["t.runOnly(true);", "t.run(true);"],
  ["t.skip`r`;", "t.skips`r`;"],
  ["const f = describe.only;", "const f = cfg.only;"],
  ["it.todo('a');", "it.done('a');"],
  // K2: a key in an object literal (node:test options).
  ["test('a', { skip: true });", "test('a', { timeout: 1 });"],
  ["test({ 'only': true });", "test({ 'onlyIf': true });"],
  // On purpose (#1091 c.6626837919): node:test runs `skip: false` and
  // `only: false`, but any such key is reported, so a value cannot hide one.
  [
    "test('a', { skip: false, only: false });",
    "test('a', { skipped: false });",
  ],
  ["test({ ['todo']: 'r' });", "test({ ['to' + 'do']: 'r' });"],
  ["({ get skip() {} });", "({ get skips() {} });"],
  ["({ async *skip() {} });", "({ async *skips() {} });"],
  ["const skip = 1; test({ skip });", "const skip = 1; test(skip);"],
  ["({ class: 1, skip: 2 });", "class skip {}"],
  [
    "({ a: 1, skip: 2 });",
    "class A {\n  a = 1\n  skip = 2\n  static only = 3\n}",
  ],
  ["({ a: 1, todo: 2 });", `class A { a = 1\rskip = 2${LS}todo = 3 }`],
  ["x = [{ only: 1 }];", "({ only: x } = opts);"],
  // K3: imported from node:test, or destructured from a test function.
  ['import { skip } from "node:test";', 'import { mock } from "node:test";'],
  ['import { only as o } from "node:test";', 'import { only } from "./x.mjs";'],
  ["const { todo } = test;", "const { todo } = cfg;"],
  ["({ skip: s } = it);", "function f({ skip }) { return skip; }"],
  ["for (const { only } of describe);", "for (const { only } of list);"],
  // Codex 4467382377: a nested pattern keeps the source it destructures.
  ["const { test: { skip } } = test;", "const { test: { skip } } = cfg;"],
  // Codex 4467635949: a parameter default is the source of its pattern.
  [
    "function f({ skip } = test) { return skip; }",
    "function f({ skip } = cfg) { return skip; }",
  ],
  [
    "const f = ({ only } = describe) => only;",
    "const f = ({ only } = opts) => only;",
  ],
  // Codex 4467635962: a default inside an assignment pattern is an options object.
  [
    "let opts; ({ opts = { skip: true } } = {});",
    "let opts; ({ opts = { timeout: 1 } } = {});",
  ],
  // Review FAIL c.6647079464: a nested pattern also takes its default when the
  // outer value is undefined, so both the default and the outer source count.
  [
    "const { nested: { skip } = test } = {};",
    "const { nested: { skip } = cfg } = {};",
  ],
  [
    "const { a: { b: { todo } = it } = {} } = {};",
    "const { a: { b: { todo } = {} } = cfg } = {};",
  ],
  ["const [{ skip } = test] = [];", "const [{ skip } = cfg] = [];"],
  [
    "function f({ a: { only } = describe } = {}) { return only; }",
    "function f({ a: { only } = opts } = {}) { return only; }",
  ],
  [
    "for (const { a: { skip } = suite } of [{}]);",
    "for (const { a: { skip } = cfg } of [{}]);",
  ],
  [
    "let skip; ({ test: { skip } = {} } = test);",
    "let skip; ({ test: { skip } = {} } = cfg);",
  ],
  ["test('a', { skip: true } || {});", "test('a', cfg || { timeout: 1 });"],
  // A source that may be the root through a logical, comma, conditional or
  // assignment expression is the root (review on 86b413be).
  ["const { skip } = test || {};", "const { skip } = cfg || {};"],
  [
    "const { a: { skip } = test || {} } = {};",
    "const { a: { skip } = cfg || {} } = {};",
  ],
  [
    "const { a: { todo } = true && test } = {};",
    "const { a: { todo } = cfg && other } = {};",
  ],
  [
    "const { a: { only } = test ?? {} } = {};",
    "const { a: { only } = cfg ?? {} } = {};",
  ],
  [
    "const { a: { skip } = (0, test) } = {};",
    "const { a: { skip } = (test, cfg) } = {};",
  ],
  ["const { skip } = c ? {} : describe;", "const { skip } = test ? {} : cfg;"],
  ["let x; const { todo } = (x = it);", "let x; const { todo } = (it = cfg);"],
  [
    "let x; const { skip } = (x ||= suite);",
    "let x; const { skip } = (x ||= cfg);",
  ],
  [
    "const { skip } = (test || cfg).nested;",
    "const { skip } = (cfg || other).nested;",
  ],
  [
    "async function f() { const { skip } = await test; }",
    "async function f() { const { skip } = await cfg; }",
  ],
  [
    "async function f() { const { n: { todo } = await (0, it) } = {}; }",
    "async function f() { const { n: { todo } = await (it, cfg) } = {}; }",
  ],
  // K4: names are compared cooked.
  ["t.sk\\u0069p();", "t.sk\\u0069pped();"],
  ["t.\\u{73}kip();", "t.\\u{73}kips();"],
  ['t["sk\\ip"]();', 't["sk\\ipped"]();'],
  [`t['sk\\${LS}ip']();`, `t['sk\\${LS}ipped']();`],
  ["t.skip\u00a0();", "t.skip\u00a0+ 1;"],
  // K5: comments, strings, regular expressions, locals and classes.
  [`// c${LS}t.skip();`, "// c t.skip();"],
  ["/* */ t.skip();", "/* t.skip(); */"],
  ["t.skip('t.skip()');", "const s = 't.skip()';"],
  ["const r = /\\.skip/; t.todo();", "const r = /\\.skip\\(/;"],
  ["const s = `${t.skip()}`;", "const s = `${/\\.skip/.source}`;"],
  ["let n = 1; n++ / 2; t.skip(); /x/;", "let n = 1; n++ / 2; t.skips(); /x/;"],
  [
    "const o = { of: 4 };\no.of / 2; t.skip('/');",
    "const o = { of: 4 };\no.of; /t.skip/;",
    2,
  ],
  ["const of = 2; of / 2; t.skip('/');", "const of = 2; of / 2; /t.skip/;"],
  ["if (true) /x/.test(t.skip());", "if (true) /\\.skip\\b/.test('');"],
  ["if (true) {} /x/; t.skip();", "if (true) {} /\\.skip\\b/.test('');"],
  ["String.raw`\\u{110000}`; t.skip();", "String.raw`\\u{110000} t.skip()`;"],
  ["let skip; t.skip();", "let skip = true; skip = false;"],
  // Codex 4467382351: a computed key or index that is a variable is a run-time name.
  [
    "test('a', { ['skip']: 1 });",
    "const skip = 'timeout'; test('a', { [skip]: 1 });",
  ],
  ["t[('skip')]();", "const skip = 'm'; t[skip](); t[(skip)]();"],
  ["class A { m(t) { t.skip(); } }", "class A { skip = 1; static todo = 2; }"],
  ["class A { m() { this.skip(); } }", "class A { only() {} #skip() {} }"],
  ["class A { m() { t.skip(); } }", "class A { class\nm() { let skip; } }"],
  [
    "new\nclass { m(t) { t.skip(); } }",
    // Review FAIL c.6626652086: a field `new` ended by ASI, then a field `class`.
    "class A {\n  new\n  class\n  m() { let skip; skip = true; }\n}",
    2,
  ],
];
for (const lt of ["\n", "\r", "\r\n", LS, "\u2029"]) {
  CASES.push([`t["sk\\${lt}ip"]();`, `t["sk\\${lt}ipped"]();`]);
  CASES.push([`//${lt}t.skip();`, `// t.skip();${lt}`, /\n/.test(lt) ? 2 : 1]);
}

// A fixture is only evidence if the JavaScript engine accepts it as written.
function assertValidJs(src, label) {
  if (!/\bimport\b/.test(src)) {
    assert.doesNotThrow(() => new Function(`"use strict";${src}`), label);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-scan-"));
  try {
    fs.writeFileSync(path.join(dir, "a.mjs"), src);
    const r = spawnSync(process.execPath, ["--check", path.join(dir, "a.mjs")]);
    assert.equal(r.status, 0, `${label}: ${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("F-035 c: each fixture is marked in one direction and clean in the other", () => {
  for (const [marked, clean, line = 1, file] of CASES) {
    for (const src of file ? [] : [marked, clean])
      assertValidJs(src, JSON.stringify(src));
    assert.deepEqual(
      scan(marked, file),
      { errors: [], lines: [line] },
      JSON.stringify(marked),
    );
    assert.deepEqual(
      scan(clean, file),
      { errors: [], lines: [] },
      JSON.stringify(clean),
    );
  }
});

test("F-035 c: the markers it reports are the ones node:test skips or marks todo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-scan-"));
  const files = {
    "marked.test.mjs": [
      'import test, { skip, todo } from "node:test";',
      'test.skip("a", () => {});',
      'test("b", { skip: true }, () => {});',
      'test("c", { todo: "r" }, () => {});',
      'test("d", (t) => { t.skip("r"); });',
      'skip("e", () => {});',
      'const { n: { todo: td } = test } = {}; td("f", () => {});',
      'const { n: { skip: sk } = test || {} } = {}; sk("g", () => {});',
      'const { n: { skip: sw } = await test } = {}; sw("h", () => {});',
    ],
    "clean.test.mjs": [
      'import test from "node:test";',
      "class Opts { skip = true; static todo = 'r'; }",
      'test("a", () => { let skip = new Opts().skip; const s = "t.skip()"; return /\\.only/.test(s) && skip; });',
    ],
  };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const counts = {};
    for (const [name, lines] of Object.entries(files)) {
      const src = lines.join("\n");
      fs.writeFileSync(path.join(dir, name), src);
      const r = spawnSync(
        process.execPath,
        ["--test", "--test-reporter=tap", path.join(dir, name)],
        { env, encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      counts[name] = [
        /# skipped (\d+)/.exec(r.stdout)?.[1],
        /# todo (\d+)/.exec(r.stdout)?.[1],
        scan(src).lines,
      ];
    }
    assert.deepEqual(counts["marked.test.mjs"], [
      "6",
      "2",
      [1, 2, 3, 4, 5, 7, 8, 9],
    ]);
    assert.deepEqual(counts["clean.test.mjs"], ["0", "0", []]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// For every BMP character after `t.skip`: when JavaScript joins it into the
// name there is no marker, otherwise there is a marker or a parse error.
test("F-035 c: a character after a name is read as JavaScript reads it, or fails closed", () => {
  const wrong = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    let joins = false;
    try {
      joins =
        Object.keys(new Function(`return { skip${ch}: 1 }`)())[0] !== "skip";
    } catch {}
    const { errors, lines } = scan(`t.skip${ch}();`);
    const ok = joins
      ? lines.length === 0
      : lines.length === 1 || errors.length > 0;
    if (!ok) wrong.push(cp.toString(16));
  }
  assert.deepEqual(wrong, []);
});

test("F-035 c: a listed place passes once; the same line elsewhere, twice or a stale entry fails", () => {
  const mark = 'return t.skip("reason");';
  const allowed = [["a.test.mjs", mark]];
  assert.deepEqual(check([["a.test.mjs", `x;\n  ${mark}\n`]], allowed), []);
  assert.equal(
    check([["b.test.mjs", mark]], allowed).length,
    2,
    "elsewhere: unlisted and stale",
  );
  assert.match(
    check([["a.test.mjs", `${mark}\n${mark}`]], allowed).join("\n"),
    /found 2 times/,
  );
  assert.match(
    check([["a.test.mjs", "x;"]], allowed).join("\n"),
    /found 0 times/,
  );
  assert.match(
    check([["a.test.mjs", mark]], [...allowed, ...allowed]).join("\n"),
    /listed twice/,
  );
  assert.match(
    check([["a.test.mjs", "t.todo();"]], []).join("\n"),
    /a\.test\.mjs:1: skip, todo or only marker/,
  );
  for (const src of [
    "f({ a: 1 );",
    "f(]",
    "}",
    "const s = `open ${x",
    "x = (1;",
    "x;\n}",
  ])
    assert.match(
      check([["d/a.test.mjs", src]], []).join("\n"),
      /^d\/a\.test\.mjs:\d+: cannot be parsed, so it is not clean/,
      src,
    );
  assert.match(
    check([["d/a.test.mjs", "x;\n}"]], [])[0],
    /^d\/a\.test\.mjs:2: /,
  );
  assert.deepEqual(scan("const a: number = 1;", "a.test.ts"), {
    errors: [],
    lines: [],
  });
});
