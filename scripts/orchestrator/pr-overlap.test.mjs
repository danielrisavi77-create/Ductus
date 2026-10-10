// DAN-130: overlap map of open PRs. `gh` is injected, never called.
import assert from "node:assert/strict";
import test from "node:test";

import { ghList, openPrsWithPaths, prPaths } from "./gh.mjs";
import { changedPaths, formatOverlaps, overlapPairs, overlapsOf, renderOverlap } from "./orchestrator-core.mjs";

const pr = (number, paths, over = {}) => ({ number, paths, isDraft: false, ...over });
const f = (filename, previous_filename) => ({ filename, ...(previous_filename ? { previous_filename } : {}) });

test("a pair is reported once, lower number first, whatever the input order", () => {
  const prs = [pr(160, ["a.ts", "b.ts"]), pr(151, ["b.ts", "a.ts", "c.ts"]), pr(170, ["c.ts"])];
  const pairs = overlapPairs(prs);
  assert.deepEqual(pairs.map((p) => [p.a, p.b, p.count, p.files]), [
    [151, 160, 2, ["a.ts", "b.ts"]],
    [151, 170, 1, ["c.ts"]],
  ]);
  assert.deepEqual(overlapPairs([...prs].reverse()), pairs);
  // the same PR listed twice, or a file listed twice, creates no extra pair and no self-pair
  assert.deepEqual(overlapPairs([...prs, pr(151, ["b.ts", "a.ts", "c.ts"]), pr(170, ["c.ts", "c.ts"])]), pairs);
  assert.deepEqual(overlapsOf(151, prs, pairs), [160, 170]);
  assert.equal(formatOverlaps(overlapsOf(151, prs, pairs)), "#160, #170");
  assert.equal(formatOverlaps(overlapsOf(170, prs, pairs)), "#151");
});

test("a PR without files overlaps with nothing", () => {
  const prs = [pr(1, []), pr(2, ["a.ts"]), pr(3, [])];
  assert.deepEqual(overlapPairs(prs), []);
  assert.equal(formatOverlaps(overlapsOf(1, prs, [])), "-");
  assert.deepEqual(renderOverlap(prs, []), ["3 open PRs, 0 overlapping pairs"]);
  assert.deepEqual(overlapPairs([]), []);
});

test("more than 100 files: every page is requested and used", async () => {
  const calls = [];
  const page = (from, n) => Array.from({ length: n }, (_, i) => f(`src/f${from + i}.ts`));
  const pages = [page(0, 100), page(100, 100), page(200, 37)];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return JSON.stringify(pages[calls.length - 1]);
  };
  const paths = await prPaths(7, (path) => ghList(path, exec));
  assert.deepEqual(calls, [1, 2, 3].map((n) => ["gh", "api", `repos/{owner}/{repo}/pulls/7/files?per_page=100&page=${n}`]));
  assert.equal(paths.length, 237);
  // a file that is only on the third page still produces the overlap
  assert.deepEqual(overlapPairs([pr(7, paths), pr(8, ["src/f236.ts"])]).map((p) => p.files), [["src/f236.ts"]]);
});

test("a file list at the API cap is an error, not a shorter list", async () => {
  const many = Array.from({ length: 3000 }, (_, i) => f(`f${i}`));
  await assert.rejects(prPaths(9, async () => many), /3000-file API cap/);
  assert.equal((await prPaths(9, async () => many.slice(1))).length, 2999);
});

test("a renamed file counts under the old and the new path", () => {
  assert.deepEqual(changedPaths([f("src/new.ts", "src/old.ts"), f("x\\y.ts")]), ["src/new.ts", "src/old.ts", "x/y.ts"]);
  const renamer = pr(1, changedPaths([f("src/new.ts", "src/old.ts")]));
  assert.deepEqual(overlapPairs([renamer, pr(2, ["src/old.ts"])]).map((p) => p.files), [["src/old.ts"]]);
  assert.deepEqual(overlapPairs([renamer, pr(3, ["src/new.ts"])]).map((p) => p.files), [["src/new.ts"]]);
  assert.deepEqual(overlapPairs([renamer, pr(4, ["src/other.ts"])]), []);
});

test("different files in db/migrations or db/tests still collide", () => {
  const prs = [
    pr(1, ["db/migrations/001_a.sql"]),
    pr(2, ["db/migrations/002_b.sql", "db/tests/rls/x.sql"]),
    pr(3, ["db/tests/y.sql"]),
    pr(4, ["db/migrations_old/z.sql", "db/testsuite.md", "db/seed.sql", "src/db/migrations/q.sql"]),
  ];
  assert.deepEqual(overlapPairs(prs), [
    { a: 1, b: 2, count: 0, files: [], dirs: ["db/migrations"] },
    { a: 2, b: 3, count: 0, files: [], dirs: ["db/tests"] },
  ]);
  const both = overlapPairs([pr(5, ["db/migrations/a.sql", "x.ts"]), pr(6, ["db/migrations/a.sql", "x.ts"])]);
  assert.deepEqual(both, [{ a: 5, b: 6, count: 2, files: ["db/migrations/a.sql", "x.ts"], dirs: ["db/migrations"] }]);
});

test("a failed files read is unknown, never 'no overlap'", async () => {
  const listed = [];
  const prs = await openPrsWithPaths({
    list: async (path) => {
      listed.push(path);
      return [{ number: 3, draft: true }, { number: 1, draft: false }, { number: 2, draft: false }];
    },
    paths: async (n) => {
      if (n === 2) throw new Error("HTTP 502");
      return ["a.ts"];
    },
  });
  assert.deepEqual(listed, ["repos/{owner}/{repo}/pulls?state=open&per_page=100"]);
  assert.deepEqual(prs.map((p) => [p.number, p.paths]), [[1, ["a.ts"]], [2, null], [3, ["a.ts"]]]);
  const pairs = overlapPairs(prs);
  assert.deepEqual(pairs.map((p) => [p.a, p.b]), [[1, 3]]);
  assert.equal(overlapsOf(2, prs, pairs), null);
  assert.equal(formatOverlaps(null), "?");
  assert.equal(overlapsOf(99, prs, pairs), null);
  const text = renderOverlap(prs, pairs);
  assert.equal(text[0], "#1 x #3 DRAFT: 1 shared file");
  assert.match(text.join("\n"), /UNKNOWN: files could not be read for #2/);
});

test("long shared lists are cut in the text output and complete in the data", () => {
  const paths = Array.from({ length: 14 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
  const prs = [pr(1, paths, { isDraft: true }), pr(2, [...paths, "db/tests/a.sql"]), pr(3, ["db/tests/b.sql"])];
  const pairs = overlapPairs(prs);
  assert.equal(pairs[0].files.length, 14);
  assert.deepEqual(renderOverlap(prs, pairs), [
    "#1 DRAFT x #2: 14 shared files",
    ...paths.slice(0, 10).map((p) => `  ${p}`),
    "  ... and 4 more",
    "#2 x #3: 0 shared files; same directory: db/tests",
    "3 open PRs, 2 overlapping pairs",
  ]);
});
