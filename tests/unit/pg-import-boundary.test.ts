import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({ cwd: REPO_ROOT });

async function restrictedImports(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports").length;
}

describe("pg import boundary (eslint.config.mjs)", () => {
  it.each([
    ["src/domain/example.ts", 'import pg from "pg";\nexport const x = pg;\n'],
    ["src/application/example.ts", 'import { Pool } from "pg";\nexport const x = Pool;\n'],
    ["app/api/example/route.ts", 'import Cursor from "pg-cursor";\nexport const x = Cursor;\n'],
    ["src/server/session.ts", 'import { escapeLiteral } from "pg/lib/utils";\nexport const x = escapeLiteral;\n'],
  ])("rejects the driver in %s", async (filePath, code) => {
    expect(await restrictedImports(filePath, code)).toBe(1);
  });

  it.each([
    ["src/server/db/pool.ts", 'import pg from "pg";\nexport const x = pg;\n'],
    ["tests/integration/example.integration.test.ts", 'import pg from "pg";\nexport const x = pg;\n'],
    ["src/domain/example.ts", 'import { page } from "./pg-like";\nexport const x = page;\n'],
  ])("allows %s", async (filePath, code) => {
    expect(await restrictedImports(filePath, code)).toBe(0);
  });
});
