// @vitest-environment node
// M8.8-P01/P02 (DAN-435), attack plan #1597: the reviewed dependency set of
// spikes/docx-provenance. Static checks over the manifest, the npm lockfile,
// the offline generator and the reader; nothing here installs or runs the spike.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ALLOWED_LICENSES, GENERATOR_PIN, READER_PIN, REVIEWED, checkGenerator, checkGeneratorImports, checkLockfile, checkManifest,
  checkReader, checkReaderImports, checkSpike, isExactVersion, licenseError, sha256Hex, type SpikeFiles,
} from "../../../spikes/docx-provenance/policy";

const DIR = "spikes/docx-provenance";
const real = {
  manifest: readFileSync(`${DIR}/package.json`, "utf8"),
  lockfile: readFileSync(`${DIR}/package-lock.json`, "utf8"),
  generator: readFileSync(`${DIR}/gen.mjs`, "utf8"),
  reader: readFileSync(`${DIR}/read.mjs`, "utf8"),
} satisfies SpikeFiles;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const manifest = (): Json => JSON.parse(real.manifest);
const lock = (): Json => JSON.parse(real.lockfile);
const withDeps = (deps: Record<string, string>, extra: Json = {}): Json => ({ ...manifest(), dependencies: deps, ...extra });
const okDeps = { fflate: "0.8.3", saxes: "6.0.0" };
const lockWith = (edit: (l: Json) => void): Json => { const l = lock(); edit(l); return l; };
const entry = (l: Json, name: string): Json => l.packages[`node_modules/${name}`];

