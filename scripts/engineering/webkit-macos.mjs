// DAN-114 (#1040): the WebKit E2E job on a macOS runner
// (.github/workflows/webkit-macos.yml). It runs the whole `webkit` project of
// playwright.config.ts without a Compose stack and leaves nothing out
// (CLAUDE.md: no test is skipped or quarantined). The tests in KNOWN_FAILURES
// fail on macOS WebKit only (#1046), so the job stays red until they are
// fixed. The list only labels the failures in the job summary: a failure
// outside it is a new regression, a listed test that passes leaves the list.
// The exit code is always Playwright's own.
//
//   node scripts/engineering/webkit-macos.mjs
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const KNOWN_ISSUE = 1046;
export const KNOWN_FAILURES = Object.freeze([
  { file: "e2e/app-shell.spec.ts", title: "the focused skip link is drawn above the side bar" },
  { file: "e2e/landing.spec.ts", title: "the skip link moves focus to the content" },
  {
    file: "e2e/bullet-item.spec.ts",
    title: "Enter, Backspace and Tab at the edges of an item; the ids stay apart; the journal keeps the items",
  },
  {
    file: "e2e/quote.spec.ts",
    title: "'> ', Enter and Backspace at the edges of a quote; the ids stay apart; the journal keeps it",
  },
  {
    file: "e2e/local-editor.spec.ts",
    title: "9 and line 53: the chip says Spremljeno na uređaju only once the write is stored",
  },
  { file: "e2e/local-editor.spec.ts", title: "a refused wait for the lock tells the author instead of staying blocked" },
  { file: "e2e/status-bar.spec.ts", title: "status bar: words without a range, pages, a selection, never the server" },
]);

export const REPORT = "test-results/webkit-macos.json";

/** The Playwright arguments: the whole project, no title filter. */
export function playwrightArgs() {
  return ["--project=webkit", "--reporter=list,html,json"];
}

/** Tests of a Playwright JSON report, as {file, title, failed}. */
export function reportedTests(report) {
  const out = [];
  const walk = (suite, file) => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const path = `e2e/${spec.file ?? here}`.replaceAll("\\", "/");
      for (const one of spec.tests ?? []) out.push({ file: path, title: spec.title, failed: one.status === "unexpected" });
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite, suite.file);
  return out;
}

/**
 * Errors of a Playwright JSON report outside any single test (worker
 * teardown, global setup, a file that does not load). None is in
 * KNOWN_FAILURES, so each one is a new failure.
 */
export function reportErrors(report) {
  return (report?.errors ?? []).map((error) => {
    const text = String(error?.message ?? error?.value ?? "").split("\n")[0].trim() || "unknown error";
    const where = error?.location?.file ? ` (${String(error.location.file).replaceAll("\\", "/")})` : "";
    return `${text}${where}`;
  });
}

const key = ({ file, title }) => `${file} › ${title}`;

/** Splits the failures into known (#1046) and new, and names listed tests that passed or did not run. */
export function classify(tests, list = KNOWN_FAILURES) {
  const known = new Set(list.map(key));
  const failed = new Set(tests.filter((t) => t.failed).map(key));
  const seen = new Set(tests.map(key));
  return {
    known: [...failed].filter((k) => known.has(k)),
    fresh: [...failed].filter((k) => !known.has(k)),
    fixed: [...known].filter((k) => seen.has(k) && !failed.has(k)),
    missing: [...known].filter((k) => !seen.has(k)),
  };
}

/** Markdown for the job summary. */
export function summary({ known, fresh, fixed, missing }, errors = []) {
  const lines = ["## WebKit E2E (macOS)", ""];
  const block = (head, items) => {
    if (items.length) lines.push(head, ...items.map((k) => `- ${k}`), "");
  };
  block(`**New failures outside a test** (${errors.length}), not tracked in #${KNOWN_ISSUE}:`, errors);
  block(`**New failures** (${fresh.length}), not tracked in #${KNOWN_ISSUE}:`, fresh);
  block(`Known failures (${known.length}), tracked in #${KNOWN_ISSUE}:`, known);
  block(`Listed for #${KNOWN_ISSUE} but passed; take them off KNOWN_FAILURES:`, fixed);
  block(`Listed for #${KNOWN_ISSUE} but did not run (renamed or removed?):`, missing);
  if (lines.length === 2) lines.push("No failures.");
  return lines.join("\n");
}

/** The job's exit code: Playwright's status, never softened by the list. */
export const exitCode = (status) => (status === 0 ? 0 : status || 1);

// The Playwright CLI under this Node, without a shell, the same on every platform.
const CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");

function main() {
  const run = spawnSync(process.execPath, [CLI, "test", ...playwrightArgs()], {
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: REPORT, PLAYWRIGHT_HTML_OPEN: "never" },
  });
  try {
    const report = JSON.parse(readFileSync(REPORT, "utf8"));
    const text = summary(classify(reportedTests(report)), reportErrors(report));
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch (error) {
    console.error(`No summary: ${error.message}`);
  }
  return exitCode(run.status);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
