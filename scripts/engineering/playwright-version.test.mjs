import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { imageLabel, playwrightCoreVersion } from "./playwright-version.mjs";

// DAN-663: the Playwright browser cache key follows the playwright-core version
// in pnpm-lock.yaml (browser builds are pinned by playwright-core) and the
// runner image, not a hash of the whole lockfile. Every input class from the
// contract on #1091 is a row here.
const script = fileURLToPath(new URL("./playwright-version.mjs", import.meta.url));
const lock = (...lines) => ["lockfileVersion: '9.0'", "", "packages:", "", ...lines, ""].join("\n");

const versions = [
  ["one version", lock("  playwright-core@1.63.0:", "    resolution: {integrity: sha512-x}"), "1.63.0"],
  ["the same version in packages and snapshots", lock("  playwright-core@1.63.0:", "    engines: {node: '>=18'}", "", "snapshots:", "", "  playwright-core@1.63.0: {}"), "1.63.0"],
  ["a quoted key", lock("  'playwright-core@1.63.0':"), "1.63.0"],
  ["a double-quoted key", lock('  "playwright-core@1.63.0":'), "1.63.0"],
  ["a prerelease", lock("  playwright-core@1.64.0-alpha-2026-11-01:"), "1.64.0-alpha-2026-11-01"],
  ["a peer suffix on a snapshot key", lock("  playwright-core@1.63.0:", "  playwright-core@1.63.0(x@1.0.0): {}"), "1.63.0"],
  ["CRLF line endings", lock("  playwright-core@1.63.0:", "    resolution: {}").replace(/\n/g, "\r\n"), "1.63.0"],
  ["related names next to it are not counted", lock("  playwright@1.62.0:", "  '@playwright/test@1.61.0':", "  playwright-core-x@9.9.9:", "  '@axe-core/playwright@4.13.0(playwright-core@1.60.0)':", "      playwright-core: 1.59.0", "  playwright-core@1.63.0: {}"), "1.63.0"],
  ["the real lockfile", null, "real"],
];

for (const [name, text, expected] of versions) {
  test(`version: ${name}`, async () => {
    if (text === null) {
      const real = await readFile(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
      assert.match(playwrightCoreVersion(real), /^\d+\.\d+\.\d+$/);
      return;
    }
    assert.equal(playwrightCoreVersion(text), expected);
  });
}

const rejected = [
  ["no playwright-core at all", lock("  playwright@1.63.0:")],
  ["only an indented dependency line", lock("  x@1.0.0:", "    dependencies:", "      playwright-core: 1.63.0")],
  ["two different versions", lock("  playwright-core@1.63.0:", "  playwright-core@1.62.0:")],
  ["a version with a dollar sign", lock("  playwright-core@1.63.0$(id):")],
  ["a version with a space", lock("  playwright-core@1.63.0 x:")],
  ["a version with a slash", lock("  playwright-core@1.63.0/../x:")],
  ["a version that is not semver", lock("  playwright-core@latest:")],
  ["an empty file", ""],
];

for (const [name, text] of rejected) {
  test(`version rejected: ${name}`, () => {
    assert.throws(() => playwrightCoreVersion(text), /playwright-core/);
  });
}

const images = [
  ["a hosted Ubuntu image", { ImageOS: "ubuntu24" }, "linux", "ubuntu24"],
  ["a hosted Windows image", { ImageOS: "win25" }, "win32", "win25"],
  ["a hosted macOS image", { ImageOS: "macos15" }, "darwin", "macos15"],
  ["no ImageOS falls back to the platform", {}, "linux", "linux"],
  ["an empty ImageOS falls back to the platform", { ImageOS: "" }, "darwin", "darwin"],
];

for (const [name, env, platform, expected] of images) {
  test(`image: ${name}`, () => assert.equal(imageLabel(env, platform), expected));
}

for (const bad of ["ubuntu 24", "ubuntu24$(id)", "a/b", "x".repeat(41), "ubuntu24\n"]) {
  test(`image rejected: ${JSON.stringify(bad).slice(0, 30)}`, () => {
    assert.throws(() => imageLabel({ ImageOS: bad }, "linux"), /ImageOS/);
  });
}

async function cli(lockText, env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-version-"));
  const lockPath = path.join(dir, "pnpm-lock.yaml");
  const output = path.join(dir, "output");
  await writeFile(lockPath, lockText);
  await writeFile(output, "");
  const result = spawnSync(process.execPath, [script, lockPath], {
    env: { ...process.env, ImageOS: "ubuntu24", ...env, GITHUB_OUTPUT: output },
    encoding: "utf8",
  });
  const written = await readFile(output, "utf8");
  await rm(dir, { recursive: true, force: true });
  return { ...result, written };
}

test("the CLI writes version and image to GITHUB_OUTPUT", async () => {
  const { status, written } = await cli(lock("  playwright-core@1.63.0:"));
  assert.equal(status, 0);
  assert.equal(written, "version=1.63.0\nimage=ubuntu24\n");
});

test("the CLI fails with ::error:: and writes nothing for a bad lockfile or image", async () => {
  for (const [text, env] of [[lock("  playwright@1.63.0:"), {}], [lock("  playwright-core@1.63.0:"), { ImageOS: "a b" }]]) {
    const { status, stdout, written } = await cli(text, env);
    assert.equal(status, 1);
    assert.match(stdout, /^::error::/m);
    assert.equal(written, "");
  }
});
