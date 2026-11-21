import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// DAN-927: outside src/editor, the editor is imported through its entry
// @/editor only. Attack class "oblici specifikatora": every way a literal
// specifier can name a module of the package other than its entry.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RULE = "editor-boundary/entry-only";
const ruleFilter = ({ ruleId }: { ruleId: string }) => ruleId === RULE;
const on = new ESLint({ cwd: REPO_ROOT, ruleFilter });
// The control: the same configuration with the rule switched off.
const off = new ESLint({ cwd: REPO_ROOT, ruleFilter, overrideConfig: { rules: { [RULE]: "off" } } });

beforeAll(async () => {
  await on.lintText("export {};\n", { filePath: "src/lib/probe.ts" });
  await off.lintText("export {};\n", { filePath: "src/lib/probe.ts" });
}, 60_000);

async function hits(engine: ESLint, filePath: string, code: string) {
  const [result] = await engine.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === RULE).length;
}

const FILE = "src/lib/probe.ts";
const schema = join(REPO_ROOT, "src/editor/schema.ts");
const fileUrl = pathToFileURL(schema).href;

// Each names src/editor/schema(.ts) from src/lib/probe.ts, or cannot be placed.
const DEEP = [
  // K1 relative paths
  "../editor/schema", "../editor/schema.ts", ".//../editor/schema", "../editor/./schema", "../editor/x/../schema",
  "../../src/editor/schema", "../lib/../editor/schema", "../editor/index/../schema", "../editor//schema",
  // K2 alias
  "@/editor/schema", "@/editor//schema", "@//editor/schema", "@/editor/index/../schema", "@/lib/../editor/schema",
  // K3 absolute paths and file: URLs
  schema, fileUrl, fileUrl.replace("file://", "file://localhost"), fileUrl.replace("file://", "FILE://"),
  fileUrl.replace("file://", "file:"), "file:../editor/schema", "FILE:..\\editor\\schema",
  // K4 tab, CR, LF and C0 or space at the ends
  "../editor/sche\tma", "../edi\rtor/schema", "../editor/schema\n", "\t../editor/schema", "@/editor/sch\tema", " ../editor/schema",
  "\u0000../editor/schema", "@/editor/schema ",
  // K5 backslash
  "..\\editor\\schema", "..\\editor/schema", "@/editor\\schema", "@\\editor\\schema",
  // K6 percent-encoding
  "../editor/%73chema", "../%65ditor/schema", "%2e%2e/editor/schema", "@/editor/%73chema", "../editor%2fschema",
  "..%5Ceditor%5Cschema", "@/editor%5Cschema",
  // K7 query and hash, a suffix carrying /..
  "../editor/schema?x", "../editor/schema#x", "../editor/schema?/../index", "../editor/index?/../schema",
  "@/editor/index#/../schema",
  "..\\editor\\index?\\..\\schema", "@/editor\\index#\\..\\schema",
  // K8 letter case and Windows names
  "../Editor/schema", "@/EDITOR/schema", "../editor./schema", "../editor /schema", "../editor::$INDEX_ALLOCATION/schema",
  "../../\u017Frc/editor/schema",
  // K9 schemes other than file: and node:
  "data:text/javascript,export*from'../editor/schema'", "C:\\x\\src\\editor\\schema", "http://x/src/editor/schema",
  // K10 a bare name read from node_modules or the root
  "pkg/../../src/editor/schema", "@scope/pkg/../../../src/editor/schema", "src/editor/schema", " pkg/../../src/editor/schema",
];

// K11: the entry, similar names, packages and node: builtins.
const ALLOWED = [
  "@/editor", "@/editor/", "@/editor/index", "@/editor/index.ts", "@/editor?x", "@/editor#x", "../editor",
  "../editor/", "../editor/.", "../editor/index.tsx", "../../src/editor", "@/components/editor/x", "@/editor-like/x",
  "../editors/x", "../editorial/x", "./editor/schema", "react", "@tiptap/pm/model", "node:fs", "fs",
];

const FORMS = [
  "import x from M;\nexport { x };\n",
  "export * from M;\n",
  "export { y } from M;\n",
  "export const x = () => import(M);\n",
  "export const x = require(M);\n",
  "export const x = module.require(M);\n",
  'export const x = module["require"](M);\n',
  "export const x = require.resolve(M);\n",
  'export const x = require["resolve"](M);\n',
  'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.url)(M);\n',
  'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.filename)(M);\n',
  'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const x = load.resolve(M);\n',
  "export const x = import.meta.resolve(M);\n",
  'export const x = import.meta["resolve"](M);\n',
  "export const x = new URL(M, import.meta.url);\n",
  "import type { X } from M;\nexport type Y = X;\n",
  "export type X = import(M).Y;\n",
  "export type X = typeof import(M);\n",
  "import x = require(M);\nexport { x };\n",
  "declare module M {}\nexport {};\n",
  'import { vi } from "vitest";\nexport const x = await vi.importActual(M);\n',
  "export const x = vi.importMock(M);\n",
  "export const x = jest.requireActual(M);\n",
  "export const x = import.meta.glob(M);\n",
];

const code = (form: string, specifier: string) => form.replace(/\bM\b/u, JSON.stringify(specifier));

