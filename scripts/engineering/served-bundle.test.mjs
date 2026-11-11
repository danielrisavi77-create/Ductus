import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { checkServed, checkServedSet, listServed, servedUrl, wasmCustomSections } from "./served-bundle.mjs";

// DAN-185 (M11.9-P02): what the production image serves to the browser holds
// no source map, no reference to one and no SourceMap header. Input classes of
// the contract on #1091 (w185a UGOVOR). The data below is invented.
const script = resolve(dirname(fileURLToPath(import.meta.url)), "served-bundle.mjs");
const CHUNK = "/_next/static/chunks/main-0a1b2c.js";
const codes = (findings) => [...new Set(findings.map((finding) => finding.code))].sort();
const entry = (overrides = {}) => ({ url: CHUNK, status: "200", mapStatus: "404", body: Buffer.from("self.x=1;"), headers: "HTTP/1.1 200 OK\r\ncontent-type: application/javascript\r\n", ...overrides });

const PATHS = [
  ["static chunk", "/app/.next/static/chunks/main-0a1b2c.js", "/_next/static/chunks/main-0a1b2c.js"],
  ["dynamic segment is encoded", "/app/.next/static/chunks/app/zadatak/[id]/page-1.js", "/_next/static/chunks/app/zadatak/%5Bid%5D/page-1.js"],
  ["public file", "/app/public/motivi/city.webp", "/motivi/city.webp"],
  ["public file with a space", "/app/public/a b.txt", "/a%20b.txt"],
  ["outside both roots", "/app/.next/server/app/page.js", null],
  ["root only", "/app/public/", null],
  ["parent segment", "/app/public/../.env", null],
  ["current segment", "/app/.next/static/./x.js", null],
  ["empty segment", "/app/public//x.txt", null],
  ["relative path", "public/x.txt", null],
  ["prefix without slash", "/app/publicity/x.txt", null],
  ["control character", "/app/public/x\ny.txt", null],
];
for (const [name, path, url] of PATHS) {
  test(`servedUrl: ${name}`, () => assert.equal(servedUrl(path), url));
}

const FILES = [
  ["clean chunk", {}, []],
  [".map file", { url: "/_next/static/chunks/main.js.map" }, ["source-map-file"]],
  [".css.map file", { url: "/_next/static/css/app.css.map" }, ["source-map-file"]],
  [".mjs.map file", { url: "/x.mjs.map" }, ["source-map-file"]],
  ["upper-case .MAP", { url: "/x.MAP" }, ["source-map-file"]],
  ["name map without a dot", { url: "/sitemap" }, []],
  [".mapx is not a map", { url: "/x.mapx" }, []],
  ["//# reference", { body: Buffer.from("self.x=1;\n//# sourceMappingURL=main.js.map\n") }, ["source-map-reference"]],
  ["//@ reference", { body: Buffer.from("self.x=1;\n//@ sourceMappingURL=main.js.map") }, ["source-map-reference"]],
  ["CSS comment reference", { url: "/_next/static/css/a.css", body: Buffer.from("a{b:c}\n/*# sourceMappingURL=a.css.map */") }, ["source-map-reference"]],
  ["spaces and tab around =", { body: Buffer.from("//#\tsourceMappingURL \t= x.map") }, ["source-map-reference"]],
  ["form feed after #", { body: Buffer.from("x\n//#\fsourceMappingURL=data:application/json;base64,e30=") }, ["source-map-reference"]],
  ["vertical tab after @", { body: Buffer.from("x\n//@\vsourceMappingURL=x.map") }, ["source-map-reference"]],
  ["UTF-8 no-break space after #", { body: Buffer.from("x\n//#\u00a0sourceMappingURL=x.map", "utf8") }, ["source-map-reference"]],
  ["UTF-8 BOM, line separator and ideographic space", { body: Buffer.from("/*#\ufeff\u2028\u3000sourceMappingURL=x.map */", "utf8") }, ["source-map-reference"]],
  ["inline data map", { body: Buffer.from("x\n//# sourceMappingURL=data:application/json;base64,e30=") }, ["source-map-reference"]],
  ["CRLF line ends", { body: Buffer.from("x\r\n//# sourceMappingURL=x.map\r\n") }, ["source-map-reference"]],
  ["reference in the middle", { body: Buffer.from("a;//# sourceMappingURL=x.map\nb;c;") }, ["source-map-reference"]],
  ["other letter case", { body: Buffer.from("//# SOURCEMAPPINGURL=x.map") }, ["source-map-reference"]],
  ["word without # or @", { body: Buffer.from("const sourceMappingURL = 1;") }, []],
  ["empty body", { body: Buffer.alloc(0) }, []],
  ["binary body", { url: "/motivi/city.webp", mapStatus: "-", body: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x80, 0x0a]) }, []],
  ["reference inside binary", { url: "/f.woff2", mapStatus: "-", body: Buffer.concat([Buffer.from([0, 0xff]), Buffer.from("//# sourceMappingURL=x")]) }, ["source-map-reference"]],
  ["SourceMap header", { headers: "HTTP/1.1 200 OK\r\nSourceMap: /x.map\r\n" }, ["source-map-header"]],
  ["X-SourceMap header", { headers: "HTTP/1.1 200 OK\r\nX-SourceMap: /x.map\r\n" }, ["source-map-header"]],
  ["header in lower case", { headers: "HTTP/1.1 200 OK\r\nx-sourcemap:/x.map\r\n" }, ["source-map-header"]],
  ["header name inside a value", { headers: "HTTP/1.1 200 OK\r\nvary: SourceMap: no\r\n" }, []],
  ["map next to the chunk answers 200", { mapStatus: "200" }, ["source-map-served"]],
  ["map next to the chunk redirects", { mapStatus: "307" }, ["source-map-served"]],
  ["map not probed", { mapStatus: "-" }, []],
  ["file not served", { status: "404" }, ["served-status"]],
  ["everything at once", { url: "/a.js.map", status: "500", mapStatus: "200", body: Buffer.from("//# sourceMappingURL=a"), headers: "SourceMap: a\r\n" },
    ["served-status", "source-map-file", "source-map-header", "source-map-reference", "source-map-served"]],
];
for (const [name, overrides, expected] of FILES) {
  test(`checkServed: ${name}`, () => assert.deepEqual(codes(checkServed(entry(overrides))), expected));
}

