import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FULL_VARIABLE, SAFE_PATH_RE, describe, explain, fileReadingTests, localImports, plan, pnpmCommand } from "./pre-push-tests.mjs";

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
    "scripts/local/up.mjs",
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

test("the reason for a full run names the changes that caused it", () => {
  assert.deepEqual(explain([M("src/a.ts"), M("docs/A.md"), { status: "D", file: "src/b.ts" }]), {
    mode: "full", reason: "changes a test may reach other than through imports", files: ["M docs/A.md", "D src/b.ts"],
  });
  assert.equal(explain([M("src/a.ts")]).mode, "scoped");
  assert.deepEqual(explain([M("src/a.ts")], { [FULL_VARIABLE]: "1" }), { mode: "full", reason: `${FULL_VARIABLE}=1`, files: [] });
  assert.match(explain(null).reason, /unknown/);
  assert.match(explain([]).reason, /no changed files/);
  assert.deepEqual(explain([null, 7]).files, ["null", "7"]);
  const many = Array.from({ length: 7 }, (_, i) => M(`docs/${i}.md`));
  assert.deepEqual(describe(explain(many)), [
    "pre-push: full test run (pnpm test): changes a test may reach other than through imports.",
    ...[0, 1, 2, 3, 4].map((i) => `  M docs/${i}.md`),
    "  ... and 2 more",
  ]);
  assert.deepEqual(describe(explain([M("src/a.ts")])), ["pre-push: scoped run: only added or modified src/ and unit or property test files."]);
});

test("a test that reads files through a repository module, a child process or a bare fs import is found", () => {
  const root = mkdtempSync(join(tmpdir(), "prepush-deep-"));
  try {
    for (const dir of ["src/lib/scan", "src/domain/pure", "tests/unit/helpers", "scripts/terms"]) mkdirSync(join(root, dir), { recursive: true });
    const files = {
      "src/lib/scan/index.ts": 'import { readdirSync } from "fs";\n',
      "src/domain/pure/index.ts": 'export const x = 1;\n',
      "src/domain/pure/cycle-a.ts": 'import "./cycle-b";\n',
      "src/domain/pure/cycle-b.ts": 'import { a } from "./cycle-a";\n',
      "tests/unit/helpers/tree.ts": 'export { scan } from "@/lib/scan";\n',
      "scripts/terms/scan.mjs": 'const fs = await import("node:fs/promises");\n',
      // a directory alias resolves to its index file, never to the directory itself
      "tests/unit/alias-dir.test.ts": 'import { scan } from "@/lib/scan";\n',
      "tests/unit/helper.test.ts": 'import { scan } from "./helpers/tree";\n',
      "tests/unit/script.test.ts": 'import "../../scripts/terms/scan.mjs";\n',
      "tests/unit/spawns.test.ts": 'import { spawnSync } from "node:child_process";\n',
      "tests/unit/cycle.test.ts": 'import "@/domain/pure/cycle-a";\nimport "@/domain/pure";\n',
      "tests/unit/package.test.ts": 'import { it } from "vitest";\nimport x from "some-package/fs";\n',
      "tests/unit/missing.test.ts": 'import "./helpers/gone";\n',
      "tests/unit/unreadable.test.ts": 'import "./helpers/locked";\n',
      "tests/unit/helpers/locked.ts": "",
    };
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
    const read = (file) => {
      if (file.endsWith("locked.ts")) throw new Error("EACCES");
      return readFileSync(file, "utf8");
    };
    assert.deepEqual(fileReadingTests(root, read), [
      "tests/unit/alias-dir.test.ts", "tests/unit/helper.test.ts", "tests/unit/script.test.ts",
      "tests/unit/spawns.test.ts", "tests/unit/unreadable.test.ts",
    ]);
    assert.deepEqual(localImports("tests/unit/x.test.ts", 'import a from "../../src/a.js";\nimport b from "react";', (f) => f === "src/a.ts"), ["src/a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
