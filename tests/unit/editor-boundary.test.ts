import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// DAN-927 (E-0.1): src/editor is the editor-core package; code outside it
// imports only its entry, src/editor/index.ts (@/editor).
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RULE = "editor-boundary/entry-only";
const eslint = new ESLint({ cwd: REPO_ROOT });
const withoutInlineConfig = new ESLint({ cwd: REPO_ROOT, allowInlineConfig: false, ruleFilter: ({ ruleId }) => ruleId === RULE });

beforeAll(async () => {
  await eslint.lintText("export {};\n", { filePath: "src/lib/probe.ts" });
  await withoutInlineConfig.lintText("export {};\n", { filePath: "src/lib/probe.ts" });
}, 60_000);

async function hits(engine: ESLint, filePath: string, code: string) {
  const [result] = await engine.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === RULE).length;
}

// Each form names the module with the placeholder M.
const FORMS = [
  'import { x } from "M";\nexport const y = x;\n',
  'import type { X } from "M";\nexport type Y = X;\n',
  'export * from "M";\n',
  'export { x } from "M";\n',
  'export const y = () => import("M");\n',
  'export const y = require("M");\n',
  'export const y = require.resolve("M");\n',
  'import { createRequire } from "node:module";\nexport const y = createRequire(import.meta.url)("M");\n',
  'export const y = import.meta.resolve("M");\n',
];
// Type-only forms that TypeScript resolves like an import; only in TS files.
const TYPE_FORMS = [
  'export type Y = import("M").X;\n',
  'export type Y = typeof import("M");\n',
  'import y = require("M");\nexport { y };\n',
];
const OUTSIDE = ["src/lib/probe.ts", "app/probe/page.tsx", "tests/unit/probe.test.ts", "scripts/probe.mjs"];

// Seen from src/lib/probe.ts, and from e2e/support/probe.ts for paths through src/.
const DEEP = [
  ["src/lib/probe.ts", "@/editor/schema"],
  ["src/lib/probe.ts", "@/editor/schema.ts"],
  ["src/lib/probe.ts", "@/editor/capture.fixture"],
  ["src/lib/probe.ts", "@/editor/capture.test"],
  ["src/lib/probe.ts", "@/editor/index/../schema"],
  ["src/lib/probe.ts", "@/editor//./schema"],
  ["src/lib/probe.ts", "@/Editor/Schema"],
  ["src/lib/probe.ts", "@/EDITOR/schema"],
  ["src/lib/probe.ts", "@/editor/schema?x"],
  ["src/lib/probe.ts", "@/editor/schema#x"],
  ["src/lib/probe.ts", " @/editor/schema "],
  // Escapes in the source: tab and CRLF, NBSP, DEL.
  ["src/lib/probe.ts", "\\t@/editor/schema\\r\\n"],
  ["src/lib/probe.ts", "\\u00a0@/editor/schema\\u00a0"],
  ["src/lib/probe.ts", "@/editor/schema\\u007f"],
  ["src/lib/probe.ts", "../editor/schema"],
  ["src/lib/probe.ts", "..\\\\editor\\\\schema"],
  ["src/lib/probe.ts", "./../editor/./interop"],
  ["src/lib/journal/probe.ts", "../../editor/storable-text"],
  ["app/probe/page.tsx", "../../src/editor/schema"],
  ["e2e/support/probe.ts", "../../src/editor/capture"],
  ["e2e/probe.spec.ts", "../src/editor/bullet-item"],
  ["spikes/a/b/probe.ts", "../../../src/editor/schema"],
  ["src/lib/probe.ts", "src/editor/schema"],
  ["src/lib/probe.ts", "/repo/src/editor/schema"],
  // A suffix that holds a path is not a query to TypeScript or require.
  ["src/lib/probe.ts", "@/editor?/../editor/schema"],
  ["src/lib/probe.ts", "@/editor#/../editor/schema"],
  ["src/lib/probe.ts", "@/editor/index?/../schema"],
  ["src/lib/journal/probe.ts", "../../editor?/../editor/schema"],
  // Node ESM decodes percent escapes in a path.
  ["src/lib/probe.ts", "../%65ditor/schema.ts"],
  ["src/lib/probe.ts", "@/%45ditor/schema"],
  // Node ESM reads the URL path before its query or fragment, even when the
  // suffix holds a "/".
  ["scripts/probe.mjs", "../src/editor/schema.ts?cache=/../../v1"],
  // Read as a path this is the entry; read as a URL it is schema.ts.
  ["scripts/probe.mjs", "../src/editor/schema.ts?v=/../index.ts"],
  ["src/lib/probe.ts", "../editor/schema#/../../x"],
  ["src/lib/probe.ts", "../%65ditor/schema.ts?a=/../.."],
] as const;

