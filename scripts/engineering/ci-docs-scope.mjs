import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNewTestExempt } from "./protected-paths.mjs";

// An exact allowlist, not every Markdown file: governance, fixtures and docs
// consumed by tools must retain the full stack. Risk/review policy is separate.
const ORDINARY_DOCS = new Set([
  "README.md",
  "docs/UX-EVAL.md",
  "docs/privacy/README.md",
  "docs/privacy/01-tokovi-podataka.md",
  "docs/privacy/02-procjena-ucinka-kostur.md",
  "docs/privacy/03-obavijest-o-privatnosti-nacrt.md",
  "docs/privacy/04-podizvrsitelji-i-atributi-prijave.md",
  "docs/privacy/05-otvorena-pitanja.md",
]);

// The tests profile skips the stack, DB, browser, property, local launcher and build steps
// (#971), so it takes only paths on the review exemption's allowlist
// (isNewTestExempt: src/ without src/app/ and src/pages/, or tests/unit/) that
// the always-on vitest `unit` project runs: *.test.ts, not property or
// integration tests. One source, so the gate and CI cannot disagree.
const NOT_UNIT_RE = /\.(?:property|integration)\.test\.ts$/;

function isUnitTestPath(path) {
  return isNewTestExempt(path) && path.endsWith(".test.ts") && !NOT_UNIT_RE.test(path);
}

export function classifyDiff(raw) {
  if (!raw) return "full";
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) throw new Error("Incomplete git diff");
  let ordinary = true;
  let testOnly = true;
  for (let i = 0; i < fields.length; i += 2) {
    const header = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z]\d*)$/.exec(fields[i]);
    if (!header || !fields[i + 1]) throw new Error("Invalid git diff record");
    const [, before, after, , , status] = header;
    const expected = { A: "000000 100644", D: "100644 000000", M: "100644 100644" }[status];
    const path = fields[i + 1];
    if (`${before} ${after}` !== expected || !ORDINARY_DOCS.has(path)) ordinary = false;
    if (`${before} ${after}` !== expected || !isUnitTestPath(path)) testOnly = false;
  }
  if (ordinary) return "docs";
  if (testOnly && fields.length > 0) return "tests";
  return "full";
}

export function ciProfile({ eventName, baseRef, baseSha, headSha, cwd } = {}) {
  // Only protected main supplies trusted classifier code. Stacked PRs, main
  // pushes and nightly runs exercise the entire application/browser matrix.
  if (eventName !== "pull_request" || baseRef !== "main") return "full";
  if (![baseSha, headSha].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error("CI scope requires immutable full commit SHAs");
  }
  // Compare immutable objects, never the live REST file list of a moving PR.
  // No rename detection: both the old and new path must qualify. Direct base
  // vs head is conservative for a stale branch (extra changes force full).
  const raw = execFileSync("git", [
    "--no-replace-objects", "diff", "--raw", "-z", "--abbrev=40", "--no-renames",
    "--no-ext-diff", "--no-textconv", "--no-relative", baseSha, headSha, "--",
  ], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // A git error or output limit throws; it cannot produce a docs exemption.
  return classifyDiff(raw);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = ciProfile({
    eventName: process.env.EVENT_NAME, baseRef: process.env.PR_BASE_REF,
    baseSha: process.env.PR_BASE, headSha: process.env.PR_HEAD,
  });
  console.log(`profile=${profile}`);
}
