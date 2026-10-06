import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

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
