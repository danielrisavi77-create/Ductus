import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNewTestExempt } from "./protected-paths.mjs";

// An exact allowlist, not every Markdown file: governance, fixtures and docs
// consumed by tools must retain the full stack. Risk/review policy is separate.
// DAN-710 (owner, #87 c.6807060821): a document joins only while no tracked
// file outside Markdown reads it (ci-docs-scope-allowlist.test.mjs).
export const ORDINARY_DOCS = Object.freeze([
  "README.md",
  "docs/UX-EVAL.md",
  "docs/AI-PRUZATELJI-MATRICA.md",
  "docs/PILOT.md",
  "docs/PRISTUPACNOST.md",
  "docs/adr/2026-10-11-ugovor-spremanja-i-zapisa.md",
  "docs/adr/2026-11-02-dnevnik-potvrda-po-domeni.md",
  "docs/adr/2026-11-06-zabiljezeni-pristup-podrske.md",
  "docs/adr/2026-11-10-model-racuna-i-ugovorni-model.md",
  "docs/arhiva/ISTRAZIVANJE-ALATA-2026-10-25.md",
  "docs/arhiva/ISTRAZIVANJE-TEHNOLOGIJA-2026-10-19.md",
  "docs/arhiva/README.md",
  "docs/contracts/ai-request-v1.md",
  "docs/contracts/ai-tools-v1.md",
  "docs/contracts/submission-worker-m7-v1.md",
  "docs/engineering/d91-mjere.md",
  "docs/engineering/prihvat-M0.md",
  "docs/engineering/prihvat-M1-tehnicki.md",
  "docs/engineering/prihvat-M2-jezgra.md",
  "docs/engineering/prijenos-jezgre-M0.1.md",
  "docs/engineering/zamke.md",
  "docs/privacy/README.md",
  "docs/privacy/01-tokovi-podataka.md",
  "docs/privacy/02-procjena-ucinka-kostur.md",
  "docs/privacy/03-obavijest-o-privatnosti-nacrt.md",
  "docs/privacy/04-podizvrsitelji-i-atributi-prijave.md",
  "docs/privacy/05-otvorena-pitanja.md",
  "docs/privacy/07-prijedlog-rokova-cuvanja.md",
  "docs/spikes/B0.2.md",
  "docs/spikes/M5.11-S.md",
  "docs/spikes/M8.1-P03.md",
  "docs/spikes/M8.8-P02.md",
]);
const ORDINARY = new Set(ORDINARY_DOCS);

// The tests profile skips the stack, DB, browser, property, local and build steps
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
    if (`${before} ${after}` !== expected || !ORDINARY.has(path)) ordinary = false;
    if (`${before} ${after}` !== expected || !isUnitTestPath(path)) testOnly = false;
  }
  if (ordinary) return "docs";
  if (testOnly && fields.length > 0) return "tests";
  return "full";
}

export function ciProfile({ eventName, baseRef, headRef, author, baseSha, headSha, cwd } = {}) {
  // Only protected main supplies trusted classifier code. Stacked PRs, main
  // pushes and nightly runs exercise the entire application/browser matrix.
  if (eventName !== "pull_request" || baseRef !== "main") return "full";
  // DAN-710: a Mergify CI carrier tests the queue's batch on current main and
  // always runs full, recognised by either event field; a missing one is full.
  if (typeof headRef !== "string" || !headRef || /^mergify\//i.test(headRef)) return "full";
  if (typeof author !== "string" || !author || /^mergify\[bot\]$/i.test(author)) return "full";
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
    headRef: process.env.PR_HEAD_REF, author: process.env.PR_AUTHOR,
    baseSha: process.env.PR_BASE, headSha: process.env.PR_HEAD,
  });
  console.log(`profile=${profile}`);
}
