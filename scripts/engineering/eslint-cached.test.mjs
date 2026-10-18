import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CACHE_ROOT, LINT_INPUTS, lintDigest, prepareCacheDir } from "./eslint-cached.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wrapper = path.join(root, "scripts/engineering/eslint-cached.mjs");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function tempProject(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "ductus-eslint-cache-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("pnpm lint runs the wrapper, not a bare eslint --cache", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts.lint, "node scripts/engineering/eslint-cached.mjs");
  assert.match(read("lefthook.yml"), /run: pnpm lint/);
  assert.match(read(".github/workflows/ci.yml"), /- run: pnpm lint/);
});

test("the config imports no local module the digest would miss", () => {
  const config = read("eslint.config.mjs");
  const specifiers = [...config.matchAll(/\bfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)].map(
    (m) => m[1] ?? m[2],
  );
  assert.ok(specifiers.length > 0);
  for (const spec of specifiers) {
    assert.ok(
      !spec.startsWith(".") && !spec.startsWith("/"),
      `eslint.config.mjs imports ${spec}: add it to LINT_INPUTS in eslint-cached.mjs`,
    );
  }
  assert.deepEqual(LINT_INPUTS, ["eslint.config.mjs", "pnpm-lock.yaml"]);
});

test("the digest changes with the config or the lockfile and nothing else", (t) => {
  const dir = tempProject(t);
  writeFileSync(path.join(dir, "eslint.config.mjs"), "export default [];\n");
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const base = lintDigest(dir);
  writeFileSync(path.join(dir, "a.js"), "export const a = 1;\n");
  assert.equal(lintDigest(dir), base, "a linted file is not a lint input");
  writeFileSync(path.join(dir, "eslint.config.mjs"), "export default [{}];\n");
  const config = lintDigest(dir);
  assert.notEqual(config, base);
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.1'\n");
  assert.notEqual(lintDigest(dir), config);
  rmSync(path.join(dir, "pnpm-lock.yaml"));
  assert.match(lintDigest(dir), /^[0-9a-f]{16}$/);
});

test("the cache folder is per digest and stale folders and files are removed", (t) => {
  const dir = tempProject(t);
  writeFileSync(path.join(dir, "eslint.config.mjs"), "export default [];\n");
  const base = path.join(dir, CACHE_ROOT);
  mkdirSync(path.join(base, "0123456789abcdef"), { recursive: true });
  writeFileSync(path.join(base, ".cache_old"), "{}");
  const location = prepareCacheDir(dir);
  assert.equal(location, path.join(base, lintDigest(dir)) + path.sep);
  assert.deepEqual(readdirSync(base), []);
});

// The #428 review case: a local rule changes its logic and an unchanged file
// that now breaks it must fail, also with a warm cache.
test("changing a local rule's logic re-lints unchanged files", (t) => {
  const dir = tempProject(t);
  const config = (pattern) =>
    `const plugin = { rules: { probe: { create(context) { return { Program(node) {
  if (${pattern}.test(context.sourceCode.text)) context.report({ node, message: "probe hit" });
} }; } } } };
export default [{ files: ["**/*.js"], plugins: { local: plugin }, rules: { "local/probe": "error" } }];
`;
  writeFileSync(path.join(dir, "a.js"), "export const marker = 'FOO';\n");
  writeFileSync(path.join(dir, "eslint.config.mjs"), config("/BAR/"));
  const lint = () => spawnSync(process.execPath, [wrapper], { cwd: dir, encoding: "utf8" });
  const first = lint();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(lint().status, 0, "warm run stays green");
  assert.ok(existsSync(path.join(dir, CACHE_ROOT, lintDigest(dir))), "the cache was written");
  writeFileSync(path.join(dir, "eslint.config.mjs"), config("/FOO/"));
  const changed = lint();
  assert.equal(changed.status, 1, changed.stdout + changed.stderr);
  assert.match(changed.stdout, /probe hit/);
});