// Encodings (#1752 QA c.6729113556): a browser decodes a script or stylesheet
// by its BOM or its charset, and UTF-16 is the only encoding it may apply that
// is not ASCII compatible, so the marker counts in every one of them.
const BOM8 = Buffer.from([0xef, 0xbb, 0xbf]);
const utf16be = (text) => Buffer.from(text, "utf16le").swap16();
const ENCODINGS = [
  ["UTF-8", (text) => Buffer.from(text, "utf8")],
  ["UTF-8 with BOM", (text) => Buffer.concat([BOM8, Buffer.from(text, "utf8")])],
  ["UTF-16LE with BOM", (text) => Buffer.from(`\ufeff${text}`, "utf16le")],
  ["UTF-16BE with BOM", (text) => utf16be(`\ufeff${text}`)],
  ["UTF-16LE without BOM", (text) => Buffer.from(text, "utf16le")],
  ["UTF-16BE without BOM", (text) => utf16be(text)],
  ["invalid UTF-8 bytes around the text", (text) => Buffer.concat([Buffer.from([0xc3, 0x28, 0xff]), Buffer.from(text), Buffer.from([0xe2, 0x82])])],
  ["UTF-16LE with a lone surrogate", (text) => Buffer.from(`\ufeff\ud800${text}\udc00`, "utf16le")],
  ["UTF-16BE with a lone surrogate", (text) => utf16be(`\ufeff\udfff${text}\ud800`)],
  ["UTF-16LE of odd length", (text) => Buffer.concat([Buffer.from(`\ufeff${text}`, "utf16le"), Buffer.from([0x41])])],
  ["UTF-16BE of odd length", (text) => Buffer.concat([utf16be(`\ufeff${text}`), Buffer.from([0x00])])],
  ["cut off BOM before UTF-16LE", (text) => Buffer.concat([Buffer.from([0xff]), Buffer.from(text, "utf16le")])],
];
const BODIES = [
  ["CSS", "/x.css", "a{color:red}\n/*# sourceMappingURL=data:application/json;base64,e30= */\n", "a{color:red}\n/* sourceMapping */\n"],
  ["JS", "/_next/static/chunks/x.js", "self.x=1;\n//# sourceMappingURL=x.js.map\n", "self.x=1;\n// sourceMappingURL is a word\n"],
  ["JS with an ideographic space", "/x.mjs", "self.x=1;\n//@\u3000sourceMappingURL\u00a0=x.map", "self.x=1;\n//@\u3000source=x"],
];
for (const [encoding, encode] of ENCODINGS) {
  for (const [kind, url, marked, clean] of BODIES) {
    test(`checkServed encoding: ${kind} in ${encoding} with the marker`, () => {
      assert.deepEqual(codes(checkServed(entry({ url, body: encode(marked) }))), ["source-map-reference"]);
    });
    test(`checkServed encoding: ${kind} in ${encoding} without the marker`, () => {
      assert.deepEqual(codes(checkServed(entry({ url, body: encode(clean) }))), []);
    });
  }
}

