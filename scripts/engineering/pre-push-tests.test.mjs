import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FULL_VARIABLE, SAFE_PATH_RE, fileReadingTests, plan, pnpmCommand } from "./pre-push-tests.mjs";

const M = (file) => ({ status: "M", file });

test("added or modified TypeScript source and unit or property tests only is scoped", () => {
  assert.equal(
    plan([M("src/editor/a.ts"), M("src/components/b.tsx"), { status: "A", file: "tests/unit/a.test.ts" }, M("tests/property/p.property.test.ts")]),
    "scoped",
  );
});

test("anything a test could reach other than through imports runs the whole suite", () => {
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
    // setup files and helpers are loaded by configuration, not by imports
    "tests/property/setup.ts",
    "tests/unit/helpers/fixture.ts",
    // data files read by a helper module
    "src/domain/forensics/golden-vectors/evidence-v2.json",
    "src/server/db/query.sql",
    "src/notes.md",
    // odd names
    "src/a b.ts",
    "src/\"quoted\".ts",
    "src/../package.json",
  ]) {
    assert.equal(plan([M("src/a.ts"), M(file)]), "full", file);
  }
});

test("a deleted, renamed or type-changed file runs the whole suite", () => {
  for (const status of ["D", "R", "C", "T", "U", "X", "", undefined]) {
    assert.equal(plan([M("src/a.ts"), { status, file: "src/domain/forensics/load.ts" }]), "full", String(status));
  }
});

test("no changes, unknown changes and the override run the whole suite", () => {
  assert.equal(plan([]), "full");
  assert.equal(plan(null), "full");
  assert.equal(plan(undefined), "full");
  assert.equal(plan([M("src/a.ts")], { [FULL_VARIABLE]: "1" }), "full");
  assert.equal(plan([M("src/a.ts")], { [FULL_VARIABLE]: "0" }), "scoped");
  assert.equal(plan([42]), "full");
  assert.equal(plan(["src/a.ts"]), "full");
  assert.equal(plan([null]), "full");
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

test("pnpm starts through cmd.exe on Windows and directly elsewhere, never with a shell option", () => {
  assert.deepEqual(pnpmCommand(["test"], "linux"), ["pnpm", ["test"]]);
  assert.deepEqual(pnpmCommand(["test"], "win32"), ["cmd.exe", ["/d", "/s", "/c", "pnpm", "test"]]);
  assert.doesNotMatch(readFileSync(new URL("./pre-push-tests.mjs", import.meta.url), "utf8"), /shell\s*:/);
});

test("only plain test paths are passed on; anything with shell characters means a full run", () => {
  for (const ok of ["src/a/b.test.ts", "tests/unit/auth/routes.test.ts", "src/components/x@y.test.tsx"]) assert.match(ok, SAFE_PATH_RE);
  for (const bad of ["src/a b.test.ts", "src/a&b.test.ts", "src/a;b.test.ts", "src/$(x).test.ts", 'src/a".test.ts', "src/a%b.test.ts"]) {
    assert.doesNotMatch(bad, SAFE_PATH_RE);
  }
});
