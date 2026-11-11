import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

// F-019 (DAN-156): the database boundary in eslint.config.mjs over the forms
// the import rules alone did not see.
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: REPO_ROOT });
const BOUNDARY_RULES = new Set([
  "no-restricted-imports",
  "database-boundary/no-restricted-dynamic-imports",
  "database-boundary/db-entry-only",
]);
// The same rules with every inline directive ignored: a boundary rule that a
// comment switched off still reports here.
const withoutInlineConfig = new ESLint({
  cwd: REPO_ROOT,
  allowInlineConfig: false,
  ruleFilter: ({ ruleId }) => BOUNDARY_RULES.has(ruleId),
});

beforeAll(async () => {
  await eslint.lintText("export {};\n", { filePath: "src/application/probe.ts" });
  await withoutInlineConfig.lintText("export {};\n", { filePath: "src/application/probe.ts" });
}, 60_000);

async function boundaryRules(engine: ESLint, filePath: string, code: string) {
  const [result] = await engine.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId).filter((ruleId) => BOUNDARY_RULES.has(ruleId ?? ""));
}

const EXTENSIONS = ["ts", "tsx", "jsx", "js", "cjs", "mjs", "cts", "mts"];
const APPLICATION_DIRS = ["app/api/probe/route", "src/application/probe"];
const EXCEPTION_DIRS = ["src/server/db/probe", "tests/integration/probe"];

const DRIVER_FORMS = [
  'export const x = require("pg");\n',
  'export const x = require.resolve("pg-cursor");\n',
  'export const x = module.require("pg/lib/utils");\n',
  'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.url)("pg");\n',
  'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const x = load("pg-boss");\n',
  'export const x = require("../../node_modules/pg");\n',
  'export const x = require("PG?x");\n',
  'import postgres from "postgres";\nexport const x = postgres;\n',
  'export * from "postgres/cjs/src/index.js";\n',
  'export const x = () => import("postgres");\n',
  'export const x = require("postgres");\n',
  'export const x = require("../../node_modules/.pnpm/postgres@3.4.5/node_modules/postgres");\n',
  'import { createRequire as make } from "node:module";\nexport const x = make(import.meta.url)("postgres");\n',
  'import { createRequire } from "node:module";\nexport const x = createRequire(import.meta.url).resolve("pg");\n',
  'import module from "node:module";\nexport const x = module.createRequire(import.meta.url)("pg");\n',
  'export const x = import.meta.resolve("pg");\n',
];

const UNRELATED_FORMS = [
  'export const x = require("./pg-like");\n',
  'export const x = require("pgx");\n',
  'export const x = require("postgres-array");\n',
  'export const x = require("postgresql-client");\n',
  'export const x = new URL("postgres://127.0.0.1:5432/ductus");\n',
  'export const x = String("postgres:");\n',
  // Only calls that load a module are read: "postgres" as a service or
  // program name is not the driver.
  'declare function service(name: string): string;\nexport const x = service("postgres");\n',
  'import { spawn } from "node:child_process";\nexport const x = () => spawn("postgres", ["-D", "data"]);\n',
  'function require(name: string) { return name; }\nexport const x = require("pg");\n',
];

const cases = (dirs: string[], forms: string[]) =>
  dirs.flatMap((dir) => EXTENSIONS.flatMap((ext) => forms.map((code) => [`${dir}.${ext}`, code] as const)));

describe("driver boundary over call forms and drivers (F-019)", () => {
  it.each(cases(APPLICATION_DIRS, DRIVER_FORMS))("rejects %s: %s", async (filePath, code) => {
    expect((await boundaryRules(eslint, filePath, code)).length).toBeGreaterThanOrEqual(1);
  });

  it.each(cases(EXCEPTION_DIRS, DRIVER_FORMS))("allows %s: %s", async (filePath, code) => {
    expect(await boundaryRules(eslint, filePath, code)).toEqual([]);
  });

  it.each(cases(APPLICATION_DIRS, UNRELATED_FORMS))("allows unrelated %s: %s", async (filePath, code) => {
    expect(await boundaryRules(eslint, filePath, code)).toEqual([]);
  });
});

const DEEP_DB_FORMS = [
  'import { createWithActor } from "@/server/db/with-actor";\nexport const x = createWithActor;\n',
  'import type { WithActor } from "@/server/db/with-actor";\nexport type X = WithActor;\n',
  'export { createWithActor } from "@/server/db/with-actor";\n',
  'export * from "@/server/db/index";\n',
  'export const x = () => import("@/server/db/with-actor");\n',
  'export const x = require("../../../src/server/db/with-actor");\n',
  'export const x = require("@/server//db/./with-actor?x");\n',
];

const DB_ENTRY_FORMS = [
  'import { withActor } from "@/server/db";\nexport const x = withActor;\n',
  'export const x = () => import("@/server/db");\n',
];

describe("app/ reaches the database through @/server/db only (F-019)", () => {
  it.each(DEEP_DB_FORMS.map((code) => ["app/api/probe/route.ts", code] as const))(
    "rejects %s: %s",
    async (filePath, code) => {
      expect(await boundaryRules(eslint, filePath, code)).toContain("database-boundary/db-entry-only");
    },
  );

  it.each([
    ...DB_ENTRY_FORMS.map((code) => ["app/api/probe/route.ts", code] as const),
    ...DEEP_DB_FORMS.map((code) => ["src/server/auth/probe.ts", code] as const),
  ])("allows %s: %s", async (filePath, code) => {
    expect(await boundaryRules(eslint, filePath, code)).toEqual([]);
  });

  it("keeps the driver restriction in app/", async () => {
    expect(await boundaryRules(eslint, "app/probe/page.tsx", 'import pg from "pg";\nexport const x = pg;\n')).toEqual([
      "no-restricted-imports",
    ]);
  });
});

const DIRECTIVES = [
  "// eslint-disable-next-line no-restricted-imports\n",
  "/* eslint-disable no-restricted-imports, database-boundary/no-restricted-dynamic-imports */\n",
  "/* eslint-disable */\n",
  "/* eslint no-restricted-imports: off, database-boundary/no-restricted-dynamic-imports: 0 */\n",
];

describe("inline directives do not lift the boundary (F-019)", () => {
  it.each(DIRECTIVES)("a comment hides the import from pnpm lint but not here: %s", async (directive) => {
    const code = `${directive}import pg from "pg";\nexport const x = pg;\n`;
    expect(await boundaryRules(eslint, "src/application/probe.ts", code)).toEqual([]);
    expect(await boundaryRules(withoutInlineConfig, "src/application/probe.ts", code)).toEqual(["no-restricted-imports"]);
  });

  // An inline directive needs the word "eslint" in a comment, so only files
  // with that word can lift a rule. Each is linted again with directives off.
  it("no file in the repository lifts a boundary rule with a comment", async () => {
    const skip = /(?:^|\/)node_modules\/|^(?:\.git|\.next|\.claude|test-results|playwright-report)/;
    const files = readdirSync(REPO_ROOT, { recursive: true, encoding: "utf8" })
      .filter((file) => !skip.test(file) && /\.(?:[cm]?[jt]sx?)$/.test(file))
      .map((file) => join(REPO_ROOT, file))
      .filter((file) => /eslint/i.test(readFileSync(file, "utf8")));
    expect(files.length).toBeGreaterThan(0);
    const results = await withoutInlineConfig.lintFiles(files);
    const hits = results.flatMap((result) =>
      result.messages.map((message) => `${relative(REPO_ROOT, result.filePath)}:${message.line} ${message.ruleId}`),
    );
    expect(hits).toEqual([]);
  }, 60_000);
});
