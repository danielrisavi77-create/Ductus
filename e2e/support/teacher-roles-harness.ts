/**
 * Node side of the teacher roles suite (DAN-581, plan #1592 C1): bundles
 * `teacher-roles-harness.entry.ts` once per run and serves it with its page
 * through `context.route`, so no route of the application is reached and
 * nothing is added to the production build. Each test answers the role
 * routes itself.
 */

import type { BrowserContext, Page } from "@playwright/test";

import { prepareBundle } from "./evidence-harness";

export const ROLES_HARNESS_URL = "http://localhost:3000/__teacher-roles-harness";

const PAGE = `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<title>Korisnici i uloge</title>
<style>body { font: 16px/1.5 sans-serif; margin: 16px; }</style>
</head>
<body>
<div id="root"></div>
<script src="/__teacher-roles-harness.js"></script>
</body>
</html>`;

let bundle: Promise<string> | undefined;

/** Called from `beforeAll` with a generous timeout. */
export function prepareTeacherRolesHarness(outputDir: string): Promise<string> {
  bundle ??= prepareBundle(outputDir, "teacher-roles-harness.entry.ts", "TeacherRolesHarness");
  return bundle;
}

/** Serves the page and the bundle to every page of `context`. */
export async function installTeacherRolesHarness(context: BrowserContext): Promise<void> {
  if (!bundle) throw new Error("teacher roles harness: call prepareTeacherRolesHarness in beforeAll first");
  const code = await bundle;
  await context.route(`${ROLES_HARNESS_URL}*`, (route) =>
    route.request().url().endsWith(".js")
      ? route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: code })
      : route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGE }));
}

/** Opens the harness in `page` once the lists are on it. */
export async function openTeacherRolesHarness(page: Page): Promise<void> {
  await page.goto(ROLES_HARNESS_URL);
  await page.waitForFunction(() => window.__roles !== undefined && document.querySelector("li button") !== null);
}
