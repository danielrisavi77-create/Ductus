/**
 * Node side of the input origin suite (M3.5-P01, D-54 spike, DAN-390):
 * bundles `source-harness.entry.ts` once per run and serves it with its page
 * through `context.route`, so no route of the application is reached and
 * nothing is added to the production build.
 */

import type { BrowserContext, Page } from "@playwright/test";

import { prepareBundle } from "./evidence-harness";

export const SOURCE_HARNESS_URL = "http://localhost:3000/__source-harness";

const PAGE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>Izvor unosa</title>
<style>
  body { font: 16px/1.5 sans-serif; margin: 16px; }
  #editor .ProseMirror { min-height: 160px; padding: 8px; outline: 1px solid #767676; white-space: pre-wrap; }
  #editor p { margin: 0 0 12px; }
</style>
</head>
<body>
<div id="editor"></div>
<script src="/__source-harness.js"></script>
</body>
</html>`;

let bundle: Promise<string> | undefined;

/** Called from `beforeAll` with a generous timeout. */
export function prepareSourceHarness(outputDir: string): Promise<string> {
  bundle ??= prepareBundle(outputDir, "source-harness.entry.ts", "SourceHarness");
  return bundle;
}

/** Serves the page and the bundle to every page of `context`. */
export async function installSourceHarness(context: BrowserContext): Promise<void> {
  if (!bundle) throw new Error("source harness: call prepareSourceHarness in beforeAll first");
  const code = await bundle;
  await context.route(`${SOURCE_HARNESS_URL}*`, (route) =>
    route.request().url().endsWith(".js")
      ? route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: code })
      : route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }));
}

/** Opens the harness in `page` and puts the caret in the editor. */
export async function openSourceHarness(page: Page): Promise<void> {
  await page.goto(SOURCE_HARNESS_URL);
  await page.waitForFunction(() => window.__source?.ready === true);
  await page.locator("#editor .ProseMirror").click();
}