// WebAssembly: a custom section named sourceMappingURL (ECMA-426 §11.1.2.3),
// built byte by byte; the module bodies are invented.
const leb = (n) => (n < 0x80 ? [n] : [(n & 0x7f) | 0x80, ...leb(n >>> 7)]);
const vec = (bytes) => [...leb(bytes.length), ...bytes];
const section = (id, payload) => Buffer.from([id, ...vec([...payload])]);
const custom = (name, data) => section(0, [...vec([...Buffer.from(name)]), ...Buffer.from(data)]);
const wasm = (...sections) => Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), ...sections]);
const MAP_SECTION = custom("sourceMappingURL", Buffer.from(vec([...Buffer.from("data:application/json;base64,e30=")])));
const TYPE_SECTION = section(1, [0x01, 0x60, 0x00, 0x00]);
const WASM = [
  ["module with an inline map section", wasm(MAP_SECTION), ["source-map-reference"]],
  ["map section after the type section", wasm(TYPE_SECTION, custom("name", [0x00]), custom("sourceMappingURL", vec([...Buffer.from("debug.wasm.map")]))), ["source-map-reference"]],
  ["map section longer than 127 bytes", wasm(custom("sourceMappingURL", vec([...Buffer.from(`data:application/json;base64,${"A".repeat(200)}`)]))), ["source-map-reference"]],
  ["empty module", wasm(), []],
  ["only a name section", wasm(TYPE_SECTION, custom("name", [0x00, 0x01, 0x00])), []],
  ["the word only inside a data section", wasm(section(11, [...Buffer.from("sourceMappingURL")])), []],
  ["a section with a longer name", wasm(custom("sourceMappingURLs", [0x00])), []],
  ["cut off module with the word", wasm(MAP_SECTION).subarray(0, 30), ["source-map-reference"]],
  ["the word without the module header", Buffer.concat([Buffer.from([0x00, 0x61, 0x73]), MAP_SECTION]), []],
];
for (const [name, body, expected] of WASM) {
  test(`checkServed WebAssembly: ${name}`, () => assert.deepEqual(codes(checkServed(entry({ url: "/debug.wasm", mapStatus: "404", body }))), expected));
}

test("wasmCustomSections: names in order; a cut off or overlong section does not parse", () => {
  assert.deepEqual(wasmCustomSections(wasm(TYPE_SECTION, custom("name", []), MAP_SECTION)), ["name", "sourceMappingURL"]);
  assert.equal(wasmCustomSections(wasm(MAP_SECTION).subarray(0, 12)), null);
  assert.equal(wasmCustomSections(wasm(Buffer.from([0x00, 0x02, 0x05, 0x61]))), null);
  assert.equal(wasmCustomSections(wasm(Buffer.from([0x00, 0x80]))), null);
});

test("checkServedSet: an empty set or one without a chunk never passes", () => {
  assert.deepEqual(codes(checkServedSet([])), ["served-empty"]);
  assert.deepEqual(codes(checkServedSet([entry({ url: "/motivi/city.webp", mapStatus: "-" })])), ["served-empty"]);
  assert.deepEqual(codes(checkServedSet([entry({ url: "/_next/static/chunks/a.css" })])), ["served-empty"]);
  assert.deepEqual(checkServedSet([entry(), entry({ url: "/motivi/city.webp", mapStatus: "-" })]), []);
});

// No "g": the alphabet cannot spell the marker word in any letter case.
const SAFE = fc.string({ unit: fc.constantFrom(..."abcdefhijklmnopqrstuvwxyz0123456789 ;=(){}\n\t/*.\"'#@") });
// Every ECMAScript white space and line terminator that \s covers (ECMA-426 §11.1.2.1.1).
const SPACE = fc.string({ unit: fc.constantFrom(..."\t\n\v\f\r \u00a0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"), maxLength: 3 });
const MARK = fc.tuple(fc.constantFrom("//", "/*", ""), fc.constantFrom("#", "@"), SPACE, SPACE).map(([open, sign, before, after]) => `${open}${sign}${before}sourceMappingURL${after}=x.map`);

test("fast-check: a body without the marker word has no finding; an inserted marker always has", () => {
  fc.assert(fc.property(SAFE, (body) => {
    assert.deepEqual(checkServed(entry({ body: Buffer.from(body) })), []);
  }));
  fc.assert(fc.property(SAFE, MARK, SAFE, (before, mark, after) => {
    assert.deepEqual(codes(checkServed(entry({ body: Buffer.from(before + mark + after) }))), ["source-map-reference"]);
  }));
});

