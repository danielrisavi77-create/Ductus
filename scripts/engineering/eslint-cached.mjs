// `pnpm lint`: ESLint with its content cache in a folder named after a digest
// of everything that decides the lint result besides the linted file itself.
// ESLint's own cache key hashes the serialised config, which leaves out the
// code of a local plugin rule (eslint.config.mjs) and the code of upgraded
// plugins, so either change would otherwise reuse stale results (#428 review).
// Usage: node scripts/engineering/eslint-cached.mjs [extra eslint args]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The config holds the local rules; the lockfile pins ESLint and every plugin.
export const LINT_INPUTS = ["eslint.config.mjs", "pnpm-lock.yaml"];
export const CACHE_ROOT = "node_modules/.cache/eslint";

/** Digest of the lint inputs under `root`; a missing input counts as its own value. */
export function lintDigest(root) {
  const hash = createHash("sha256");
  for (const name of LINT_INPUTS) {
    const file = path.join(root, name);
    hash.update(`${name}\0`);
    hash.update(existsSync(file) ? readFileSync(file) : "\0missing\0");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/** Cache folder for the current inputs; folders for other digests are removed. */
export function prepareCacheDir(root) {
  const base = path.join(root, CACHE_ROOT);
  const digest = lintDigest(root);
  mkdirSync(base, { recursive: true });
  for (const entry of readdirSync(base)) {
    if (entry !== digest) rmSync(path.join(base, entry), { recursive: true, force: true });
  }
  return path.join(base, digest) + path.sep;
}

function main() {
  const root = process.cwd();
  const require = createRequire(import.meta.url);
  const eslintBin = path.join(path.dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
  const args = [
    eslintBin,
    ".",
    "--cache",
    "--cache-location",
    prepareCacheDir(root),
    "--cache-strategy",
    "content",
    ...process.argv.slice(2),
  ];
  // Same module lookup as pnpm's node_modules/.bin/eslint shim: plugins that
  // eslint-config-next loads by name are hoisted to node_modules/.pnpm/node_modules.
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const nodePath = [path.join(repo, "node_modules/.pnpm/node_modules"), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, NODE_PATH: nodePath },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
