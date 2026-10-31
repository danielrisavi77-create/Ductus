// DAN-114 (#1040): the WebKit E2E job on a macOS runner
// (.github/workflows/webkit-macos.yml). It runs the `webkit` project of
// playwright.config.ts without a Compose stack, minus the tests listed in
// KNOWN_FAILURES, which fail on macOS WebKit only (#1046) and still run on
// Linux. An entry leaves this list once its test passes on the macOS runner.
//
//   node scripts/engineering/webkit-macos.mjs   (CI: list check, then run)
import { spawnSync } from "node:child_process";
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

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern that matches a listed test by its own title, at the end of Playwright's title path. */
export function knownPattern(list = KNOWN_FAILURES) {
  return list.length ? `(?:${list.map(({ title }) => `${escape(title)}$`).join("|")})` : null;
}

/** Tests of a `playwright test --list --reporter=json` report, as {file, title}. */
export function listedTests(report) {
  const out = [];
  const walk = (suite, file) => {
    const here = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      // one entry per test of the spec, so a test selected twice is visible
      const entry = { file: `e2e/${spec.file ?? here}`.replaceAll("\\", "/"), title: spec.title };
      out.push(...(spec.tests ?? []).map(() => entry));
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of report?.suites ?? []) walk(suite, suite.file);
  return out;
}

/** Problems when the pattern selects anything but exactly the listed tests, once each. */
export function checkSelection(selected, list = KNOWN_FAILURES) {
  const key = ({ file, title }) => `${file} › ${title}`;
  const want = list.map(key).sort();
  const got = selected.map(key).sort();
  return JSON.stringify(want) === JSON.stringify(got)
    ? []
    : [`the known-failure pattern selects ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`];
}

// The Playwright CLI under this Node, without a shell, so the pattern reaches
// it as one argument on every platform. `pnpm test:e2e` is `playwright test`.
const CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");
const playwright = (args, options = {}) => spawnSync(process.execPath, [CLI, "test", ...args], { stdio: "inherit", ...options });

function main() {
  const pattern = knownPattern();
  if (pattern) {
    const list = playwright(["--list", "--reporter=json", "--project=webkit", "--grep", pattern], {
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (list.status !== 0) return list.status ?? 1;
    const problems = checkSelection(listedTests(JSON.parse(list.stdout)));
    if (problems.length) {
      for (const problem of problems) console.error(problem);
      return 1;
    }
    console.log(`Leaving out ${KNOWN_FAILURES.length} tests known to fail on macOS WebKit (#${KNOWN_ISSUE}).`);
  }
  const run = playwright(["--project=webkit", ...(pattern ? ["--grep-invert", pattern] : [])]);
  return run.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