test("fast-check: UTF-16 text with an inserted marker always has a finding, without it never", () => {
  const encode = fc.constantFrom((t) => Buffer.from(t, "utf16le"), (t) => utf16be(t), (t) => Buffer.from(`\ufeff${t}`, "utf16le"), (t) => utf16be(`\ufeff${t}`));
  fc.assert(fc.property(encode, SAFE, (enc, body) => {
    assert.deepEqual(checkServed(entry({ body: enc(body) })), []);
  }));
  fc.assert(fc.property(encode, SAFE, MARK, SAFE, (enc, before, mark, after) => {
    assert.deepEqual(codes(checkServed(entry({ body: enc(before + mark + after) }))), ["source-map-reference"]);
  }));
});

test("fast-check: a module is flagged exactly when one of its custom sections is the map section", () => {
  const sections = fc.array(fc.tuple(SAFE, SAFE).map(([name, data]) => custom(name, Buffer.from(data))), { maxLength: 5 });
  fc.assert(fc.property(sections, fc.nat(), fc.boolean(), (list, at, withMap) => {
    const all = withMap ? [...list.slice(0, at % (list.length + 1)), MAP_SECTION, ...list.slice(at % (list.length + 1))] : list;
    const expected = withMap ? ["source-map-reference"] : [];
    assert.deepEqual(codes(checkServed(entry({ url: "/debug.wasm", body: wasm(...all) }))), expected);
  }));
});

test("fast-check: a served path never maps outside its root or keeps a parent segment", () => {
  const segment = fc.constantFrom("a", "b.js", "..", ".", "", "[id]", "x y", "%2e%2e");
  fc.assert(fc.property(fc.constantFrom("/app/.next/static/", "/app/public/"), fc.array(segment, { minLength: 1, maxLength: 5 }), (root, parts) => {
    const url = servedUrl(root + parts.join("/"));
    const bad = parts.some((part) => part === "" || part === "." || part === "..");
    if (bad) return assert.equal(url, null);
    assert.ok(url.startsWith(root.includes("static") ? "/_next/static/" : "/"));
    assert.ok(!decodeURIComponent(url).split("/").includes(".."));
    assert.equal(url.split("/").length - 1, parts.length + (root.includes("static") ? 2 : 0));
  }));
});

