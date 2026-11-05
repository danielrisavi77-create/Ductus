#!/usr/bin/env node
// DAN-663: prints the inputs of the Playwright browser cache key. Browser builds
// are pinned by playwright-core, so the key follows its version in pnpm-lock.yaml
// (not a hash of the whole lockfile) plus the runner image (ImageOS), so a new
// image with other system libraries never restores a stale apt or browser cache.
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Top-level keys under packages:/snapshots: are indented by exactly two spaces.
// Dependency lines ("      playwright-core: 1.59.0") and peer suffixes of other
// packages ("@axe-core/playwright@4.13.0(playwright-core@1.60.0)") never match.
const KEY = /^ {2}(['"]?)playwright-core@([^\s'"():]+)(\([^\r\n]*\))?\1:/gm;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IMAGE = /^[A-Za-z0-9._-]{1,40}$/;

export function playwrightCoreVersion(lockText) {
  const found = new Set();
  for (const match of lockText.matchAll(KEY)) {
    const version = match[2];
    if (!SEMVER.test(version) || version.includes("..")) {
      throw new Error(`playwright-core has an unexpected version in pnpm-lock.yaml: ${JSON.stringify(version)}`);
    }
    found.add(version);
  }
  if (found.size !== 1) {
    const list = [...found].join(", ") || "none";
    throw new Error(`expected exactly one playwright-core version in pnpm-lock.yaml, found: ${list}`);
  }
  return [...found][0];
}

export function imageLabel(env, platform) {
  const image = env.ImageOS ? env.ImageOS : platform;
  if (!IMAGE.test(image)) {
    throw new Error(`ImageOS is not a plain image name: ${JSON.stringify(image).slice(0, 60)}`);
  }
  return image;
}

function main() {
  const lockPath = process.argv[2] ?? "pnpm-lock.yaml";
  try {
    const version = playwrightCoreVersion(readFileSync(lockPath, "utf8"));
    const image = imageLabel(process.env, process.platform);
    const lines = `version=${version}\nimage=${image}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
    else process.stdout.write(lines);
  } catch (error) {
    console.log(`::error::Playwright cache key: ${error.message}`);
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