const ENTRY = [
  ["src/lib/probe.ts", "@/editor"],
  ["src/lib/probe.ts", "@/editor/"],
  ["src/lib/probe.ts", "@/editor/index"],
  ["src/lib/probe.ts", "@/editor/index.ts"],
  // A query or fragment after the entry still names the entry.
  ["src/lib/probe.ts", "@/editor/index.ts?raw"],
  ["src/lib/probe.ts", "@/editor/index#x"],
  ["src/lib/probe.ts", "@/editor?x"],
  ["src/lib/probe.ts", "@/editor#x"],
  ["src/lib/probe.ts", "../editor"],
  ["e2e/support/probe.ts", "../../src/editor"],
  ["e2e/probe.spec.ts", "../src/editor/"],
  // Another directory that only starts with the same name.
  ["src/lib/probe.ts", "@/components/editor/sources"],
  ["src/lib/probe.ts", "@/editor-like/schema"],
  ["src/lib/probe.ts", "../editors/schema"],
  ["src/lib/probe.ts", "@tiptap/core"],
] as const;

const form = (code: string, specifier: string) => code.replace("M", specifier);

describe("code outside src/editor does not bypass its entry (DAN-927)", () => {
  it.each(DEEP.flatMap(([file, specifier]) => FORMS.map((code) => [file, form(code, specifier)] as const)))(
    "rejects %s: %s",
    async (filePath, code) => {
      expect(await hits(eslint, filePath, code)).toBe(1);
    },
  );

  it.each(OUTSIDE.flatMap((file) => FORMS.map((code) => [file, form(code, "@/editor/schema")] as const)))(
    "rejects in %s: %s",
    async (filePath, code) => {
      expect(await hits(eslint, filePath, code)).toBe(1);
    },
  );

  it.each(ENTRY.flatMap(([file, specifier]) => FORMS.map((code) => [file, form(code, specifier)] as const)))(
    "allows %s: %s",
    async (filePath, code) => {
      expect(await hits(eslint, filePath, code)).toBe(0);
    },
  );

  it.each(DEEP.flatMap(([file, specifier]) => TYPE_FORMS.map((code) => [file, form(code, specifier)] as const)))(
    "rejects the type form %s: %s",
    async (filePath, code) => {
      expect(await hits(eslint, filePath, code)).toBe(1);
    },
  );

  it.each(ENTRY.flatMap(([file, specifier]) => TYPE_FORMS.map((code) => [file, form(code, specifier)] as const)))(
    "allows the type form %s: %s",
    async (filePath, code) => {
      expect(await hits(eslint, filePath, code)).toBe(0);
    },
  );

  it.each(DEEP.filter(([file]) => file === "src/lib/probe.ts").map(([, specifier]) => form(FORMS[0], specifier)))(
    "allows inside the package: %s",
    async (code) => {
      expect(await hits(eslint, "src/editor/probe.ts", code)).toBe(0);
      expect(await hits(eslint, "src/editor/probe.test.ts", code)).toBe(0);
    },
  );

  it("the entry re-exports modules, not tests or fixtures", () => {
    const entry = readFileSync(join(REPO_ROOT, "src/editor/index.ts"), "utf8");
    const sources = [...entry.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((source) => !/^\.\/[a-z0-9-]+$/u.test(source) || /\.(?:fixture|test)$|-test$/u.test(source))).toEqual([]);
    expect(sources.filter((source) => /fixture|test/u.test(source))).toEqual([]);
  });

  // ESLint may run from another directory, such as an editor's workspace
  // folder: a relative path is still resolved from the repository root.
  it("resolves a relative path when ESLint runs from src/", async () => {
    const fromSrc = new ESLint({ cwd: join(REPO_ROOT, "src"), overrideConfigFile: join(REPO_ROOT, "eslint.config.mjs") });
    expect(await hits(fromSrc, join(REPO_ROOT, "src/lib/probe.ts"), 'import { x } from "../editor/schema";\nexport const y = x;\n')).toBe(1);
    expect(await hits(fromSrc, join(REPO_ROOT, "src/lib/journal/probe.ts"), 'import { x } from "../../editor/capture";\nexport const y = x;\n')).toBe(1);
    expect(await hits(fromSrc, join(REPO_ROOT, "src/lib/probe.ts"), 'import { x } from "../editor";\nexport const y = x;\n')).toBe(0);
    // The package's own files stay exempt.
    expect(await hits(fromSrc, join(REPO_ROOT, "src/editor/probe.ts"), 'import { x } from "./block-marker";\nexport const y = x;\n')).toBe(0);
    expect(await hits(fromSrc, join(REPO_ROOT, "src/editor/probe.ts"), 'import { x } from "@/editor/schema";\nexport const y = x;\n')).toBe(0);
  }, 60_000);

  // createRequire resolves a relative path from the base it was given, not
  // from the calling file. A base that is not static is not known, so any
  // relative path through it is rejected.
  const INDEX = join(REPO_ROOT, "src/editor/index.ts");
  const load = (base: string, call: string) => `import { createRequire } from "node:module";\nimport path from "node:path";\nconst root = process.cwd();\nconst req = createRequire(${base});\nexport const y = ${call};\n`;
  it.each([
    [JSON.stringify(INDEX), 'req.resolve("./schema.ts")'],
    [JSON.stringify(INDEX), 'req("./schema")'],
    [JSON.stringify(pathToFileURL(INDEX).href), 'req("./capture")'],
    [JSON.stringify(join(REPO_ROOT, "src/editor") + "/"), 'req("./schema")'],
    ['new URL("../src/editor/index.ts", import.meta.url)', 'req("./schema")'],
    ['import.meta.url', 'req("../src/editor/schema")'],
    ['path.join(root, "package.json")', 'req("./src/editor/schema")'],
    ['path.join(root, "package.json")', 'req.resolve("../anything")'],
    // An invalid URL base is not known either, and must not stop ESLint.
    ['new URL("file://[", import.meta.url)', 'req("./tool.cjs")'],
  ])("rejects createRequire(%s) with %s", async (base, call) => {
    expect(await hits(eslint, "scripts/probe.mjs", load(base, call))).toBe(1);
  });

  // Node reads a base without a trailing slash as a file: a dirname resolves
  // from its parent.
  it.each(["import.meta.dirname", "__dirname"])("resolves createRequire(%s) from the parent directory", async (base) => {
    expect(await hits(eslint, "src/lib/probe.mjs", load(base, 'req("./editor/schema")'))).toBe(1);
    expect(await hits(eslint, "src/lib/probe.mjs", load(base, 'req("./editor")'))).toBe(0);
  });

  it.each([
    [JSON.stringify(INDEX), 'req("./index")'],
    [JSON.stringify(INDEX), 'req(".")'],
    ['new URL("../src/editor/index.ts", import.meta.url)', 'req("../lib/journal")'],
    ['import.meta.url', 'req("../src/editor")'],
    ['path.join(root, "package.json")', 'req("pg-boss")'],
    ['path.join(root, "package.json")', 'req("@/editor")'],
  ])("allows createRequire(%s) with %s", async (base, call) => {
    expect(await hits(eslint, "scripts/probe.mjs", load(base, call))).toBe(0);
  });

  it("does not read a computed specifier", async () => {
    expect(await hits(eslint, "src/lib/probe.ts", 'const m = "@/editor/schema";\nexport const y = () => import(m);\n')).toBe(0);
  });
});

