import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Advisory only: never use this plan to skip tests. Whole specs deliberately
// include other routes; CSS consumers and this map need review before expansion.
export const UI_PATH = "src/components/landing/Landing.module.css";
export const UI_SPECS = ["landing", "home", "shell", "accessibility", "screenshots"]
  .map((name) => `e2e/${name}.spec.ts`);
const full = (reason, changedFiles = []) => ({ selection: "full", reason, changedFiles, specs: null });
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

export function classifyUiDiff(raw) {
  if (!raw) return full("empty-diff");
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 2) return full("invalid-diff");
  const changedFiles = [];
  let candidate = true;
  for (let i = 0; i < fields.length; i += 2) {
    const header = /^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([A-Z]\d*)$/.exec(fields[i]);
    if (!header || !fields[i + 1]) return full("invalid-diff");
    changedFiles.push(fields[i + 1]);
    candidate &&= header[1] === "100644" && header[2] === "100644" &&
      header[3] === "M" && fields[i + 1] === UI_PATH;
  }
  return candidate ? { selection: "candidate", reason: "landing-css-only", changedFiles, specs: UI_SPECS }
    : full("outside-pilot", changedFiles);
}

export function uiPlan({ eventName, baseRef, baseSha, headSha, cwd = process.cwd() } = {}) {
  if (eventName !== "pull_request" || baseRef !== "main") return full("non-main-pr");
  if (!sha(baseSha) || !sha(headSha)) return full("invalid-sha");
  try {
    return classifyUiDiff(execFileSync("git", [
      "--no-replace-objects", "diff", "--raw", "-z", "--abbrev=40", "--no-renames",
      "--no-ext-diff", "--no-textconv", "--no-relative", baseSha, headSha, "--",
    ], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    return full("diff-unavailable");
  }
}

const finite = (value) => Number.isFinite(value) && value >= 0;
const outcomes = ["expected", "unexpected", "flaky", "skipped"];
const statuses = ["passed", "failed", "timedOut", "skipped", "interrupted"];

export function compareReport(plan, report, { cwd = process.cwd(), projects = ["desktop", "mobile"] } = {}) {
  const tests = [], problems = new Set(), seen = new Set();
  const problem = (reason) => problems.add(reason);
  const root = report?.config?.rootDir;
  if (typeof root !== "string" || resolve(root) !== resolve(cwd, "e2e")) problem("invalid-root");
  if (!Array.isArray(report?.errors) || report.errors.length) problem("report-errors");
  function visit(suites) {
    if (!Array.isArray(suites)) { problem("invalid-suites"); return; }
    for (const suite of suites) {
      if (!Array.isArray(suite?.specs)) { problem("invalid-specs"); continue; }
      for (const spec of suite.specs) {
        if (typeof spec?.file !== "string" || typeof root !== "string" || !Array.isArray(spec.tests)) {
          problem("invalid-spec"); continue;
        }
        const file = relative(cwd, resolve(root, spec.file)).split(sep).join("/");
        if (!/^e2e\/(?:[\w-]+\/)*[\w-]+\.spec\.ts$/.test(file) || typeof spec.id !== "string" || !spec.id) {
          problem("invalid-test-path"); continue;
        }
        for (const test of spec.tests) {
          if (!test || typeof test.projectName !== "string" || !outcomes.includes(test.status) ||
            !Array.isArray(test.results)) { problem("invalid-test"); continue; }
          const id = `${spec.id}/${test.projectName}`;
          if (seen.has(id)) problem("duplicate-test");
          seen.add(id);
          const results = test.results;
          if (results.length !== 1 || test.expectedStatus !== "passed") problem("incomplete-attempts");
          if (results.some((r) => !r || !statuses.includes(r.status) || !finite(r.duration))) {
            problem("invalid-result"); continue;
          }
          if (results.some((r) => ["skipped", "interrupted"].includes(r.status))) problem("unfinished-test");
          if (test.status === "expected" && results.some((r) => r.status !== "passed")) problem("inconsistent-outcome");
          if (test.status !== "expected" && results.every((r) => r.status === "passed")) problem("inconsistent-outcome");
          tests.push({ id, file, project: test.projectName, outcome: test.status,
            selected: plan.selection === "full" || plan.specs.includes(file),
            failed: ["unexpected", "flaky"].includes(test.status) || results.some((r) => ["failed", "timedOut"].includes(r.status)),
            statuses: results.map((r) => r.status), durationMs: results.reduce((n, r) => n + r.duration, 0) });
        }
      }
      if (suite.suites !== undefined) visit(suite.suites);
    }
  }
  visit(report?.suites);
  if (!tests.length) problem("empty-report");
  for (const outcome of outcomes) {
    const n = report?.stats?.[outcome];
    if (!Number.isInteger(n) || n < 0 || n !== tests.filter((t) => t.outcome === outcome).length) problem("stats-mismatch");
  }
  if (!finite(report?.stats?.duration)) problem("invalid-duration");
  const actualProjects = [...new Set(tests.map((t) => t.project))].sort();
  if (JSON.stringify(actualProjects) !== JSON.stringify([...projects].sort())) problem("incomplete-projects");
  // Every spec in the proposed set must be represented in every browser.
  for (const file of UI_SPECS) for (const project of projects) {
    if (!tests.some((t) => t.file === file && t.project === project)) problem("missing-pilot-spec");
  }
  const summarize = (rows) => ({ count: rows.length, failures: rows.filter((t) => t.failed).length,
    testWorkMs: rows.reduce((n, t) => n + t.durationMs, 0) });
  const missed = tests.filter((t) => !t.selected && t.failed).map((t) => t.id);
  const complete = problems.size === 0;
  return {
    comparison: missed.length ? "miss-observed" : !complete ? "inconclusive"
      : plan.selection === "candidate" ? "no-miss-observed" : "not-applicable",
    complete, problems: [...problems], missed,
    full: summarize(tests), selected: summarize(tests.filter((t) => t.selected)),
    excluded: summarize(tests.filter((t) => !t.selected)),
    candidateInventory: summarize(tests.filter((t) => UI_SPECS.includes(t.file))),
    byProject: actualProjects.map((project) => ({ project, full: summarize(tests.filter((t) => t.project === project)),
      selected: summarize(tests.filter((t) => t.project === project && t.selected)) })),
    fullRunDurationMs: finite(report?.stats?.duration) ? report.stats.duration : null, tests,
  };
}

export function runPilot(env = process.env, cwd = process.cwd()) {
  const plan = uiPlan({ eventName: env.EVENT_NAME, baseRef: env.PR_BASE_REF,
    baseSha: env.PR_BASE, headSha: env.PR_HEAD, cwd });
  let report = null;
  try { report = JSON.parse(readFileSync(resolve(cwd, "test-results/ui-pilot-full.json"), "utf8")); } catch { /* inconclusive */ }
  const evidence = { mode: "shadow", scope: "standard-e2e", policyVersion: 1,
    baseSha: sha(env.PR_BASE) ? env.PR_BASE : null, headSha: sha(env.PR_HEAD) ? env.PR_HEAD : null,
    testedSha: sha(env.GITHUB_SHA) ? env.GITHUB_SHA : null, ...plan,
    ...compareReport(plan, report, { cwd, projects: env.EVENT_NAME === "pull_request"
      ? ["desktop", "mobile"] : ["desktop", "mobile", "firefox", "webkit"] }) };
  mkdirSync(resolve(cwd, "playwright-report"), { recursive: true });
  writeFileSync(resolve(cwd, "playwright-report/ui-test-pilot.json"), JSON.stringify(evidence, null, 2) + "\n");
  const summary = `## UI test selection pilot (shadow)\n\n` +
    `Selection: **${evidence.selection}** (${evidence.reason}). Comparison: **${evidence.comparison}**.\n\n` +
    `Full: ${evidence.full.count}; hypothetical selection: ${evidence.selected.count}; excluded: ${evidence.excluded.count}; missed failures: ${evidence.missed.length}.\n\n` +
    `Selected failures: ${evidence.selected.failures}. Complete report: ${evidence.complete}. Problems: ${evidence.problems.join(", ") || "none"}.\n\n` +
    `Candidate inventory (irrespective of diff): ${evidence.candidateInventory.count}. Full run: ${evidence.fullRunDurationMs ?? "unknown"} ms.\n\n` +
    `Test work: selected ${evidence.selected.testWorkMs} / full ${evidence.full.testWorkMs} ms. This is not a wall-clock speedup estimate.\n\n` +
    `All existing tests remain required. No-miss-observed is not approval to skip tests. Details: playwright-report/ui-test-pilot.json.\n`;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runPilot();
