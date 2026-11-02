// F-035 c (DAN-168): no node test that CI runs is skipped, left as todo or
// focused, except at the listed places. CI runs `node --test` over these
// directories (.github/workflows/ci.yml, "Engineering system unit tests"), and
// a marked test there passes silently. The scan reads the source with a small
// tokenizer, so a marker in a comment, a string or a regular expression is not
// one, while every syntactic form of it is: a member (`t.skip()`, `ctx?.todo`),
// a computed member or a string equal to the name (`t["skip"]`), and the name in
// key position (`{ skip: true }`, `{ only }`, `import { skip } from "node:test"`).
// Escaped identifiers (`t.sk\u0069p`) and method keys (`{ skip() {} }`) count too.
// Dynamically built names (`t["sk" + "ip"]`, `t[name]`) are out of reach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const DIRS = ["scripts/engineering", "scripts/orchestrator", "scripts/hooks"];
// Built from one string so that the scanner's own source holds no marker.
const NAMES = new Set("skip todo only runOnly".split(" "));

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
];

const KEYWORDS_BEFORE_EXPRESSION = new Set(
  "return typeof case do else in of new delete void throw instanceof yield await".split(
    " ",
  ),
);
const ID_START = /[A-Za-z_$\u0080-￿]/;
const ID_PART = /[A-Za-z0-9_$\u0080-￿]/;

function decode(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === "\n" || n === "\r") {
      if (n === "\r" && raw[i + 1] === "\n") i++;
      continue;
    }
    if (n === "x") {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (n === "u" && raw[i + 1] === "{") {
      const end = raw.indexOf("}", i);
      out += String.fromCodePoint(parseInt(raw.slice(i + 2, end), 16));
      i = end;
    } else if (n === "u") {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
      i += 4;
    } else
      out +=
        { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }[n] ??
        n;
  }
  return out;
}