describe("editor-core is imported through @/editor only (DAN-927)", () => {
  it("is on for every file", async () => {
    for (const file of [FILE, "app/probe/page.tsx", "tests/unit/probe.test.ts", "scripts/probe.mjs"]) {
      expect((await on.calculateConfigForFile(file)).rules?.[RULE]).toEqual([2]);
    }
  });

  it.each(DEEP.flatMap((specifier) => FORMS.map((form) => [code(form, specifier)] as const)))(
    "off passes, on catches: %j",
    async (text) => {
      expect(await hits(off, FILE, text)).toBe(0);
      expect(await hits(on, FILE, text)).toBe(1);
    },
    30_000,
  );

  it.each(ALLOWED.flatMap((specifier) => FORMS.map((form) => [code(form, specifier)] as const)))(
    "allows %j",
    async (text) => {
      expect(await hits(on, FILE, text)).toBe(0);
    },
  );

  // K10: a loader whose base is not this file, and other importing files.
  it.each([
    [FILE, 'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.dirname)("./editor/schema");\n'],
    [FILE, 'import { createRequire } from "node:module";\nexport const x = createRequire(__dirname)("./editor/schema");\n'],
    [FILE, 'import { createRequire } from "node:module";\ndeclare const base: string;\nexport const x = createRequire(base)("./x");\n'],
    [FILE, 'export const x = require.resolve("./x", { paths: ["/elsewhere"] });\n'],
    [FILE, 'export const x = import.meta.resolve("./x", "file:///elsewhere/");\n'],
    ["app/probe/page.tsx", 'export { y } from "../../src/editor/schema";\n'],
    ["tests/unit/probe.test.ts", 'export * from "../../src/editor/schema";\n'],
    ["scripts/probe.mjs", 'export const x = await import("../src/editor/schema.ts");\n'],
    ["src/editorial/probe.ts", 'export * from "../editor/schema";\n'],
    ["src/Editor./probe.ts", 'export * from "../editor/schema";\n'],
    [FILE, '/// <reference path="../editor/schema.ts" />\nexport {};\n'],
    [FILE, "/// <reference types='@/editor/schema' />\nexport {};\n"],
    [FILE, '/// <reference path="..\\editor\\schema.ts" />\nexport {};\n'],
    [FILE, '/// <reference preserve="true" path="../editor/schema.ts" />\nexport {};\n'],
    [FILE, 'import { createRequire } from "node:module";\nlet load = createRequire(import.meta.url);\nload = createRequire(process.cwd());\nexport const x = load("./x");\n'],
    [FILE, 'import { createRequire } from "node:module";\nvar load = createRequire(import.meta.url);\nvar load = createRequire(process.cwd());\nexport const x = load.resolve("./x");\n'],
    [FILE, 'export const x = require.main.require("./x");\n'],
    [FILE, 'export const x = process.mainModule.require("./x");\n'],
    [FILE, 'export const x = import.meta.glob(["../editor/index.ts", "/src/editor/*.ts"]);\n'],
    [FILE, 'export const x = import.meta.glob("./schema.ts", { base: "../editor" });\n'],
    [FILE, 'export const x = import.meta.glob("./schema.ts", { base: "/src/editor", eager: true });\n'],
    [FILE, '/// <Reference PATH="../editor/schema.ts" />\nexport {};\n'],
    [FILE, '/// <reference x="a>b" path="../editor/schema.ts" />\nexport {};\n'],
    [FILE, '/// <reference /> path="../editor/schema.ts"\nexport {};\n'],
    ["scripts/probe.mjs", 'import { createRequire } from "node:module";\nfunction load(s) { return s; }\nvar load = createRequire(process.cwd());\nexport const x = load("./src/editor/schema");\n'],
    ["scripts/probe.mjs", 'import { createRequire } from "node:module";\nexport function f(load = createRequire(process.cwd())) { return load("./src/editor/schema"); }\n'],
    [FILE, 'export const x = jest.createMockFromModule("../editor/schema");\n'],
    [FILE, 'export const x = jest.genMockFromModule("../editor/schema");\n'],
  ])("off passes, on catches %s: %j", async (file, text) => {
    expect(await hits(off, file, text)).toBe(0);
    expect(await hits(on, file, text)).toBe(1);
  });

  it.each([
    ["src/editor/probe.ts", 'export * from "./schema";\n'],
    ["src/editor/nested/probe.ts", 'export * from "../schema";\n'],
    ["src/editor/probe.test.ts", 'export * from "@/editor/schema";\n'],
    [FILE, 'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.dirname)("react");\n'],
    [FILE, 'export const x = require.resolve("react", { paths: ["/elsewhere"] });\n'],
    [FILE, 'export const x = new URL("postgres://127.0.0.1/x");\n'],
    [FILE, 'export const x = require.main.require("react");\n'],
    [FILE, 'export const x = import.meta.glob(["../editor/index.ts", "!../editor/x.ts", "/src/lib/*.ts"]);\n'],
    [FILE, '/// <reference types="node" />\n/// <reference path="../editor/index.ts" />\nexport {};\n'],
    [FILE, '/// <REFERENCE TYPES="node" />\nexport {};\n'],
    [FILE, 'export const x = import.meta.glob("./*.ts", { base: "../lib", eager: true });\n'],
    [FILE, 'export const x = import.meta.glob("/src/lib/*.ts", { base: "../editor" });\n'],
  ])("allows %s: %j", async (file, text) => {
    expect(await hits(on, file, text)).toBe(0);
  });

  // An inline directive needs the word "eslint" in a comment. Each file with
  // that word is linted again with directives off.
  it("no file in the repository lifts the rule with a comment", async () => {
    const engine = new ESLint({ cwd: REPO_ROOT, ruleFilter, allowInlineConfig: false });
    const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file))
      .map((file) => join(REPO_ROOT, file))
      .filter((file) => existsSync(file) && /eslint/i.test(readFileSync(file, "utf8")));
    const linted = [];
    for (const file of files) if (!(await engine.isPathIgnored(file))) linted.push(file);
    expect(linted.length).toBeGreaterThan(0);
    const results = await engine.lintFiles(linted);
    expect(results.flatMap((result) => result.messages.map((m) => `${result.filePath}:${m.line}`))).toEqual([]);
  }, 120_000);
});
