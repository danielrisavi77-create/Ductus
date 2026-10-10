import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: REPO_ROOT });
const DYNAMIC_RULE = "database-boundary/no-restricted-dynamic-imports";
const BOUNDARY_MESSAGE = "Database access goes through src/server/db only.";
const RESTRICTED_SPECIFIERS = ["pg", "pg/lib/utils", "pg-cursor", "pg-boss/lib/manager"];
const APPLICATION_FILES = ["app/api/probe/route.ts", "src/application/probe.ts"];
const EXCEPTION_FILES = ["src/server/db/probe.ts", "tests/integration/probe.integration.test.ts"];
const SOURCE_FORMS = ["quoted", "template"] as const;

function dynamicImport(specifier: string, form: (typeof SOURCE_FORMS)[number]) {
  const source = form === "quoted" ? JSON.stringify(specifier) : `\`${specifier}\``;
  return `export async function probe() { return import(${source}); }\n`;
}

function dynamicCases(files: string[], specifiers: string[]) {
  return files.flatMap((filePath) =>
    specifiers.flatMap((specifier) =>
      SOURCE_FORMS.map((form) => [filePath, specifier, form] as const),
    ),
  );
}

// The first lintText call loads the ESLint config and the TypeScript parser,
// which takes several seconds on a busy machine. Pay that once here, with its
// own budget, so it is not charged to the first case's 5 s test timeout.
beforeAll(async () => {
  await eslint.lintText("export {};\n", { filePath: "src/application/probe.ts" });
}, 60_000);

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

describe("pg dynamic import boundary hardening (eslint.config.mjs)", () => {
  it.each(dynamicCases(APPLICATION_FILES, RESTRICTED_SPECIFIERS))(
    "rejects %s importing %s as a %s literal",
    async (filePath, specifier, form) => {
      expect(await lint(filePath, dynamicImport(specifier, form))).toEqual([
        expect.objectContaining({
          ruleId: DYNAMIC_RULE,
          severity: 2,
          message: BOUNDARY_MESSAGE,
        }),
      ]);
    },
  );

  it.each(dynamicCases(EXCEPTION_FILES, RESTRICTED_SPECIFIERS))(
    "allows %s importing %s as a %s literal",
    async (filePath, specifier, form) => {
      expect(await lint(filePath, dynamicImport(specifier, form))).toEqual([]);
    },
  );

  it.each(dynamicCases(APPLICATION_FILES, ["./pg-like", "pgx"]))(
    "allows unrelated %s importing %s as a %s literal",
    async (filePath, specifier, form) => {
      expect(await lint(filePath, dynamicImport(specifier, form))).toEqual([]);
    },
  );

  // This static guard does not resolve arbitrary variables, concatenations or
  // interpolated templates, even when their runtime value could be "pg".
  it.each(APPLICATION_FILES.flatMap((filePath) => [
    [filePath, 'export function probe(specifier: string) { return import(specifier); }\n'],
    [filePath, 'export function probe(suffix: string) { return import("pg" + suffix); }\n'],
    [filePath, 'export function probe(suffix: string) { return import(`pg${suffix}`); }\n'],
  ]))("documents computed-source limits in %s: %s", async (filePath, code) => {
    expect(await lint(filePath, code)).toEqual([]);
  });

  it.each([
    ["src/application/probe.ts", 'import pg from "pg";\nexport const probe = pg;\n'],
    ["app/api/probe/route.ts", 'export { default as probe } from "pg-boss/lib/manager";\n'],
    ["src/application/probe.ts", 'export * from "pg/lib/utils";\n'],
  ])("preserves static restrictions in %s: %s", async (filePath, code) => {
    expect(await lint(filePath, code)).toEqual([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        severity: 2,
        message: expect.stringContaining(BOUNDARY_MESSAGE),
      }),
    ]);
  });
});


const MIXED_CASE_SPECIFIERS = ["PG", "Pg", "PG/lib/utils", "Pg-cursor", "pG-boss/lib/manager"];
const WRAPPED_SOURCES = [
  '"pg" as string',
  '<string>"pg"',
  '"pg"!',
  '"pg" satisfies string',
  '"pg" as const',
  '(("PG-boss/lib/manager" as const) satisfies string)!',
  '`pg` as string',
  '<string>`pg`',
  '`pg`!',
  '`pg` satisfies string',
  '`pg` as const',
  '((`PG-boss/lib/manager` as const) satisfies string)!',
];
const COOKED_SOURCES = ['"\\x50G"', '`\\u0050G/lib/utils`'];

