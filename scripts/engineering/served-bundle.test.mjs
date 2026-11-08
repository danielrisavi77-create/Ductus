import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import fc from "fast-check";

import { checkServed, checkServedSet, servedUrl } from "./served-bundle.mjs";

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

test("checkServedSet: an empty set or one without a chunk never passes", () => {
  assert.deepEqual(codes(checkServedSet([])), ["served-empty"]);
  assert.deepEqual(codes(checkServedSet([entry({ url: "/motivi/city.webp", mapStatus: "-" })])), ["served-empty"]);
  assert.deepEqual(codes(checkServedSet([entry({ url: "/_next/static/chunks/a.css" })])), ["served-empty"]);
  assert.deepEqual(checkServedSet([entry(), entry({ url: "/motivi/city.webp", mapStatus: "-" })]), []);
});

// No "g": the alphabet cannot spell the marker word in any letter case.
const SAFE = fc.string({ unit: fc.constantFrom(..."abcdefhijklmnopqrstuvwxyz0123456789 ;=(){}\n\t/*.\"'#@") });
const MARK = fc.tuple(fc.constantFrom("//", "/*", ""), fc.constantFrom("#", "@"), fc.constantFrom("", " ", "\t", " \t"),
  fc.constantFrom("", " ", "\t")).map(([open, sign, before, after]) => `${open}${sign}${before}sourceMappingURL${after}=x.map`);

test("fast-check: a body without the marker word has no finding; an inserted marker always has", () => {
  fc.assert(fc.property(SAFE, (body) => {
    assert.deepEqual(checkServed(entry({ body: Buffer.from(body) })), []);
  }));
  fc.assert(fc.property(SAFE, MARK, SAFE, (before, mark, after) => {
    assert.deepEqual(codes(checkServed(entry({ body: Buffer.from(before + mark + after) }))), ["source-map-reference"]);
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
