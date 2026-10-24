// DAN-262: read-only profiling of native Playwright JSON. This is not a coverage gate.
const outcomes = ["expected", "unexpected", "flaky", "skipped"];
const statuses = ["passed", "failed", "timedOut", "skipped", "interrupted"];
const counters = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const check = (ok, message) => { if (!ok) throw new Error(`Invalid Playwright report: ${message}`); };
const duration = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

export function playwrightMetrics(report) {
  check(Array.isArray(report?.suites) && Array.isArray(report.errors), "suites/errors missing");
  check(duration(report.stats?.duration) && Number.isFinite(Date.parse(report.stats.startTime)), "elapsed/startTime missing");
  check(integer(report.config?.workers) && report.config.workers > 0, "workers missing");
  const testedSha = report.config.metadata?.testedSha ?? null;
  check(testedSha === null || (typeof testedSha === "string" && /^[0-9a-f]{40}$/i.test(testedSha)), "invalid tested SHA");
  const shard = report.config.shard ?? null;
  check(shard === null || (integer(shard.current) && integer(shard.total) && shard.current > 0 && shard.current <= shard.total), "invalid shard");
  const files = new Map(), identities = new Set(), projects = new Set();
  const summary = { tests: 0, attempts: 0, workMs: 0, outcomes: counters(outcomes), attemptStatuses: counters(statuses) };
  function visit(suite) {
    check(Array.isArray(suite.specs) && (suite.suites === undefined || Array.isArray(suite.suites)), "invalid suite");
    for (const spec of suite.specs) {
      check(typeof spec.file === "string" && spec.file.length > 0 && typeof spec.id === "string" && spec.id.length > 0, "test identity missing");
      check(Array.isArray(spec.tests) && spec.tests.length > 0, "tests missing");
      const row = files.get(spec.file) ?? { file: spec.file, tests: 0, attempts: 0, workMs: 0, outcomes: counters(outcomes), attemptStatuses: counters(statuses) };
      files.set(spec.file, row);
      const repetitions = new Map();
      for (const test of spec.tests) {
        check(typeof test.projectId === "string" && typeof test.projectName === "string", "project identity missing");
        // Native JSON merges repeat-each instances into one spec without their
        // repeatEachIndex. Their occurrence is bounded by the project config.
        const repeatEach = report.config.projects?.find((p) => p.id === test.projectId)?.repeatEach ?? 1;
        check(integer(repeatEach) && repeatEach > 0, "invalid repeatEach");
        const repetition = repetitions.get(test.projectId) ?? 0;
        check(repetition < repeatEach, "duplicate test instance (repeatEach exceeded)");
        repetitions.set(test.projectId, repetition + 1);
        const key = JSON.stringify([spec.file, spec.id, test.projectId, repetition]);
        check(!identities.has(key), "duplicate test instance");
        identities.add(key);
        projects.add(test.projectName);
        check(outcomes.includes(test.status), "test outcome missing");
        check(Array.isArray(test.results) && test.results.length > 0, "no execution results (a --list inventory is not a timing report)");
        for (const bucket of [row, summary]) { bucket.tests++; bucket.outcomes[test.status]++; }
        for (const [retry, result] of test.results.entries()) {
          check(statuses.includes(result.status) && duration(result.duration) && integer(result.retry), "invalid attempt");
          check(result.retry === retry, "invalid attempt retry sequence");
          for (const bucket of [row, summary]) {
            bucket.attempts++;
            bucket.workMs += result.duration;
            bucket.attemptStatuses[result.status]++;
          }
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  check(summary.tests > 0, "empty execution");
  for (const outcome of outcomes) {
    check(integer(report.stats[outcome]) && report.stats[outcome] === summary.outcomes[outcome], `inconsistent ${outcome} count`);
  }
  return {
    testedSha, startTime: report.stats.startTime, reportedElapsedMs: report.stats.duration,
    workers: report.config.workers, shard, projects: [...projects].sort(), globalErrors: report.errors.length,
    ...summary, files: [...files.values()].sort((a, b) => b.workMs - a.workMs || a.file.localeCompare(b.file)),
  };
}

export function renderPlaywrightMetrics(m) {
  const seconds = (ms) => (ms / 1000).toFixed(1);
  const counts = (obj) => Object.entries(obj).map(([key, n]) => `${key}=${n}`).join(" ");
  return [
    `Playwright timing: SHA ${m.testedSha ?? "unknown/local"}; workers=${m.workers}; shard=${m.shard ? `${m.shard.current}/${m.shard.total}` : "none"}`,
    `reported elapsed=${seconds(m.reportedElapsedMs)} s; summed test work=${seconds(m.workMs)} s; tests=${m.tests}; attempts=${m.attempts}`,
    `outcomes: ${counts(m.outcomes)}; global errors=${m.globalErrors}`,
    `attempts: ${counts(m.attemptStatuses)}`,
    "Per-file work across projects, descending (includes retries):",
    ...m.files.map((f) => `${f.file}: ${seconds(f.workMs)} s; tests=${f.tests}; attempts=${f.attempts}; ${counts(f.outcomes)}`),
    "Summed work is not CI wall time or a speedup estimate. Coverage needs a separate inventory; isolation needs separate evidence.",
  ];
}