// Tokens: { type: "id" | "str" | "punct" | "num" | "regex", value, line }.
// A template's `${...}` is tokenized as code; a template with substitutions
// is not a string value.
export function tokenize(src) {
  const tokens = [];
  const stack = [];
  let broken = false;
  let i = 0;
  let line = 1;
  const push = (type, value, at) => tokens.push({ type, value, line: at });
  const last = () => tokens[tokens.length - 1];
  const regexAllowed = () => {
    const t = last();
    if (!t) return true;
    if (t.type === "id") return KEYWORDS_BEFORE_EXPRESSION.has(t.value);
    // A regular expression cannot follow `++` or `--`, so `/` there divides.
    if (t.type === "punct")
      return ![")", "]", "}", "++", "--"].includes(t.value);
    return false;
  };
  const template = (fresh) => {
    // i is just past a backtick (fresh) or the closing `}` of a substitution.
    const at = line;
    let raw = "";
    for (;;) {
      const c = src[i];
      if (c === undefined) {
        stack.push("`");
        return push("tmpl", null, at);
      }
      if (c === "\\") {
        raw += c + (src[i + 1] ?? "");
        if (src[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        return push("tmpl", fresh ? decode(raw) : null, at);
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        stack.push("${");
        return push("tmpl", null, at);
      }
      if (c === "\n") line++;
      raw += c;
      i++;
    }
  };
  if (src.startsWith("#!")) while (i < src.length && src[i] !== "\n") i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/")
      while (i < src.length && src[i] !== "\n") i++;
    else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === "\n") line++;
    } else if (c === '"' || c === "'") {
      const at = line;
      let j = i + 1;
      let raw = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") {
          raw += src[j] + (src[j + 1] ?? "");
          if (src[j + 1] === "\n") line++;
          j += 2;
        } else raw += src[j++];
      }
      i = j + 1;
      push("str", decode(raw), at);
    } else if (c === "`") {
      i++;
      template(true);
    } else if (c === "/" && regexAllowed()) {
      // A regular expression ends on its own line; otherwise it was division.
      let j = i + 1;
      let inClass = false;
      let ok = false;
      for (; j < src.length && src[j] !== "\n"; j++) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) {
          ok = true;
          break;
        }
      }
      if (ok) {
        j++;
        while (j < src.length && ID_PART.test(src[j])) j++;
        push("regex", src.slice(i, j), line);
        i = j;
      } else {
        push("punct", "/", line);
        i++;
      }
    } else if (ID_START.test(c) || (c === "\\" && src[i + 1] === "u")) {
      // An identifier may spell a letter as \uXXXX or \u{X}; its name is the decoded text.
      let j = i;
      while (
        j < src.length &&
        (ID_PART.test(src[j]) || (src[j] === "\\" && src[j + 1] === "u"))
      ) {
        if (src[j] !== "\\") j++;
        else if (src[j + 2] === "{")
          j = src.indexOf("}", j) === -1 ? src.length : src.indexOf("}", j) + 1;
        else j += 6;
      }
      push("id", decode(src.slice(i, j)), line);
      i = j;
    } else if (
      /[0-9]/.test(c) ||
      (c === "." && /[0-9]/.test(src[i + 1] ?? ""))
    ) {
      let j = i + 1;
      while (j < src.length && /[0-9A-Za-z_.]/.test(src[j])) j++;
      push("num", src.slice(i, j), line);
      i = j;
    } else if (
      c === "?" &&
      src[i + 1] === "." &&
      !/[0-9]/.test(src[i + 2] ?? "")
    ) {
      push("punct", "?.", line);
      i += 2;
    } else if (c === "." && src.startsWith("...", i)) {
      push("punct", "...", line);
      i += 3;
    } else if ((c === "+" || c === "-") && src[i + 1] === c) {
      push("punct", c + c, line);
      i += 2;
    } else {
      if (c === "{" || c === "(" || c === "[") stack.push(c);
      else if (c === "}" && stack[stack.length - 1] === "${") {
        stack.pop();
        i++;
        template(false);
        continue;
      } else if (c === "}" || c === ")" || c === "]") {
        if (stack.pop() !== { "}": "{", ")": "(", "]": "[" }[c]) broken = true;
      }
      push("punct", c, line);
      i++;
    }
  }
  // An unbalanced end means the tokenizer lost track (a misread string,
  // template or regular expression) and could have hidden a marker.
  tokens.balanced = !broken && stack.length === 0;
  return tokens;
}

// True when the parenthesis at tokens[open] closes and a `{` follows it.
function bodyAfter(tokens, open) {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const v = tokens[k].type === "punct" ? tokens[k].value : null;
    if (v === "(") depth++;
    else if (v === ")" && --depth === 0)
      return tokens[k + 1]?.type === "punct" && tokens[k + 1].value === "{";
  }
  return false;
}

