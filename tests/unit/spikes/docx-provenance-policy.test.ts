// @vitest-environment node
// M8.8-P01 (DAN-435), attack plan #1597: the reviewed dependency set of
// spikes/docx-provenance. Static checks over the manifest, the npm lockfile
// and the offline generator; nothing here installs or runs the spike.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ALLOWED_LICENSES, REVIEWED, checkGenerator, checkLockfile, checkManifest, checkSpike,
  isExactVersion, licenseError, type SpikeFiles,
} from "../../../spikes/docx-provenance/policy";

const DIR = "spikes/docx-provenance";
const real: SpikeFiles = {
  manifest: readFileSync(`${DIR}/package.json`, "utf8"),
  lockfile: readFileSync(`${DIR}/package-lock.json`, "utf8"),
  generator: readFileSync(`${DIR}/gen.mjs`, "utf8"),
};
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
    // The only import is the root typescript parser (QA c.6676181719); still nothing from the spike.
    const policyImports = [...readFileSync(`${DIR}/policy.ts`, "utf8").matchAll(/^\s*(?:import|export)\b[^\n]*\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]);
    expect(policyImports).toEqual(["typescript"]);
    const own = [...readFileSync(new URL(import.meta.url), "utf8").matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(own.sort()).toEqual(["../../../spikes/docx-provenance/policy", "fast-check", "node:fs", "vitest"]);
  });
  it("gen.mjs is the only script in the spike and may not import a local file (A13)", () => {
    expect(readdirSync(DIR).filter((f) => /\.[cm]?[jt]sx?$/.test(f)).sort()).toEqual(["gen.mjs", "policy.ts"]);
    expect(checkGenerator(`import { buildDocx } from "./gen.mjs";\n`)).not.toEqual([]);
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

const OK_GEN = 'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { zipSync, strToU8 } from "fflate";\n';
describe("generator imports (A13, A14)", () => {
  it("accepts the allowed imports", () => expect(checkGenerator(OK_GEN)).toEqual([]));
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
  ])("rejects %j", (line) => expect(checkGenerator(OK_GEN + line), line).not.toEqual([]));
  it("accepts exported declarations", () =>
    expect(checkGenerator(OK_GEN + "export const A = 1;\nexport function b() {}\nexport async function c() {}\nexport\n  class D {}\n")).toEqual([]));
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
    expect(checkGenerator(OK_GEN + line), line).not.toEqual([]));
  it.each(cases(LOADS.filter((f) => f.startsWith("export")), GAPS, "fflate"))("rejects a re-export in %j", (line) =>
    expect(checkGenerator(OK_GEN + line), line).not.toEqual([]));
  it.each(cases(['export_{ a };', 'export_{ a as b };', 'export_default_a;', 'export_default_function () {}'], GAPS, ""))(
    "rejects a non-declaration export in %j", (line) => expect(checkGenerator(OK_GEN + line), line).not.toEqual([]));
  it.each(cases(LOADS.slice(0, 7), [" ", "\n  "], "fflate"))("accepts an allowed module in %j", (line) =>
    expect(checkGenerator(OK_GEN + line), line).toEqual([]));
  it.each(cases(["export_const A = 1;", "export_let b = 1;", "export_var c = 1;", "export_function d() {}",
    "export_async function e() {}", "export_class F {}"], [" ", "\n  "], ""))("accepts the declaration %j", (line) =>
    expect(checkGenerator(OK_GEN + line), line).toEqual([]));
});