// Entry kinds (#1752 review c.6729118211): Next follows a symbolic link under a
// served root, so a link, wherever it points, and any entry that is neither a
// file nor a directory fails the check instead of being skipped. Real trees on
// disk, laid out as the container's /app; the file contents are invented.
// Run this file on Linux, macOS or WSL (CI runs on Linux). The link rows below
// and the leak.map test further down use symlinkSync, which fails with EPERM on
// Windows without developer mode; the FIFO row needs the mkfifo command, which
// Windows does not have (ENOENT) even with developer mode. That is the
// platform, not the check, and none of them is skipped (audit pass 14, item 2).
const STATIC = "app/.next/static";
const PUBLIC = "app/public";
const tree = (build) => {
  const dir = mkdtempSync(join(tmpdir(), "served-tree-"));
  mkdirSync(join(dir, STATIC, "chunks"), { recursive: true });
  mkdirSync(join(dir, PUBLIC), { recursive: true });
  writeFileSync(join(dir, STATIC, "chunks", "main.js"), "self.x=1;");
  writeFileSync(join(dir, "outside.txt"), "outside");
  build(dir);
  return dir;
};
const BASE = ["/app/.next/static/chunks/main.js"];
const KINDS = [
  ["regular file", (d) => writeFileSync(join(d, PUBLIC, "a.txt"), "a"), ["/app/public/a.txt"], []],
  ["regular file in a subdirectory", (d) => { mkdirSync(join(d, PUBLIC, "motivi")); writeFileSync(join(d, PUBLIC, "motivi", "b.webp"), "b"); }, ["/app/public/motivi/b.webp"], []],
  ["empty directory", (d) => mkdirSync(join(d, PUBLIC, "empty")), [], []],
  ["link to a file", (d) => { writeFileSync(join(d, PUBLIC, "payload.txt"), "{}"); symlinkSync("payload.txt", join(d, PUBLIC, "leak.map")); }, ["/app/public/payload.txt"], ["/app/public/leak.map"]],
  ["link to a directory", (d) => { mkdirSync(join(d, PUBLIC, "real")); writeFileSync(join(d, PUBLIC, "real", "c.js"), "c"); symlinkSync("real", join(d, PUBLIC, "alias")); }, ["/app/public/real/c.js"], ["/app/public/alias"]],
  ["link outside the root", (d) => symlinkSync("../../outside.txt", join(d, PUBLIC, "out.txt")), [], ["/app/public/out.txt"]],
  ["absolute link", (d) => symlinkSync("/etc/hostname", join(d, STATIC, "chunks", "host.js")), [], ["/app/.next/static/chunks/host.js"]],
  ["broken link", (d) => symlinkSync("missing.css", join(d, PUBLIC, "gone.css")), [], ["/app/public/gone.css"]],
  ["link in a subdirectory", (d) => { mkdirSync(join(d, STATIC, "css")); symlinkSync("../chunks/main.js", join(d, STATIC, "css", "x.css")); }, [], ["/app/.next/static/css/x.css"]],
  ["FIFO", (d) => { const made = spawnSync("mkfifo", [join(d, PUBLIC, "pipe")]); assert.equal(made.status, 0, String(made.error ?? made.stderr)); }, [], ["/app/public/pipe"]],
  ["root that is a link", (d) => { rmSync(join(d, PUBLIC), { recursive: true }); mkdirSync(join(d, "elsewhere")); writeFileSync(join(d, "elsewhere", "d.txt"), "d"); symlinkSync("../elsewhere", join(d, PUBLIC)); }, [], ["/app/public"]],
  ["missing root", (d) => rmSync(join(d, PUBLIC), { recursive: true }), [], ["/app/public"]],
];
for (const [name, build, files, flagged] of KINDS) {
  test(`listServed: ${name}`, () => {
    const dir = tree(build);
    try {
      const { paths, findings } = listServed(dir);
      assert.deepEqual(paths, [...BASE, ...files].sort());
      assert.deepEqual(findings.map((finding) => finding.url).sort(), flagged.sort());
      for (const finding of findings) assert.match(finding.code, /^served-(?:type|root)$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const fixture = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), "served-bundle-"));
  mkdirSync(join(dir, "body"));
  mkdirSync(join(dir, "head"));
  rows.forEach((row, index) => {
    writeFileSync(join(dir, "body", String(index + 1)), row.body ?? "self.x=1;");
    writeFileSync(join(dir, "head", String(index + 1)), row.headers ?? "HTTP/1.1 200 OK\r\n");
  });
  writeFileSync(join(dir, "index.tsv"), rows.map((row) => `${row.url}\t${row.status ?? "200"}\t${row.mapStatus ?? "404"}\n`).join(""));
  return dir;
};

test("CLI urls: maps paths, rejects a path outside the served roots", () => {
  const ok = spawnSync(process.execPath, [script, "urls"], { input: "/app/public/a.txt\n/app/.next/static/chunks/b.js\n", encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "/a.txt\n/_next/static/chunks/b.js\n");
  const bad = spawnSync(process.execPath, [script, "urls"], { input: "/app/public/a.txt\n/app/.env\n", encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /served-path/);
});

test("CLI check: passes a clean set, fails with every finding, rejects bad usage", () => {
  const clean = fixture([{ url: CHUNK }, { url: "/motivi/city.webp", mapStatus: "-" }]);
  const dirty = fixture([{ url: CHUNK, body: "x\n//# sourceMappingURL=main.js.map", mapStatus: "200" }, { url: `${CHUNK}.map` }]);
  const empty = fixture([]);
  try {
    const ok = run("check", clean);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Served bundle OK: 2 files/);
    const failed = run("check", dirty);
    assert.equal(failed.status, 1);
    for (const code of ["source-map-reference", "source-map-served", "source-map-file"]) assert.match(failed.stderr, new RegExp(code));
    assert.equal(run("check", empty).status, 1);
    assert.equal(run("check").status, 2);
    assert.equal(run("nothing").status, 2);
  } finally {
    for (const dir of [clean, dirty, empty]) rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI list: prints regular files, fails on a link with the path, rejects bad usage", () => {
  const clean = tree((d) => writeFileSync(join(d, PUBLIC, "a b.txt"), "a"));
  const linked = tree((d) => symlinkSync("../.next/static/chunks/main.js", join(d, PUBLIC, "leak.map")));
  try {
    const ok = run("list", clean);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, "/app/.next/static/chunks/main.js\n/app/public/a b.txt\n");
    const bad = run("list", linked);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /^\/app\/public\/leak\.map: served-type \(symbolic link/m);
    assert.equal(bad.stdout, "/app/.next/static/chunks/main.js\n");
    assert.equal(run("list").status, 2);
  } finally {
    for (const dir of [clean, linked]) rmSync(dir, { recursive: true, force: true });
  }
});