// Lines (1-based) holding a marker.
export function markers(src) {
  const tokens = tokenize(src);
  const found = new Set();
  const braces = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    if (t.type === "punct" && "{([".includes(t.value)) braces.push(t.value);
    else if (t.type === "punct" && "})]".includes(t.value)) braces.pop();
    const named =
      (t.type === "id" && NAMES.has(t.value)) ||
      ((t.type === "str" || t.type === "tmpl") && NAMES.has(t.value));
    if (!named) continue;
    if (t.type !== "id") {
      found.add(t.line);
      continue;
    }
    const keyAt = (p) =>
      p?.type === "punct" && (p.value === "{" || p.value === ",");
    if (prev?.type === "punct" && (prev.value === "." || prev.value === "?."))
      found.add(t.line);
    // A method, getter or setter key (`{ skip() {} }`, `{ get only() {} }`): the
    // parameter list is followed by a body, which a call in a block never is.
    else if (
      braces[braces.length - 1] === "{" &&
      next?.value === "(" &&
      (keyAt(prev) ||
        (["get", "set", "async"].includes(prev?.value) &&
          keyAt(tokens[k - 2])) ||
        (prev?.value === "*" && keyAt(tokens[k - 2]))) &&
      bodyAfter(tokens, k + 1)
    )
      found.add(t.line);
    else if (
      braces[braces.length - 1] === "{" &&
      prev?.type === "punct" &&
      (prev.value === "{" || prev.value === ",") &&
      (next?.type === "punct"
        ? [":", ",", "}", "="].includes(next.value)
        : next?.value === "as")
    )
      found.add(t.line);
  }
  return [...found].sort((a, b) => a - b);
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
    if (!tokenize(src).balanced)
      problems.push(`${file}: the scanner cannot read this file to the end`);
    const lines = src.split(/\r?\n/);
    for (const n of markers(src)) {
      const key = `${file}\n${lines[n - 1].trim()}`;
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

const POSITIVE = [
  ['t.skip("x");', [1]],
  ["ctx.skip?.();", [1]],
  ["ctx?.todo();", [1]],
  ['test.only("x", () => {});', [1]],
  ['describe.skip("x", () => {});', [1]],
  ['it.todo("x");', [1]],
  ["t.runOnly(true);", [1]],
  ["t\n  .skip();", [2]],
  ["t./* c */skip();", [1]],
  ['test("x", {\n  timeout: 1,\n  skip: true,\n}, () => {});', [3]],
  ['test("x", { "skip": 1 }, () => {});', [1]],
  ["test('x', { 'todo': 1 }, () => {});", [1]],
  ['test("x", { ["only"]: 1 }, () => {});', [1]],
  ['const skip = 1; test("x", { skip }, () => {});', [1]],
  ["const { skip } = t;", [1]],
  ['import { only } from "node:test";', [1]],
  ['import { skip as s } from "node:test";', [1]],
  ['t["skip"]();', [1]],
  ["t[`todo`]();", [1]],
  ['t["\\x73kip"]();', [1]],
  ['const name = "skip";', [1]],
  ["const f = `${t.skip()}`;", [1]],
  ["const f = `a ${`${t.todo()}`} b`;", [1]],
  ["x = a / b; t.skip();", [1]],
  ["t.sk\\u0069p();", [1]],
  ['test("x", { sk\\u{69}p: true }, () => {});', [1]],
  ['test("x", { skip() { return true; } }, () => {});', [1]],
  ['test("x", { get only() { return true; } }, () => {});', [1]],
  ['test("x", { a: 1, async todo() {} }, () => {});', [1]],
  ['test("x", { *skip() {} }, () => {});', [1]],
  ['n++ / 2; t.skip("r"); /x/.test("x");', [1]],
  ["n-- / 2; t.todo(); /x/;", [1]],
];
const NEGATIVE = [
  "// t.skip() in a comment",
  "/* test.only */",
  'const s = "skip the step";',
  "const only = (row) => row; only(1);",
  "if (x) { only(1); }",
  "const re = /\\.skip\\b|[{,]\\s*only:/;",
  'run(["--test-skip-pattern", "x"]);',
  "const t = `skip ${x} only`;",
  "const t = `${x}skip`;",
  'test("only the root counts", () => {});',
  "const skipped = state.skipped;",
  "const o = { onlyIf: 1, skipCount: 2 };",
  "function f() { only(1); }",
  "if (x) { only(1) }",
  "const \\u0073kipped = 1;",
  "a = b + +/skip/.source;",
];

test("F-035 c: the scanner finds every marker form and nothing else", () => {
  for (const [src, lines] of POSITIVE)
    assert.deepEqual(markers(src), lines, src);
  for (const src of NEGATIVE) assert.deepEqual(markers(src), [], src);
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
  ])
    assert.match(
      check([["a.test.mjs", src]], []).join("\n"),
      /cannot read this file to the end/,
      src,
    );
});
