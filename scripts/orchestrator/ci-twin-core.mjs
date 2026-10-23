// DAN-267: pure logic for `pnpm orch:twin`. No gh/git calls here.
import { median, percentile } from "./metrics-core.mjs";

const MINUTE = 60_000;

/** Whole job duration in minutes from its timestamps; null while a job is unfinished or skipped. */
export function jobMinutes(job) {
  if (job.conclusion !== "success" && job.conclusion !== "failure") return null;
  const start = Date.parse(job.started_at);
  const end = Date.parse(job.completed_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / MINUTE : null;
}

/** Minutes a job waited for a runner (created to started); null when unknown. */
export function queueMinutes(job) {
  const created = Date.parse(job.created_at);
  const start = Date.parse(job.started_at);
  return Number.isFinite(created) && Number.isFinite(start) && start >= created ? (start - created) / MINUTE : null;
}

/** One run as { id, wall, critical, jobs }: wall clock, the slowest job and its minutes per job name. */
export function runShape(run, jobs) {
  const perJob = {};
  for (const job of jobs) {
    const m = jobMinutes(job);
    if (m !== null) perJob[job.name] = m;
  }
  const names = Object.keys(perJob);
  if (!names.length) return null;
  const critical = names.reduce((a, b) => (perJob[b] > perJob[a] ? b : a));
  const wall = (Date.parse(run.updated_at) - Date.parse(run.run_started_at)) / MINUTE;
  return { id: run.id, wall: Number.isFinite(wall) ? wall : null, critical, jobs: perJob };
}

const stat = (values) => ({
  n: values.length,
  p50: median(values),
  p95: percentile(values, 95),
});

/** p50/p95 of wall clock and of each job over many run shapes; the slowest job is counted per run. */
export function summarizeRuns(shapes) {
  const byJob = new Map();
  const criticalCount = new Map();
  for (const s of shapes) {
    for (const [name, m] of Object.entries(s.jobs)) byJob.set(name, [...(byJob.get(name) ?? []), m]);
    criticalCount.set(s.critical, (criticalCount.get(s.critical) ?? 0) + 1);
  }
  const jobs = [...byJob].map(([name, values]) => ({ name, ...stat(values), critical: criticalCount.get(name) ?? 0 }));
  jobs.sort((a, b) => b.p50 - a.p50 || a.name.localeCompare(b.name));
  return { runs: shapes.length, wall: stat(shapes.map((s) => s.wall).filter((w) => w !== null)), jobs };
}

/**
 * What-if for one splittable job: setup minutes S stay on every shard, the rest is
 * divided evenly. A model, not a measurement: it assumes tests split perfectly and
 * says nothing about runner cost beyond the minutes it adds.
 */
export function shardWhatIf({ jobMinutes: total, setupMinutes, shards }) {
  if (!(shards >= 1) || !(setupMinutes >= 0) || !(total >= setupMinutes)) {
    throw new Error("shardWhatIf needs shards >= 1 and 0 <= setupMinutes <= jobMinutes");
  }
  const wall = setupMinutes + (total - setupMinutes) / shards;
  return { shards, wall, runnerMinutes: wall * shards, savedWall: total - wall, extraRunnerMinutes: wall * shards - total };
}

export function parseTwinArgs(argv) {
  let since = null;
  let json = false;
  let limit = 40;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--since") since = argv[++i];
    else if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) throw new Error("--since YYYY-MM-DD is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("--limit must be an integer from 1 to 200");
  return { since, json, limit };
}

const fmt = (v) => (v === null ? "-" : v.toFixed(1));

export function renderTwin(summary, since, whatIfs = []) {
  const lines = [
    `CI od ${since}: ${summary.runs} uspjesnih prolaza (read-only, nije verdikt)`,
    `Zid: p50 ${fmt(summary.wall.p50)} min, p95 ${fmt(summary.wall.p95)} min (n=${summary.wall.n})`,
    "",
    "Job | n | p50 min | p95 min | najsporiji u",
  ];
  for (const j of summary.jobs) lines.push(`${j.name} | ${j.n} | ${fmt(j.p50)} | ${fmt(j.p95)} | ${j.critical}`);
  if (whatIfs.length) {
    lines.push("", "Model podjele (pretpostavlja idealnu raspodjelu testova):");
    for (const w of whatIfs) {
      lines.push(`${w.shards} shard(a): zid ${fmt(w.wall)} min, ušteda ${fmt(w.savedWall)} min, dodatnih runner-minuta ${fmt(w.extraRunnerMinutes)}`);
    }
  }
  return lines;
}