function sourceCases(files: string[], sources: string[]) {
  return files.flatMap((filePath) => sources.map((source) => [filePath, source] as const));
}

function importSource(source: string) {
  return `export async function probe() { return import(${source}); }\n`;
}

async function expectDynamicBoundary(filePath: string, code: string) {
  expect(await lint(filePath, code)).toEqual([
    expect.objectContaining({
      ruleId: DYNAMIC_RULE,
      severity: 2,
      message: BOUNDARY_MESSAGE,
    }),
  ]);
}

describe("pg dynamic import final-review regressions", () => {
  it.each(dynamicCases(APPLICATION_FILES, MIXED_CASE_SPECIFIERS))(
    "preserves case-insensitive policy in %s for %s as %s",
    async (filePath, specifier, form) => {
      await expectDynamicBoundary(filePath, dynamicImport(specifier, form));
    },
  );

  it.each(dynamicCases(EXCEPTION_FILES, MIXED_CASE_SPECIFIERS))(
    "preserves case-insensitive exception in %s for %s as %s",
    async (filePath, specifier, form) => {
      expect(await lint(filePath, dynamicImport(specifier, form))).toEqual([]);
    },
  );

  it.each(dynamicCases(APPLICATION_FILES, ["./PG-like", "PGx", "@scope/PG"]))(
    "allows nonfamily %s importing %s as %s",
    async (filePath, specifier, form) => {
      expect(await lint(filePath, dynamicImport(specifier, form))).toEqual([]);
    },
  );

  it.each(sourceCases(APPLICATION_FILES, COOKED_SOURCES))(
    "rejects decoded literal in %s: %s",
    async (filePath, source) => {
      await expectDynamicBoundary(filePath, importSource(source));
    },
  );

  it.each(sourceCases(EXCEPTION_FILES, COOKED_SOURCES))(
    "allows decoded literal exception in %s: %s",
    async (filePath, source) => {
      expect(await lint(filePath, importSource(source))).toEqual([]);
    },
  );

  it.each(sourceCases(APPLICATION_FILES, WRAPPED_SOURCES))(
    "rejects type-only wrapped literal in %s: %s",
    async (filePath, source) => {
      await expectDynamicBoundary(filePath, importSource(source));
    },
  );

  it.each(sourceCases(EXCEPTION_FILES, WRAPPED_SOURCES))(
    "allows type-only wrapped literal exception in %s: %s",
    async (filePath, source) => {
      expect(await lint(filePath, importSource(source))).toEqual([]);
    },
  );

  it.each(sourceCases(APPLICATION_FILES, [
    '"PGx" as const', '<string>"./PG-like"', '`PGx`!', '`./PG-like` satisfies string',
  ]))("allows wrapped nonfamily literal in %s: %s", async (filePath, source) => {
    expect(await lint(filePath, importSource(source))).toEqual([]);
  });

  // Erasing type-only wrappers does not evaluate the remaining runtime expression.
  it.each(APPLICATION_FILES.flatMap((filePath) => [
    [filePath, 'export function probe(specifier: string) { return import(specifier as string); }\n'],
    [filePath, 'export function probe(suffix: string) { return import(("PG" + suffix) satisfies string); }\n'],
    [filePath, 'export function probe(suffix: string) { return import(`PG${suffix}`!); }\n'],
  ]))("keeps wrapped computed limits in %s: %s", async (filePath, code) => {
    expect(await lint(filePath, code)).toEqual([]);
  });

  it.each(APPLICATION_FILES.flatMap((filePath) =>
    MIXED_CASE_SPECIFIERS.map((specifier) => [filePath, specifier]),
  ))("confirms static case parity in %s for %s", async (filePath, specifier) => {
    expect(await lint(filePath, `export * from ${JSON.stringify(specifier)};\n`)).toEqual([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        severity: 2,
        message: expect.stringContaining(BOUNDARY_MESSAGE),
      }),
    ]);
  });
});