function mayHideImport(source: string) {
  return /eslint|editor/i.test(source);
}

const DIRECTIVES = [
  "// eslint-disable-next-line editor-boundary/entry-only\n",
  "/* eslint-disable */\n",
  "/* eslint editor-boundary/entry-only: off */\n",
];

describe("inline directives do not lift the editor boundary (DAN-927)", () => {
  it.each(DIRECTIVES)("a comment hides the import from pnpm lint but not here: %s", async (directive) => {
    const code = `${directive}import { x } from "@/editor/schema";\nexport const y = x;\n`;
    expect(await hits(eslint, "src/lib/probe.ts", code)).toBe(0);
    expect(await hits(withoutInlineConfig, "src/lib/probe.ts", code)).toBe(1);
  });

  // A file can hide an import from pnpm lint only with an inline directive, and
  // a directive needs the word "eslint" in a comment. The specifier itself may
  // be escaped so that the file never names the editor (F-019).
  it("the repository scan reads every file that could hide an import", () => {
    expect(mayHideImport('/* eslint-disable */\nimport * as m from "@/\\u0065ditor/schema";\n')).toBe(true);
    expect(mayHideImport('import { x } from "@/editor";\n')).toBe(true);
    expect(mayHideImport("export const y = 1;\n")).toBe(false);
  });

  // Every source file outside src/editor that names the editor or carries a
  // directive, with directives off: the move to the entry is complete and
  // nothing hides from it.
  it("no file outside src/editor imports past the entry", async () => {
    const skipped = /(?:^|\/)node_modules\/|^(?:\.git|\.next|\.claude\/worktrees|playwright-report(?:-login)?|test-results(?:-login)?)\/|^src\/editor\//;
    const files = readdirSync(REPO_ROOT, { recursive: true, encoding: "utf8" })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !skipped.test(file) && /\.(?:[cm]?[jt]sx?)$/.test(file))
      .map((file) => join(REPO_ROOT, file))
      .filter((file) => mayHideImport(readFileSync(file, "utf8")));
    expect(files.length).toBeGreaterThan(10);
    const results = await withoutInlineConfig.lintFiles(files);
    expect(results.flatMap((result) => result.messages.map((message) => `${result.filePath}:${message.line} ${message.ruleId}`))).toEqual([]);
  }, 120_000);
});