describe("real spike files (A18)", () => {
  it("pass and are actually read", () => {
    expect(checkSpike(real)).toEqual([]);
    expect(Object.keys(lock().packages).sort()).toEqual(["", "node_modules/fflate", "node_modules/saxes", "node_modules/xmlchars"]);
    expect(Object.keys(manifest().dependencies).sort()).toEqual(["fflate", "saxes"]);
  });
  it("a break in any one file fails the whole check", () => {
    expect(checkSpike({ ...real, manifest: real.manifest.replace('"0.8.3"', '"^0.8.3"') })).not.toEqual([]);
    expect(checkSpike({ ...real, lockfile: real.lockfile.replace(/"integrity": "sha512-tb/, '"integrity": "sha512-xx') })).not.toEqual([]);
    expect(checkSpike({ ...real, generator: `import "node:https";\n${real.generator}` })).not.toEqual([]);
    expect(checkSpike({ ...real, lockfile: "" })).not.toEqual([]);
    expect(checkSpike({ ...real, generator: "" })).not.toEqual([]);
    expect(checkSpike({ ...real, reader: `${real.reader}\n` })).not.toEqual([]);
    expect(checkSpike({ ...real, reader: "" })).not.toEqual([]);
  });
  it("licence allowlist is a subset of dependency-review allow-licenses (A10)", () => {
    const yml = readFileSync(".github/workflows/dependency-review.yml", "utf8");
    const line = /allow-licenses:\s*(.+)/.exec(yml)?.[1] ?? "";
    const allowed = line.split(",").map((s) => s.trim());
    expect(allowed.length).toBeGreaterThan(3);
    for (const l of ALLOWED_LICENSES) expect(allowed).toContain(l);
    for (const p of REVIEWED) expect(ALLOWED_LICENSES).toContain(p.license);
  });
  it("does not need the spike installed: policy imports nothing, this test no spike package", () => {
    expect(readFileSync(`${DIR}/policy.ts`, "utf8")).not.toMatch(/^\s*(?:import|export)\b[^\n]*\bfrom\b|^\s*import\s*["']/m);
    const own = [...readFileSync(new URL(import.meta.url), "utf8").matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(own.sort()).toEqual(["../../../spikes/docx-provenance/policy", "fast-check", "node:crypto", "node:fs", "vitest"]);
  });
  it("the spike holds only the pinned scripts and their tests, and they may not import a local file (A13)", () => {
    expect(readdirSync(DIR).filter((f) => /\.[cm]?[jt]sx?$/.test(f)).sort()).toEqual(["gen.mjs", "policy.ts", "read.mjs", "read.test.mjs"]);
    expect(checkGeneratorImports(`import { buildDocx } from "./gen.mjs";\n`)).toContain("generator imports ./gen.mjs");
    expect(checkReaderImports(`import { buildDocx } from "./gen.mjs";\n`)).toContain("reader imports ./gen.mjs");
  });
  it("the reader tests load no network module and no spike file other than gen.mjs and read.mjs", () => {
    const own = [...readFileSync(`${DIR}/read.test.mjs`, "utf8").matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)]
      .map((m) => m[1] ?? m[2]);
    expect([...new Set(own)].sort()).toEqual(["./gen.mjs", "./read.mjs", "fflate", "node:assert/strict", "node:child_process", "node:crypto", "node:test"]);
  });
  it("CI runs the reader tests in the required job, unskippable and without install scripts", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const job = ci.split("\n    name: Lint, typecheck, test and build\n")[1]?.split(/\n {2}[\w-]+:\n/)[0] ?? "";
    const step = job.split("\n      - name: DOCX provenance spike tests\n")[1]?.split(/\n {6}- /)[0] ?? "";
    expect(step).toBe("        working-directory: spikes/docx-provenance\n        run: npm ci --ignore-scripts && node --test read.test.mjs");
  });
  it("root manifests do not carry the spike dependencies (A17)", () => {
    const root = readFileSync("package.json", "utf8");
    for (const p of REVIEWED) expect(root).not.toContain(`"${p.name}"`);
  });
});

// [class, passing case, failing cases]
const manifestTable: [string, Json, Json[]][] = [
  ["A1 range", withDeps(okDeps), ["^0.8.3", "~0.8.3", ">=0.8.3", "*", "0.8.x", "0.8.3 || 0.9.0", "0.8.0 - 0.8.3", "=0.8.3", "v0.8.3", " 0.8.3"]
    .map((s) => withDeps({ ...okDeps, fflate: s }))],
  ["A2 tag or prerelease", withDeps(okDeps), ["latest", "next", "0.8.3-rc.1", "0.8.3+build.5", "0.8.03"]
    .map((s) => withDeps({ ...okDeps, fflate: s }))],
  ["A3 non-registry source", withDeps(okDeps), ["git+https://github.com/101arrowz/fflate.git", "github:101arrowz/fflate", "https://example.invalid/f.tgz",
    "file:../f", "link:../f", "workspace:*", "npm:fflate@0.8.3"].map((s) => withDeps({ ...okDeps, fflate: s }))],
  ["A4 other dependency fields", withDeps(okDeps), [
    withDeps(okDeps, { devDependencies: { fflate: "0.8.3" } }), withDeps(okDeps, { optionalDependencies: {} }),
    withDeps(okDeps, { peerDependencies: { saxes: "6.0.0" } }), withDeps(okDeps, { bundleDependencies: ["fflate"] }),
    withDeps(okDeps, { bundledDependencies: ["fflate"] }), withDeps(okDeps, { overrides: { xmlchars: "2.2.0" } }),
    withDeps(okDeps, { scripts: { postinstall: "node x.js" } }), withDeps(okDeps, { scripts: { prepare: "node x.js" } }),
  ]],
  ["A5/A6 unreviewed or wrong version", withDeps(okDeps), [
    withDeps({ ...okDeps, jszip: "3.10.1" }), withDeps({ ...okDeps, fflate: "0.8.2" }), withDeps({ fflate: "0.8.3" }), withDeps({ ...okDeps, constructor: "1.0.0" }),
  ]],
];

describe("manifest input classes", () => {
  it.each(manifestTable)("%s", (_name, ok, bad) => {
    expect(checkManifest(ok)).toEqual([]);
    for (const m of bad) expect(checkManifest(m), JSON.stringify(m)).not.toEqual([]);
  });
  it("rejects non-objects", () => {
    for (const m of [null, [], "x", 1]) expect(checkManifest(m)).not.toEqual([]);
  });
});

const lockTable: [string, Json[]][] = [
  ["A5 lock-only package", [
    lockWith((l) => { l.packages["node_modules/pend"] = { version: "1.2.0", resolved: "https://registry.npmjs.org/pend/-/pend-1.2.0.tgz", integrity: "sha512-AAAA", license: "MIT" }; }),
    lockWith((l) => { l.packages["node_modules/saxes/node_modules/xmlchars"] = { ...entry(l, "xmlchars") }; }),
    lockWith((l) => { l.packages["vendor/fflate"] = { ...entry(l, "fflate") }; }),
  ]],
  ["A6 missing or other version", [
    lockWith((l) => { delete l.packages["node_modules/xmlchars"]; }),
    lockWith((l) => { entry(l, "saxes").version = "6.0.1"; }),
  ]],
  ["A7 integrity", [
    lockWith((l) => { delete entry(l, "fflate").integrity; }),
    lockWith((l) => { entry(l, "fflate").integrity = "sha1-abc"; }),
    lockWith((l) => { entry(l, "fflate").integrity = entry(l, "saxes").integrity; }),
  ]],
  ["A8 resolved", [
    "http://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz", "https://registry.example.invalid/fflate/-/fflate-0.8.3.tgz",
    "git+ssh://git@github.com/101arrowz/fflate.git", "https://registry.npmjs.org/fflate/-/evil-0.8.3.tgz", undefined,
  ].map((r) => lockWith((l) => { entry(l, "fflate").resolved = r; }))],
  ["A9 install script", [lockWith((l) => { entry(l, "xmlchars").hasInstallScript = true; })]],
  ["A10/A11 licence", ["GPL-3.0-only", "AGPL-3.0", "UNLICENSED", "SEE LICENSE IN LICENSE", "", "MIT OR GPL-3.0", "(MIT AND ISC)", "ISC", undefined]
    .map((s) => lockWith((l) => { entry(l, "fflate").license = s; }))],
  ["A12 lockfile shape", [
    lockWith((l) => { l.lockfileVersion = 2; }),
    lockWith((l) => { l.packages[""].dependencies = { fflate: "0.8.3" }; }),
    lockWith((l) => { l.packages[""].name = "other"; }),
    lockWith((l) => { l.packages[""].devDependencies = { saxes: "6.0.0" }; }),
    lockWith((l) => { entry(l, "fflate").link = true; }),
    lockWith((l) => { entry(l, "fflate").dev = true; }),
    lockWith((l) => { delete l.packages; }),
  ]],
];

describe("lockfile input classes", () => {
  it.each(lockTable)("%s", (_name, bad) => {
    expect(checkLockfile(lock(), manifest())).toEqual([]);
    for (const l of bad) expect(checkLockfile(l, manifest()), JSON.stringify(l).slice(0, 200)).not.toEqual([]);
  });
  it("names the unreviewed package (A5)", () => {
    const l = lockWith((x) => { x.packages["node_modules/pend"] = { version: "1.2.0" }; });
    expect(checkLockfile(l, manifest()).join("\n")).toContain("pend");
  });
});

describe("licence expressions (A10)", () => {
  it.each(["MIT", "ISC", "Apache-2.0", "BSD-3-Clause"])("accepts %s", (l) => expect(licenseError(l)).toBeNull());
  it.each(["GPL-2.0", "MIT OR Apache-2.0", "MIT AND ISC", "Apache-2.0 WITH LLVM-exception", "UNLICENSED", "SEE LICENSE IN x", "", "mit", "LGPL-3.0-or-later"])(
    "rejects %j", (l) => expect(licenseError(l)).not.toBeNull());
});

// The generator is pinned to the reviewed bytes (orchestrator c.6676693291).
const GEN_BYTES = readFileSync(`${DIR}/gen.mjs`);
const PIN_ERROR = "a change to the generator needs a new review";
const pinFails = (errors: string[]) => errors.some((e) => e.includes(PIN_ERROR) && e.includes(GENERATOR_PIN.reason));
const appended = (line: string) => `${real.generator}${line}\n`;
describe("generator pin (A13)", () => {
  it("the real gen.mjs passes, as bytes and as text, and the pin is its node:crypto sha256", () => {
    expect(checkGenerator(GEN_BYTES)).toEqual([]);
    expect(checkGenerator(real.generator)).toEqual([]);
    expect(createHash("sha256").update(GEN_BYTES).digest("hex")).toBe(GENERATOR_PIN.sha256);
    expect(GENERATOR_PIN.path).toBe(`${DIR}/gen.mjs`);
    expect(GEN_BYTES.includes(0x0d)).toBe(false);
  });
  it("a change of any one byte fails with the new review message", () => {
    fc.assert(fc.property(fc.nat(GEN_BYTES.length - 1), fc.integer({ min: 1, max: 255 }), (at, delta) => {
      const b = Uint8Array.from(GEN_BYTES);
      b[at] = (b[at] + delta) % 256;
      return pinFails(checkGenerator(b));
    }), { numRuns: 300 });
    expect(pinFails(checkGenerator(GEN_BYTES.subarray(0, -1)))).toBe(true);
    expect(pinFails(checkGenerator(Buffer.concat([GEN_BYTES, Buffer.from("\n")])))).toBe(true);
    expect(pinFails(checkGenerator(real.generator.replaceAll("\n", "\r\n")))).toBe(true);
  });
  it("a disallowed specifier fails the import check as well as the pin", () => {
    const swapped = real.generator.replace('from "fflate"', 'from "node:https"');
    expect(swapped).not.toBe(real.generator);
    const errors = checkGenerator(swapped);
    expect(pinFails(errors)).toBe(true);
    expect(errors).toContain("generator imports node:https");
    expect(checkGenerator(appended('import x from "jszip";'))).toContain("generator imports jszip");
  });
  it("sha256Hex matches node:crypto", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), (b) => sha256Hex(b) === createHash("sha256").update(b).digest("hex")));
  });
});

// The reader is pinned the same way (M8.8-P02); its import check is stricter: no node:* module and no global.
const READER_BYTES = readFileSync(`${DIR}/read.mjs`);
const readerPinFails = (errors: string[]) => errors.some((e) => e.includes("a change to the reader needs a new review") && e.includes(READER_PIN.reason));
const OK_READER = 'import { Inflate } from "fflate";\nimport { SaxesParser } from "saxes";\n';
describe("reader pin (A13)", () => {
  it("the real read.mjs passes, as bytes and as text, and the pin is its node:crypto sha256", () => {
    expect(checkReader(READER_BYTES)).toEqual([]);
    expect(checkReader(real.reader)).toEqual([]);
    expect(createHash("sha256").update(READER_BYTES).digest("hex")).toBe(READER_PIN.sha256);
    expect(READER_PIN.path).toBe(`${DIR}/read.mjs`);
    expect(READER_BYTES.includes(0x0d)).toBe(false);
    expect(checkReaderImports(OK_READER)).toEqual([]);
  });
  it("a change of any one byte fails with the new review message", () => {
    fc.assert(fc.property(fc.nat(READER_BYTES.length - 1), fc.integer({ min: 1, max: 255 }), (at, delta) => {
      const b = Uint8Array.from(READER_BYTES);
      b[at] = (b[at] + delta) % 256;
      return readerPinFails(checkReader(b));
    }), { numRuns: 300 });
    expect(readerPinFails(checkReader(READER_BYTES.subarray(0, -1)))).toBe(true);
    expect(readerPinFails(checkReader(real.reader.replaceAll("\n", "\r\n")))).toBe(true);
  });
  it("a node:* module, a generator-only module or a loader fails the reader import check", () => {
    const swapped = real.reader.replace('from "fflate"', 'from "node:fs"');
    expect(swapped).not.toBe(real.reader);
    expect(checkReader(swapped)).toContain("reader imports node:fs");
    expect(readerPinFails(checkReader(swapped))).toBe(true);
    for (const line of ['import { readFileSync } from "node:fs";', 'import "node:https";', 'export * from "saxes";', 'const m = await import("fflate");',
      'const p = process.env;', 'process.getBuiltinModule("node:net");', 'globalThis.fetch("x");', 'fetch("https://example.invalid");',
      'const u = import.meta.url;', 'require("node:http");', 'new Function("return 1")();', 'eval("1");', 'Reflect.get(global, "x");'])
      expect(checkReaderImports(OK_READER + line), line).not.toEqual([]);
  });
  it("each forbidden name fails the reader import check on its own, under its own name", () => {
    for (const name of ["require", "createRequire", "process", "globalThis", "global", "getBuiltinModule", "fetch", "WebSocket",
      "XMLHttpRequest", "eval", "Function", "Reflect"])
      expect(checkReaderImports(`${OK_READER}void ${name};\n`), name).toContain(`reader uses ${name}`);
    expect(checkReaderImports(`${OK_READER}const u = import.meta;\n`)).toContain("reader uses import.meta");
  });
});

const OK_GEN = 'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { zipSync, strToU8 } from "fflate";\n';
// Every form from earlier findings fails appended to the real gen.mjs, through the pin; a form that loads a
// module (import, export, require) also fails the import check on its own.
const LOADS_MODULE = /\b(?:import|export|require|createRequire)\b/;
const rejects = (line: string) => {
  expect(pinFails(checkGenerator(appended(line))), line).toBe(true);
  if (LOADS_MODULE.test(line)) expect(checkGeneratorImports(OK_GEN + line), line).not.toEqual([]);
};
describe("generator imports (A13, A14)", () => {
  it("accepts the allowed imports, and only the pinned file passes the whole check", () => {
    expect(checkGeneratorImports(OK_GEN)).toEqual([]);
    expect(pinFails(checkGenerator(OK_GEN))).toBe(true);
  });
  it.each([
    'import http from "node:http";', 'import "https";', 'import { connect } from "node:net";', 'import tls from "node:tls";',
    'import dns from "node:dns";', 'import dgram from "node:dgram";', 'import h2 from "node:http2";', 'import cp from "node:child_process";',
    'import { Worker } from "node:worker_threads";', 'import vm from "node:vm";', 'import fs from "fs";', 'export * from "node:http";',
    'const r = await fetch("https://example.invalid");', 'new WebSocket("wss://example.invalid");', 'const m = await import("node:fs");',
    'const fs = require("fs");', 'import { createRequire } from "node:module";', 'eval("1");', 'new Function("return 1");',
    'process.binding("tcp_wrap");', 'globalThis["fet" + "ch"]("x");',
    'import JSZip from "jszip";', 'import { unzip } from "fflate/browser";', 'import x from "./helper.mjs";',
    'import\n  { a }\n  from\n  "node:http";',
    // Re-exports load a module too; a comment must not hide the specifier (review c.6675616322, QA c.6675637491).
    'export * from /* c */ "node:child_process";', 'export /* c */ * from "node:net";', 'export * as n from // c\n "node:vm";',
    'export { a } from /* c */ "node:http";', 'export { request } from/**/"node:https";', 'export { buildDocx };',
  ])("rejects %j", (line) => rejects(line));
  it("accepts exported declarations", () =>
    expect(checkGeneratorImports(OK_GEN + "export const A = 1;\nexport function b() {}\nexport async function c() {}\nexport\n  class D {}\n")).toEqual([]));
  it("rejects an empty generator", () => expect(checkGenerator("")).not.toEqual([]));
});

// Every import and export class against every separator that can sit in its gaps ("_"), comments included
// (orchestrator c.6675688564). A forbidden module must never pass, a re-export never passes, and the
// plain forms of allowed modules and exported declarations still pass.
describe("generator import and export classes (A13)", () => {
  const GAPS = [" ", "\n  ", " /* c */ ", "/**/", " // c\n"];
  const LOADS = ['import_x_from_"M";', 'import_{ a }_from_"M";', 'import_{ a as b }_from_"M";', 'import_*_as m_from_"M";',
    'import_x, { a }_from_"M";', 'import_"M";', 'import_x_from_"M"_with { type: "json" };', 'import_("M");',
    'export_*_from_"M";', 'export_*_as m_from_"M";', 'export_{ a }_from_"M";', 'export_{ a as default }_from_"M";'];
  const fill = (form: string, gap: string, mod: string) => form.replaceAll("_", gap).replace("M", mod);
  const cases = (forms: string[], gaps: string[], mod: string) => forms.flatMap((f) => gaps.map((g) => fill(f, g, mod)));
  it.each(cases(LOADS, GAPS, "node:https"))("rejects a forbidden module in %j", (line) =>
    rejects(line));
  it.each(cases(LOADS.filter((f) => f.startsWith("export")), GAPS, "fflate"))("rejects a re-export in %j", (line) =>
    rejects(line));
  it.each(cases(['export_{ a };', 'export_{ a as b };', 'export_default_a;', 'export_default_function () {}'], GAPS, ""))(
    "rejects a non-declaration export in %j", (line) => rejects(line));
  it.each(cases(LOADS.slice(0, 7), [" ", "\n  "], "fflate"))("accepts an allowed module in %j", (line) =>
    expect(checkGeneratorImports(OK_GEN + line), line).toEqual([]));
  it.each(cases(["export_const A = 1;", "export_let b = 1;", "export_var c = 1;", "export_function d() {}",
    "export_async function e() {}", "export_class F {}"], [" ", "\n  "], ""))("accepts the declaration %j", (line) =>
    expect(checkGeneratorImports(OK_GEN + line), line).toEqual([]));
});

// A builtin module is reachable without import through process (QA c.6676181719): only process.argv is allowed,
// and the globals and reflection that reach process without its name are rejected.
describe("generator builtin loaders (A13)", () => {
  it.each([
    'process.getBuiltinModule("https").get("https://example.invalid");', 'process . getBuiltinModule("node:net");',
    'process["getBuiltinModule"]("node:http");', 'const { getBuiltinModule } = process;', 'const p = process;',
    'process?.getBuiltinModule("node:tls");', 'process\n  .getBuiltinModule("node:dns");', 'process._linkedBinding("tcp_wrap");',
    'process.binding("tcp_wrap");', 'process.dlopen(m, "x.node");', 'process.env.HTTPS_PROXY;', 'process.mainModule;',
    'globalThis.process.getBuiltinModule("node:https");', 'globalThis.fetch("x");', 'global["pro" + "cess"];',
    'Reflect.get(globalThis, "pro" + "cess");', 'const g = getBuiltinModule;',
  ])("rejects %j", (line) => rejects(line));
  it.each(['const out = process.argv[2] ?? "out";', 'if (process.argv[1]) {}', 'const a = process\n  .argv;',
    'const self = fileURLToPath(import.meta.url);'])(
    "accepts %j", (line) => expect(checkGeneratorImports(OK_GEN + line), line).toEqual([]));
  // Classes from the orchestrator's round 2 contract (c.6676289617).
  it.each([
    'const h = require("node:http");', 'module.createRequire(import.meta.url)("node:http");', 'const r = createRequire(x);',
    'import.meta.resolve("node:http");', 'import . meta . resolve("node:https");', 'eval("1");', 'new Function("return 1")();',
    'const p = process; p.getBuiltinModule("node:http");',
  ])("rejects %j", (line) => rejects(line));
  const NET_PROC = ["http", "https", "net", "tls", "dgram", "dns", "child_process", "worker_threads", "cluster"];
  const LOADERS = ['import m from "M";', 'import * as m from "M";', 'import "M";', 'export * from "M";', 'await import("M");',
    'require("M");', 'process.getBuiltinModule("M");', 'globalThis.process.getBuiltinModule("M");'];
  it.each(NET_PROC.flatMap((m) => [m, `node:${m}`]).flatMap((m) => LOADERS.map((l) => l.replace("M", m))))(
    "rejects a network or process module in %j", (line) => rejects(line));
});

describe("exact version property", () => {
  it("accepts every X.Y.Z without leading zeros", () => {
    fc.assert(fc.property(fc.nat(), fc.nat(), fc.nat(), (a, b, c) => isExactVersion(`${a}.${b}.${c}`)));
  });
  it("anything it accepts is a canonical triple of integers", () => {
    fc.assert(fc.property(fc.string(), (s) => {
      if (!isExactVersion(s)) return true;
      const parts = s.split(".");
      return parts.length === 3 && parts.map((p) => String(Number.parseInt(p, 10))).join(".") === s;
    }));
  });
  it("rejects any decorated version", () => {
    const deco = fc.tuple(fc.constantFrom("^", "~", ">=", "<", "=", "v", " ", "", "*"), fc.nat(), fc.nat(), fc.nat(),
      fc.constantFrom("-rc.1", "+b", ".x", " ", "-0", ".0", "", "||1.0.0"))
      .filter(([pre, , , , post]) => pre !== "" || post !== "");
    fc.assert(fc.property(deco, ([pre, a, b, c, post]) => !isExactVersion(`${pre}${a}.${b}.${c}${post}`)));
  });
  it("the manifest rejects every spec other than the reviewed version", () => {
    fc.assert(fc.property(fc.string(), (s) => s === "0.8.3" || checkManifest(withDeps({ ...okDeps, fflate: s })).length > 0));
  });
});
