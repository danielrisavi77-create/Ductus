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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

// `of` is not here: it is a keyword only in a for-of head (see `ofKeyword`).
const KEYWORDS_BEFORE_EXPRESSION = new Set(
  "return typeof case do else in new delete void throw instanceof yield await".split(
    " ",
  ),
);
// A statement follows the `)` of these heads, so `/` there starts a regex.
const HEADS = new Set("if while for with".split(" "));
// JavaScript line terminators; a line comment or a regular expression ends on any.
const LINE_END = "\n\r\u2028\u2029";
// The JavaScript identifier classes; a Unicode space or line end is in neither.
const ID_START = /^[\p{ID_Start}$_]$/u;
const ID_PART = /^[\p{ID_Continue}$\u200C\u200D]$/u;
// Code units taken by the identifier character at src[i] (2 when astral), or 0.
function idChar(src, i, re) {
  const cp = src.codePointAt(i);
  if (cp === undefined) return 0;
  const ch = String.fromCodePoint(cp);
  return re.test(ch) ? ch.length : 0;
}
const member = (t) =>
  t?.type === "punct" && (t.value === "." || t.value === "?.");

// The cooked text of a string or template, or null when an escape is invalid
// (allowed in a tagged template such as String.raw`\u{110000}`).
const HEX = /^[0-9A-Fa-f]+$/;
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
    if (LINE_END.includes(n)) {
      if (n === "\r" && raw[i + 1] === "\n") i++;
      continue;
    }
    if (n === "x" || (n === "u" && raw[i + 1] !== "{")) {
      const hex = raw.slice(i + 1, i + (n === "x" ? 3 : 5));
      if (hex.length !== (n === "x" ? 2 : 4) || !HEX.test(hex)) return null;
      out += String.fromCharCode(parseInt(hex, 16));
      i += hex.length;
    } else if (n === "u") {
      const end = raw.indexOf("}", i);
      const hex = end === -1 ? "" : raw.slice(i + 2, end);
      if (!HEX.test(hex) || parseInt(hex, 16) > 0x10ffff) return null;
      out += String.fromCodePoint(parseInt(hex, 16));
      i = end;
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
  // Stack depths at which a class body `{` is expected; an entry ends at that
  // brace, or when `class` turns out not to start a class (see `dropStale`).
  const classHeads = [];
  // Index of the latest `class` token; a `(` right after it names a method.
  let classAt = -1;
  let broken = false;
  let i = 0;
  let line = 1;
  // A line terminator (any of LINE_END) since the previous token; ASI needs it.
  let gapEnd = false;
  const push = (type, value, at, extra) => {
    tokens.push({ type, value, line: at, nl: gapEnd, ...extra });
    gapEnd = false;
  };
  const last = () => tokens[tokens.length - 1];
  const back = (n) => tokens[tokens.length - n];
  // `class` was a key or a name, not a class head: its container closed, or
  // `:`, `,`, `;` or `=` came at its depth before any body `{`.
  const dropStale = (c) => {
    while (
      classHeads.length &&
      (classHeads[classHeads.length - 1] > stack.length ||
        (":,;=".includes(c) &&
          classHeads[classHeads.length - 1] === stack.length))
    )
      classHeads.pop();
  };
  const regexAllowed = () => {
    const t = last();
    if (!t) return true;
    // An expression starts after `${`; a finished template is a value.
    if (t.type === "tmpl") return t.opens === true;
    // A keyword is one only outside member position: `o.in / 2` divides.
    if (t.type === "id")
      return t.value === "of"
        ? t.keyword === true
        : KEYWORDS_BEFORE_EXPRESSION.has(t.value) && !member(back(2));
    // After the `)` of an if, while, for or with head a statement starts;
    // A statement block also allows a regex; an object remains a value.
    if (t.type === "punct")
      return t.value === ")"
        ? t.head === true
        : t.value === "}"
          ? t.statement === true
          : !["]", "++", "--"].includes(t.value);
    return false;
  };
  // `of` is the for-of keyword when it follows the binding (a name, `]` or `}`;
  // not `const`, `let`, `var` or an operator keyword such as `in`, unless a
  // member) in a for head, before any `;`, once per head.
  const ofKeyword = () => {
    const top = stack[stack.length - 1];
    const p = last();
    if (!top?.forHead || top.semi || top.of) return false;
    const binding =
      (p?.type === "id" &&
        (member(back(2)) ||
          !(
            ["const", "let", "var"].includes(p.value) ||
            KEYWORDS_BEFORE_EXPRESSION.has(p.value)
          ))) ||
      (p?.type === "punct" && (p.value === "]" || p.value === "}"));
    return binding && (top.of = true);
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
        return push("tmpl", null, at, { opens: true });
      }
      if (c === "\n") line++;
      raw += c;
      i++;
    }
  };
  if (src.startsWith("#!"))
    while (i < src.length && !LINE_END.includes(src[i])) i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      gapEnd = true;
    } else if (/\s/.test(c)) {
      if (LINE_END.includes(c)) gapEnd = true;
      i++;
    } else if (c === "/" && src[i + 1] === "/")
      while (i < src.length && !LINE_END.includes(src[i])) i++;
    else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) {
        if (src[i] === "\n") line++;
        if (LINE_END.includes(src[i])) gapEnd = true;
      }
    } else if (c === '"' || c === "'") {
      const at = line;
      let j = i + 1;
      let raw = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") {
          raw += src[j] + (src[j + 1] ?? "");
          if (src[j + 1] === "\n") line++;
          else if (src[j + 1] === "\r" && src[j + 2] === "\n") {
            raw += "\n";
            line++;
            j++;
          }
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
      for (; j < src.length && !LINE_END.includes(src[j]); j++) {
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
        for (let n; (n = idChar(src, j, ID_PART)); ) j += n;
        push("regex", src.slice(i, j), line);
        i = j;
      } else {
        push("punct", "/", line);
        i++;
      }
    } else if (idChar(src, i, ID_START) || (c === "\\" && src[i + 1] === "u")) {
      // An identifier may spell a letter as \uXXXX or \u{X}; its name is the decoded text.
      let j = i;
      for (;;) {
        const n = idChar(src, j, ID_PART);
        if (n) j += n;
        else if (src[j] !== "\\" || src[j + 1] !== "u") break;
        else if (src[j + 2] === "{")
          j = src.indexOf("}", j) === -1 ? src.length : src.indexOf("}", j) + 1;
        else j += 6;
      }
      const name = decode(src.slice(i, j));
      // `#class` is a private name; directly in a class body, `class` at an
      // element start (after `{`, `;`, `}`, `static` or an ASI-ended field)
      // is a field name. Neither is a class head.
      const p = last();
      const elementName =
        (p?.type === "punct" && p.value === "#") ||
        (stack[stack.length - 1]?.classBody === true &&
          ((p?.type === "punct" && ["{", ";", "}"].includes(p.value)) ||
            (p?.type === "id" && p.value === "static" && !member(back(2))) ||
            (gapEnd && p !== undefined && valueEnd(p, back(2)))));
      if (
        name === "class" &&
        !elementName &&
        !member(last()) &&
        !/^\s*[:(]/.test(src.slice(j))
      ) {
        classHeads.push(stack.length);
        classAt = tokens.length;
      }
      push(
        "id",
        name,
        line,
        name === "of" && ofKeyword() ? { keyword: true } : undefined,
      );
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
      let extra;
      if (":,;=".includes(c)) dropStale(c);
      else if (c === "(" && classAt === tokens.length - 1) classHeads.pop();
      if (c === "(") {
        // A paren after `if`, `while`, `for`, `for await` or `with` (not a member) is a head.
        const kw = (t, before) => t?.type === "id" && !member(before);
        const forHead =
          (kw(back(1), back(2)) && back(1).value === "for") ||
          (back(1)?.value === "await" &&
            kw(back(2), back(3)) &&
            back(2).value === "for");
        const head =
          forHead || (kw(back(1), back(2)) && HEADS.has(back(1).value));
        stack.push({
          open: "(",
          head,
          forHead,
          semi: false,
          of: false,
          catchHead: kw(back(1), back(2)) && back(1).value === "catch",
        });
      } else if (c === "{") {
        const prev = last();
        const top = stack[stack.length - 1];
        const classBody = classHeads[classHeads.length - 1] === stack.length;
        if (classBody) classHeads.pop();
        const statement =
          !classBody &&
          (!prev ||
            (prev.type === "id" &&
              !member(back(2)) &&
              ["else", "do", "try", "catch", "finally"].includes(prev.value)) ||
            (prev.type === "punct" &&
              ((prev.value === ")" && (prev.head || prev.catchHead)) ||
                (prev.value === "}" && prev.statement) ||
                ((prev.value === "{" || prev.value === ";") &&
                  (!top || top.block)))));
        // Function/method bodies contain statements too, but their closing
        // brace is not sufficient evidence that the enclosing value ended.
        const block =
          statement ||
          (!classBody &&
            (prev?.value === ")" ||
              (prev?.value === ">" && back(2)?.value === "=")));
        stack.push({ open: "{", block, statement, classBody });
        extra = { classBody };
      } else if (c === "[") stack.push(c);
      else if (c === ";" && stack[stack.length - 1]?.forHead)
        stack[stack.length - 1].semi = true;
      else if (c === "}" && stack[stack.length - 1] === "${") {
        stack.pop();
        dropStale(c);
        i++;
        template(false);
        continue;
      } else if (c === "}" || c === ")" || c === "]") {
        const top = stack.pop();
        dropStale(c);
        const open = typeof top === "object" ? top.open : top;
        if (open !== { "}": "{", ")": "(", "]": "[" }[c]) broken = true;
        else if (c === ")")
          extra = { head: top.head, catchHead: top.catchHead };
        else if (c === "}") extra = { statement: top.statement };
      }
      push("punct", c, line, extra);
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

// True when an expression can end with token p (before is the token ahead of it).
function valueEnd(p, before) {
  if (p.type === "tmpl") return p.opens !== true;
  if (p.type === "id")
    return member(before) || !KEYWORDS_BEFORE_EXPRESSION.has(p.value);
  if (p.type === "punct") return [")", "]", "}", "++", "--"].includes(p.value);
  return true;
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
    if (t.type === "punct" && "{([".includes(t.value)) braces.push(t);
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
      braces[braces.length - 1]?.value === "{" &&
      next?.value === "(" &&
      (keyAt(prev) ||
        (["get", "set", "async"].includes(prev?.value) &&
          keyAt(tokens[k - 2])) ||
        (prev?.value === "*" &&
          (keyAt(tokens[k - 2]) ||
            (tokens[k - 2]?.value === "async" && keyAt(tokens[k - 3]))))) &&
      bodyAfter(tokens, k + 1)
    )
      found.add(t.line);
    // A class field (`skip = true;`) follows `{`, `;` or `}`, or a value
    // ending before a line terminator, where ASI closed the previous field.
    else if (
      braces[braces.length - 1]?.classBody &&
      ((prev?.type === "punct" && ["{", ";", "}"].includes(prev.value)) ||
        (t.nl && valueEnd(prev, tokens[k - 2]))) &&
      next?.type === "punct" &&
      ["=", ";", "}"].includes(next.value)
    )
      found.add(t.line);
    else if (
      braces[braces.length - 1]?.value === "{" &&
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
  ['o.of / 2; t.skip("r"); /x/.test("x");', [1]],
  ["o?.in / 2; t.todo(); /x/;", [1]],
  ['test("x", { async *skip() {} }, () => {});', [1]],
  ['// c\rt.skip("r");', [1]],
  ["// c\u2028t.todo();", [1]],
  ["// c\u2029t.only();", [1]],
  // A space or line end right after the name ends it (Unicode ones too).
  ['test.skip\u00A0("x", () => {});', [1]],
  ["test('x', t => t.skip\u2028('reason'));", [1]],
  ["t.skip\u2029();", [1]],
  ["t.skip\uFEFF();", [1]],
  ["t.todo\u3000();", [1]],
  ["t.only\u2003();", [1]],
  ["const a\u{1D465} = 1; t.skip();", [1]],
  // A template that ends, or has no substitution, is a value: `/` divides.
  ["const s = `${x}` / 2; t.skip(); /x/;", [1]],
  ["const s = `a` / 2; t.todo(); /x/;", [1]],
  // `of` is a keyword only in a for-of head, after the binding.
  ['const of = 2; of / 2; t.skip("r"); /x/.test("x");', [1]],
  ["for (a; of / 2; t.skip()) /x/;", [1]],
  ["for (x = of / 2;;) t.skip(); /x/;", [1]],
  ["for (x of of / 2) t.skip(); /x/;", [1]],
  ["for (x in of / 2) t.skip(); /x/;", [1]],
  ["for (typeof of / 2;;) t.todo(); /x/;", [1]],
  ["for (o.of / 2; t.skip(); ) /x/;", [1]],
  // Only the `)` of an if, while, for or with head starts a statement.
  ["f(x) / 2; t.skip(); /x/;", [1]],
  ["if ((a) / 2) t.skip(); /x/;", [1]],
  ["if (a) (b) / 2; t.skip(); /x/;", [1]],
  ["o.if(x) / 2; t.skip(); /x/;", [1]],
  ["o.for(x) / 2; t.todo(); /x/;", [1]],
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
  "const m = String.raw`\\u{110000}`;",
  "const m = String.raw`\\xZZ \\u12`;",
  "t.skip\u200C();",
  "t.skip\u00E9();",
  "t.skip\u{1D465}();",
  "const \u{1D465}skip = 1;",
  "const s = `${/\\.skip/.source}`;",
  "const s = `a${x}b${/\\.only/.source}`;",
  "for (const x of /\\.skip/g.exec(s));",
  "for (const [a] of /\\.only/.exec(s));",
  "for (const { a } of /\\.todo/.exec(s));",
  "for await (const x of /\\.skip/.exec(s));",
  "for (let of of /\\.skip/.exec(s));",
  "for (x.of of /\\.todo/.exec(s));",
  "for (x.in of /\\.only/.exec(s));",
  'if (true) /\\.skip\\b/.test("x");',
  "while (x) /\\.only/.test(s);",
  "for (;;) /\\.todo/.exec(s);",
  "for await (const x of xs) /\\.skip/.exec(x);",
  "with (o) /\\.skip/.exec(s);",
];

test("F-035 c: the scanner finds every marker form and nothing else", () => {
  for (const [src, lines] of POSITIVE)
    assert.deepEqual(markers(src), lines, src);
  for (const src of NEGATIVE) assert.deepEqual(markers(src), [], src);
});

test("F-035 c: statement blocks allow regex without hiding later markers or division", () => {
  for (const block of [
    "if (true) {}",
    "if (true) { {} }",
    "while (false) {}",
    "for (;false;) {}",
    "{}",
    "try {} catch (e) {}",
    "try {} catch {}",
    "try {} finally {}",
  ]) {
    const src = `${block} /\\.skip\\b/.test('x');`;
    new Function(src)();
    assert.deepEqual(check([["a.test.mjs", src]], []), [], src);
    const marked = `${src}\nt.skip('reason');`;
    new Function("t", marked);
    assert.deepEqual(markers(marked), [2], marked);
  }
  for (const value of ["{}", "{ a: {} }", "function () {}", "() => {}"]) {
    const src = `const x = (${value}) / 2;\nt.skip('reason'); /x/;`;
    new Function("t", src);
    assert.deepEqual(markers(src), [2], src);
  }
  const direct = "const x = {} / 2;\nt.skip('reason'); /x/;";
  new Function("t", direct);
  assert.deepEqual(markers(direct), [2]);
});

test("F-035 c: all line continuations cook static names and preserve non-names", () => {
  for (const end of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    for (const quote of ["'", '"', "`"]) {
      for (const name of NAMES) {
        const raw = `${name.slice(0, 2)}\\${end}${name.slice(2)}`;
        const key = `${quote}${raw}${quote}`;
        assert.equal(new Function(`return ${key}`)(), name);
        const src = `const key = ${key};\nconst after = 1;`;
        assert.deepEqual(markers(src), [1], src);
        assert.equal(tokenize(src).balanced, true, src);
        for (const suffix of ["Count", " x"]) {
          const other = `${quote}${raw}${suffix}${quote}`;
          assert.equal(new Function(`return ${other}`)(), name + suffix);
          assert.deepEqual(
            check([["a.test.mjs", `const key = ${other};`]], []),
            [],
          );
        }
        const comment = `/* ${key} */`;
        new Function(comment)();
        assert.deepEqual(check([["a.test.mjs", comment]], []), []);
      }
    }
  }
  // Regex uses escaped code points: a literal line terminator is invalid there.
  const regex = String.raw`/sk\\u2028ip|sk\\u2029ip/.test('x');`;
  new Function(regex)();
  assert.deepEqual(check([["a.test.mjs", regex]], []), []);
});

test("F-035 c: public class fields remain keys after a preceding field", () => {
  for (const name of NAMES) {
    for (const prefix of ["", "timeout = 1000;\n"]) {
      const src = `class Options {\n${prefix}${name} = true;\n}`;
      assert.equal(
        new Function(`${src}; return new Options().${name};`)(),
        true,
      );
      assert.deepEqual(markers(src), [prefix ? 3 : 2], src);
      assert.equal(tokenize(src).balanced, true, src);
      const other = `class Options {\n${prefix}${name}Count = true;\n}`;
      new Function(other)();
      assert.deepEqual(check([["a.test.mjs", other]], []), []);
    }
    const local = `let ${name}; class Options { method() { const x = 1; ${name} = true; } }`;
    new Function(local)();
    assert.deepEqual(check([["a.test.mjs", local]], []), []);
  }
});

test("F-035 c: a class field after an ASI-ended field is still a key", () => {
  const ends = [
    "timeout = 1000",
    'label = "x"',
    "id = x",
    "call = f()",
    "list = [1]",
    "pattern = /a/",
    "text = `t`",
    "count = n++",
  ];
  const head = "const x = 1, f = () => 1; let n = 0;\n";
  for (const name of NAMES) {
    for (const end of ends) {
      const src = `${head}class Options {\n${end}\n${name} = true\n}`;
      assert.equal(
        new Function(`${src}; return new Options().${name};`)(),
        true,
      );
      assert.deepEqual(markers(src), [4], src);
      assert.equal(tokenize(src).balanced, true, src);
      const other = `${head}class Options {\n${end}\n${name}Count = true\n}`;
      new Function(other)();
      assert.deepEqual(check([["a.test.mjs", other]], []), []);
    }
    // The same lines in a method body assign a local.
    const local = `class Options { method() {\nlet ${name}\nconst y = 1\n${name} = true\n} }`;
    new Function(local)();
    assert.deepEqual(check([["a.test.mjs", local]], []), []);
  }
});

test("F-035 c: every JavaScript line terminator ends a class field for ASI", () => {
  // Diagnostics keep LF numbering; CR, U+2028 and U+2029 still end the field.
  const seps = ["\n", "\r\n", "\r", "\u2028", "\u2029"];
  for (const sep of [...seps, "/*\r*/", "/*\u2028*/", "// c\u2029"]) {
    for (const name of NAMES) {
      const src = `class Options {\ntimeout = 1000${sep}${name} = true\n}`;
      assert.equal(
        new Function(`${src}; return new Options().${name};`)(),
        true,
      );
      assert.deepEqual(markers(src), [2 + sep.split("\n").length - 1], src);
      const other = `class Options {\ntimeout = 1000${sep}${name}Count = true\n}`;
      new Function(other)();
      assert.deepEqual(check([["a.test.mjs", other]], []), [], other);
    }
  }
});

test("F-035 c: a `class` key or name does not make a later brace a class body", () => {
  const scripts = (name) => [
    `const o = { class /* c */ : 1, m() { let ${name}; ${name} = true; } };`,
    `const o = { class /* c */ () {}, m() { let ${name}; ${name} = true; } };`,
    `class A { class = 1\nm() { let ${name}; ${name} = true; } }`,
    `class A { class; m() { let ${name}; ${name} = true; } }`,
    // A field named `class` ended by ASI (any line terminator) is no head.
    `class A { class\nm() { let ${name}; ${name} = true; } }`,
    `class A { class\u2028m() { let ${name}; ${name} = true; } }`,
    `class A { class\r\nm() { let ${name}; ${name} = true; } }`,
    `class A { timeout = 1\nclass\nm() { let ${name}; ${name} = true; } }`,
    `class A { static class\nm() { let ${name}; ${name} = true; } }`,
    `class A { #class\nm() { let ${name}; ${name} = true; } }`,
  ];
  const modules = (name) => [
    `import { class as c } from "node:test";\nfunction g() { if (c) { let ${name}; ${name} = true; } }`,
    `const x = 1;\nexport { x as class };\nfunction g() { if (x) { let ${name}; ${name} = true; } }`,
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-scan-"));
  try {
    for (const name of NAMES) {
      for (const [i, src] of [...scripts(name), ...modules(name)].entries()) {
        if (i < scripts(name).length) new Function(src)();
        else {
          const file = path.join(dir, "m.mjs");
          fs.writeFileSync(file, src);
          const run = spawnSync(process.execPath, ["--check", file]);
          assert.equal(run.status, 0, `${src}\n${run.stderr}`);
        }
        assert.deepEqual(markers(src), [], src);
        assert.equal(tokenize(src).balanced, true, src);
        // A real class after it is still read as one, and a later block still
        // allows a regex, so the marker after it stays visible.
        const lines = src.split("\n").length;
        const after = `${src}\nclass Options {\n${name} = true;\n}`;
        assert.deepEqual(markers(after), [lines + 2], after);
        const hidden = `${src}\nf(() => { x(); {} /'/.test(s); t.${name}(); });`;
        assert.deepEqual(markers(hidden), [lines + 1], hidden);
        assert.equal(tokenize(hidden).balanced, true, hidden);
      }
      const extended = `const f = (a) => a;\nclass Options extends f(Object, 1) {\n${name} = true;\n}`;
      assert.equal(
        new Function(`${extended}; return new Options().${name};`)(),
        true,
      );
      assert.deepEqual(markers(extended), [3], extended);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("F-035 c: an ASI-ended `class` field hides no later marker", () => {
  for (const name of NAMES) {
    for (const sep of ["\n", "\r", "\u2028", "\u2029"]) {
      // The method body is a block, so `/'/` is a regex and the marker shows.
      for (const field of ["class", "#class", "static class"]) {
        const src = `class A { ${field}${sep}m(t, s) { {} /'/.test(s); t.${name}(); } }`;
        new Function(src)();
        assert.deepEqual(markers(src), [sep === "\n" ? 2 : 1], src);
        assert.equal(tokenize(src).balanced, true, src);
      }
    }
    // A class expression in a field initializer is still a class.
    for (const init of ["= class {", "=\nclass {", "= a ||\nclass {"]) {
      const src = `const a = 0;\nclass A { x ${init}\n${name} = true\n} }`;
      new Function(src)();
      const at = src.split("\n").findIndex((l) => l.startsWith(name)) + 1;
      assert.deepEqual(markers(src), [at], src);
    }
  }
});

test("F-035 c: node:test skips a test whose options field follows an ASI-ended field", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-scan-"));
  // The first name is the skip option; the runner here must not see itself as a parent.
  const [skipName] = NAMES;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const [field, skipped, sep] of [
      [skipName, 1, "\n"],
      [skipName, 1, "\u2028"],
      [`${skipName}Count`, 0, "\n"],
    ]) {
      const src = `import test from "node:test";\nclass Options {\ntimeout = 1000${sep}${field} = true\n}\ntest("synthetic", new Options(), () => {});\n`;
      const file = path.join(dir, "options.test.mjs");
      fs.writeFileSync(file, src);
      const run = spawnSync(
        process.execPath,
        ["--test", "--test-reporter=tap", file],
        { encoding: "utf8", env },
      );
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, new RegExp(`^# skipped ${skipped}$`, "m"));
      assert.match(run.stdout, new RegExp(`^# pass ${1 - skipped}$`, "m"));
      const at = sep === "\n" ? 4 : 3;
      assert.deepEqual(markers(src), skipped ? [at] : [], src);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// JavaScript itself decides whether `a<c>b` is one identifier.
function joinsName(c) {
  try {
    return new Function(`a${c}b`, "").length === 1;
  } catch {
    return false;
  }
}

test("F-035 c: a character right after the name ends it exactly when JavaScript says so", () => {
  const wrong = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCharCode(cp);
    const want = joinsName(c) ? [] : [1];
    const got = markers(`t.skip${c}();`);
    if (got.join() !== want.join()) wrong.push(cp.toString(16));
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
  ])
    assert.match(
      check([["a.test.mjs", src]], []).join("\n"),
      /cannot read this file to the end/,
      src,
    );
});
