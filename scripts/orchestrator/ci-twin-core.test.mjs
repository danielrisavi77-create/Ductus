// DAN-267: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import { jobMinutes, parseTwinArgs, queueMinutes, renderTwin, runShape, shardWhatIf, summarizeRuns } from "./ci-twin-core.mjs";

const job = (name, start, end, conclusion = "success", created = start) => ({
  name, conclusion, created_at: created, started_at: start, completed_at: end,
});
const run = { id: 1, run_started_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:09:00Z" };

test("job minutes need a finished job with sane timestamps", () => {
  assert.equal(jobMinutes(job("a", "2026-10-20T10:00:00Z", "2026-10-20T10:03:00Z")), 3);
  assert.equal(jobMinutes(job("a", "2026-10-20T10:00:00Z", "2026-10-20T10:03:00Z", "skipped")), null);
  assert.equal(jobMinutes(job("a", "2026-10-20T10:03:00Z", "2026-10-20T10:00:00Z")), null);
  assert.equal(jobMinutes(job("a", null, null)), null);
});

test("queue minutes are created to started", () => {
  assert.equal(queueMinutes(job("a", "2026-10-20T10:02:00Z", "2026-10-20T10:03:00Z", "success", "2026-10-20T10:00:00Z")), 2);
  assert.equal(queueMinutes({ created_at: null, started_at: "2026-10-20T10:00:00Z" }), null);
});

test("run shape picks the slowest job and drops unfinished ones", () => {
  const shape = runShape(run, [
    job("fast", "2026-10-20T10:00:00Z", "2026-10-20T10:01:00Z"),
    job("slow", "2026-10-20T10:00:00Z", "2026-10-20T10:08:00Z"),
    job("skipped", "2026-10-20T10:00:00Z", "2026-10-20T10:08:00Z", "skipped"),
  ]);
  assert.deepEqual(shape, { id: 1, wall: 9, critical: "slow", jobs: { fast: 1, slow: 8 } });
  assert.equal(runShape(run, []), null);
  const backwards = runShape({ id: 2, run_started_at: run.updated_at, updated_at: run.run_started_at }, [
    job("a", "2026-10-20T10:00:00Z", "2026-10-20T10:01:00Z"),
  ]);
  assert.equal(backwards.wall, null);
});

test("summary orders jobs by p50 and counts the slowest job per run", () => {
  const shapes = [
    { id: 1, wall: 9, critical: "slow", jobs: { fast: 1, slow: 8 } },
    { id: 2, wall: 7, critical: "slow", jobs: { fast: 2, slow: 6 } },
    { id: 3, wall: 5, critical: "fast", jobs: { fast: 5, slow: 4 } },
  ];
  const s = summarizeRuns(shapes);
  assert.equal(s.runs, 3);
  assert.deepEqual(s.jobs.map((j) => [j.name, j.p50, j.critical]), [["slow", 6, 2], ["fast", 2, 1]]);
  assert.equal(s.wall.p50, 7);
});

test("shard what-if keeps setup on every shard and prices the extra runners", () => {
  const w = shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 2 });
  assert.equal(w.wall, 6);
  assert.equal(w.savedWall, 4);
  assert.equal(w.extraRunnerMinutes, 2);
  assert.equal(shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 1 }).extraRunnerMinutes, 0);
  assert.throws(() => shardWhatIf({ jobMinutes: 1, setupMinutes: 2, shards: 2 }));
  assert.throws(() => shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 0 }));
});

test("arguments are strict", () => {
  assert.deepEqual(parseTwinArgs(["--since", "2026-10-20", "--json", "--limit", "5"]), { since: "2026-10-20", json: true, limit: 5 });
  assert.throws(() => parseTwinArgs([]));
  assert.throws(() => parseTwinArgs(["--since", "2026-10-20", "--limit", "0"]));
  assert.throws(() => parseTwinArgs(["--since", "2026-10-20", "--bogus"]));
});

test("rendering says it is not a verdict", () => {
  const out = renderTwin(summarizeRuns([{ id: 1, wall: 9, critical: "slow", jobs: { slow: 8 } }]), "2026-10-20", [
    shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 2 }),
  ]).join("\n");
  assert.match(out, /nije verdikt/);
  assert.match(out, /2 shard/);
});
