import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FULL_VARIABLE, fileReadingTests, plan } from "./pre-push-tests.mjs";

test("a change to source and unit or property tests only is scoped", () => {
  assert.equal(plan(["src/editor/a.ts", "tests/unit/a.test.ts", "tests/property/p.property.test.ts"]), "scoped");
});

test("anything a test could read from elsewhere runs the whole suite", () => {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "vitest.config.ts",
    "tsconfig.json",
    "docs/DECISIONS.md",
    ".github/CODEOWNERS",
    "lefthook.yml",
    "scripts/demo/up.mjs",
    "infra/fake-oidc/server.mjs",
    "db/migrations/1.sql",
    "tests/integration/a.integration.test.ts",
    "tests/property/setup.ts-not-a-prefix/../../package.json",
  ]) {
    assert.equal(plan(["src/a.ts", file]), "full", file);
  }
});

test("no changes, unknown changes and the override run the whole suite", () => {
  assert.equal(plan([]), "full");
  assert.equal(plan(null), "full");
  assert.equal(plan(undefined), "full");
  assert.equal(plan(["src/a.ts"], { [FULL_VARIABLE]: "1" }), "full");
  assert.equal(plan(["src/a.ts"], { [FULL_VARIABLE]: "0" }), "scoped");
  assert.equal(plan([42]), "full");
});

test("tests that read files are found, others and node_modules are not", () => {
  const root = mkdtempSync(join(tmpdir(), "prepush-"));
  try {
    for (const dir of ["src/a", "tests/unit", "tests/property", "src/node_modules/x"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "src/a/reads.test.ts"), 'import { readFileSync } from "node:fs";\n');
    writeFileSync(join(root, "src/a/promises.test.tsx"), 'import { readFile } from "node:fs/promises";\n');
    writeFileSync(join(root, "tests/unit/pure.test.ts"), 'import { it } from "vitest";\n');
    writeFileSync(join(root, "tests/unit/helper.ts"), 'import { readFileSync } from "node:fs";\n');
    writeFileSync(join(root, "src/node_modules/x/reads.test.ts"), 'import "node:fs";\n');
    assert.deepEqual(fileReadingTests(root), ["src/a/promises.test.tsx", "src/a/reads.test.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