// QA FAIL c.6676181719: a module can be loaded without a static import. Every loading path below must fail
// for every network and process module, with and without the node: prefix; "MOD" is the module name.
const NET_PROC = ["http", "https", "net", "tls", "dgram", "dns", "child_process", "worker_threads", "cluster"];
const LOADERS: [string, string[]][] = [
  ["K1 process.getBuiltinModule", ['process.getBuiltinModule("MOD").get("x");', 'process /* c */ . getBuiltinModule("MOD");',
    'process?.getBuiltinModule?.("MOD");', 'process\n  .getBuiltinModule("MOD");', 'process.argv && process.getBuiltinModule("MOD");']],
  ["K2 computed key", ['process["getBuiltinModule"]("MOD");', 'process["getBuiltin" + "Module"]("MOD");', 'process[`getBuiltinModule`]("MOD");',
    'const k = "get" + "BuiltinModule"; process.argv[k]; process[k]("MOD");', 'process.argv["con" + "structor"]("return pro" + "cess")()["getBuilt" + "inModule"]("MOD");']],
  ["K3 alias or destructuring", ['const p = process; p["getBuiltinModule"]("MOD");', 'const p = process; p.getBuiltinModule("MOD");',
    'const { getBuiltinModule: g } = process; g("MOD");', 'const q = ({ process }).process; q.getBuiltinModule("MOD");',
    'const [p] = [process]; p["get" + "BuiltinModule"]("MOD");', 'let p; p = process; p.getBuiltinModule("MOD");']],
  ["K4 global object", ['globalThis.process.getBuiltinModule("MOD");', 'global["pro" + "cess"]["getBuilt" + "inModule"]("MOD");',
    'Reflect.get(Reflect.get(globalThis, "pro" + "cess"), "getBuilt" + "inModule")("MOD");', 'const g = globalThis; g.process.getBuiltinModule("MOD");']],
  ["K5 require", ['require("MOD");', 'module.require("MOD");', 'process.mainModule.require("MOD");', 'const r = require; r("MOD");']],
  ["K6 createRequire", ['import { createRequire } from "node:module";\ncreateRequire(import.meta.url)("MOD");',
    'import m from "node:module";\nm.createRequire(import.meta.url)("MOD");', 'process.getBuiltinModule("module").createRequire(import.meta.url)("MOD");']],
  ["K7 import.meta and import()", ['import.meta.resolve("MOD");', 'import.meta["resolve"]("MOD");', 'const meta = import.meta; meta.resolve("MOD");',
    'await import("MOD");', 'const s = "MOD"; await import(s);']],
  ["K8 code generation", ['eval(\'process.getBuiltinModule("MOD")\');', '(0, eval)(\'process.getBuiltinModule("MOD")\');',
    'new Function(\'return process.getBuiltinModule("MOD")\')();', 'Function(\'return process.getBuiltinModule("MOD")\')();',
    '(() => {}).constructor(\'return process.getBuiltinModule("MOD")\')();',
    'Object.values(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => {}))).find((d) => d.value).value("return pro" + "cess.getBuilt" + "inModule(\'MOD\')")();',
    '[].map["con" + "structor"]("return pro" + "cess.getBuilt" + "inModule(\'MOD\')")();', '({}).__proto__;\n"MOD";']],
  ["K9 unicode escape", ['\\u0070rocess.getBuiltinModule("MOD");', 'pro\\u0063ess["getBuiltinModule"]("MOD");',
    'process.\\u0067etBuiltinModule("MOD");', 'const p = \\u{70}rocess; p.argv; "MOD";']],
  ["K10 shadowed global or unlisted member", ['{ const Reflect = 0; }\nReflect.get(globalThis, "MOD");',
    'function f(navigator) { return navigator; }\nf("MOD");', 'Object.getPrototypeOf(process.argv);\n"MOD";', 'process.argv.at(0);\n"MOD";']],
];

describe("generator module loading without a static import (A13, QA c.6676181719)", () => {
  const cases = LOADERS.flatMap(([cls, forms]) => forms.flatMap((f) =>
    NET_PROC.flatMap((m) => [m, `node:${m}`]).map((m): [string, string] => [cls, f.replaceAll("MOD", m)])));
  it.each(cases)("%s rejects %j", (_cls, line) => expect(checkGenerator(OK_GEN + line), line).not.toEqual([]));
  it("covers every network and process module in every loader class", () => {
    expect(cases).toHaveLength(LOADERS.reduce((n, [, f]) => n + f.length, 0) * NET_PROC.length * 2);
  });
  it.each([
    'const out = process.argv[2] ?? "out";', 'const here = import.meta.url;',
    'if (process.argv[1] && process.argv.length > 1) {}', 'const n = Object.entries({ a: 1 }).map(([k, v]) => k + v).join(",");',
  ])("accepts %j", (line) => expect(checkGenerator(OK_GEN + line), line).toEqual([]));
  it("rejects a generator that does not parse", () => expect(checkGenerator(OK_GEN + "const = ;")).not.toEqual([]));
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
