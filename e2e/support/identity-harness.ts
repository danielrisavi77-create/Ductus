/**
 * Node side of the block identity suite: bundles the harness entry once per
 * run and serves it to the page.
 *
 * The page is fulfilled by `page.route`, so nothing here needs a route in the
 * application and nothing is added to the production build. The bundle is
 * made with the Vite that Vitest already brings; it is resolved through
 * Vitest because the project does not list Vite itself as a dependency.
 */

import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expect, type Page } from "@playwright/test";

import type { HarnessBlock } from "./identity-harness.entry";

type Bundler = {
  build(config: object): Promise<{ output: { code?: string }[] } | { output: { code?: string }[] }[]>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_URL = "http://localhost:3000/__block-identity-harness";

const PAGE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>Identitet blokova</title>
<style>
  body { font: 16px/1.5 sans-serif; margin: 16px; }
  #editor .ProseMirror { min-height: 240px; padding: 8px; outline: 1px solid #767676; white-space: pre-wrap; }
  #editor p, #editor h1, #editor h2, #editor h3 { margin: 0 0 12px; }
  #source { min-height: 24px; padding: 8px; outline: 1px dashed #767676; }
</style>
</head>
<body>
<div id="source" contenteditable="true" aria-label="Vanjski sadržaj"></div>
<div id="editor"></div>
<script src="/__block-identity-harness.js"></script>
</body>
</html>`;

let bundle: Promise<string> | undefined;

async function buildBundle(): Promise<string> {
  const fromHere = createRequire(import.meta.url);
  const fromVitest = createRequire(fromHere.resolve("vitest/package.json"));
  const vite = (await import(pathToFileURL(fromVitest.resolve("vite")).href)) as Bundler;
  const result = await vite.build({
    configFile: false,
    logLevel: "silent",
    root: path.resolve(here, "../.."),
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      minify: false,
      lib: { entry: path.join(here, "identity-harness.entry.ts"), formats: ["iife"], name: "BlockIdentityHarness" },
    },
  });
  const code = (Array.isArray(result) ? result[0] : result).output[0]?.code;
  if (!code) {
    throw new Error("identity harness: the bundle is empty");
  }
  return code;
}

/**
 * Makes the bundle available to this worker. Called from `beforeAll` with a
 * generous timeout, so the build never counts against a test. The first
 * worker builds and writes the bundle under the run's output directory (which
 * Playwright empties when a run starts); the others read it.
 */
export function prepareIdentityHarness(outputDir: string): Promise<string> {
  bundle ??= (async () => {
    const directory = path.join(outputDir, ".block-identity-harness");
    const file = path.join(directory, `bundle-${process.ppid}.js`);
    await mkdir(directory, { recursive: true });
    return withLock(path.join(directory, "build.lock"), 120_000, async () => {
      const ready = await readFile(file, "utf8").catch(() => null);
      if (ready) {
        return ready;
      }
      const code = await buildBundle();
      await writeFile(`${file}.${process.pid}`, code);
      await rename(`${file}.${process.pid}`, file);
      return code;
    });
  })();
  return bundle;
}

/** Opens the harness page with the given editor content (Tiptap JSON) or an empty editor. */
export async function openIdentityHarness(page: Page, seed?: object): Promise<void> {
  if (!bundle) {
    throw new Error("identity harness: call prepareIdentityHarness in beforeAll first");
  }
  const code = await bundle;
  await page.route(`${HARNESS_URL}*`, (route) =>
    route.request().url().endsWith(".js")
      ? route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: code })
      : route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }),
  );
  if (seed) {
    await page.addInitScript((content) => {
      window.__identitySeed = content;
    }, seed);
  }
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => window.__identity?.ready === true);
}

const CLIPBOARD_LOCK = path.join(tmpdir(), "ductus-e2e-clipboard.lock");
const CLIPBOARD_LOCK_STALE_MS = 8_000;

/**
 * Runs a copy-then-paste sequence while no other worker of this suite uses
 * the clipboard. Firefox and WebKit write to the clipboard of the operating
 * system, which every worker shares, so two sequences at once would paste
 * each other's content.
 */
export function withClipboard<T>(run: () => Promise<T>): Promise<T> {
  // A sequence takes a second or two.
  return withLock(CLIPBOARD_LOCK, CLIPBOARD_LOCK_STALE_MS, run);
}

/**
 * A lock shared by the worker processes: a directory that only one of them
 * can create. A lock older than `staleMs` was left by a worker that was
 * stopped while holding it and must not block the rest.
 */
async function withLock<T>(lock: string, staleMs: number, run: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      // Windows answers EPERM or EBUSY while another worker is still removing the directory.
      if (!["EEXIST", "EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        throw error;
      }
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > staleMs) {
        await rmdir(lock).catch(() => undefined);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
  try {
    return await run();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}

/** The canonical blocks; fails when the document has no canonical form. */
export async function blocksOf(page: Page): Promise<HarnessBlock[]> {
  const result = await page.evaluate(() => window.__identity!.blocks());
  if (!Array.isArray(result)) {
    throw new Error(`the document has no canonical form: ${JSON.stringify(result.errors)}`);
  }
  expect(new Set(result.map((block) => block.id.toLowerCase())).size).toBe(result.length);
  return result;
}
