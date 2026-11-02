// P6 (#87 c.6582691826), DAN-499: one table over every input class of the
// migration version collision check, then the REST layer with a fake fetch.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkPullRequest,
  findCollisions,
  formatCollision,
  localDuplicates,
  migrationVersion,
  readLocalNames,
} from "./migration-versions.mjs";

const M = (name) => `db/migrations/${name}`;
const add = (name, sha = `blob-${name}`) => ({ filename: M(name), status: "added", sha });
const A = "20261102230000_alpha.sql";
const B = "20261102230000_beta.sql";
const C = "20261102240000_gamma.sql";
const MAIN = ["20261102220000_teacher_role_event.sql"].map((name) => ({ name, sha: `blob-${name}` }));

const run = ({ self, main = MAIN, pulls = [] }) =>
  findCollisions({ self: { number: 1, files: self }, main, pulls });
const by = (collisions) => collisions.map((c) => `${c.file}|${c.by}`).sort();

test("migrationVersion follows dbmate: digits before anything, .sql, directly in db/migrations", () => {
  const cases = [
    [M(A), "20261102230000"],
    [M("20261102230000.sql"), "20261102230000"],
    [M("0202611022300_x.sql"), "0202611022300"],
    [M("x/20261102230000_x.sql"), null],
    [M("README.md"), null],
    [M("alpha.sql"), null],
    [M("v20261102230000_x.sql"), null],
    [M("20261102230000_x.SQL"), null],
    ["db/migrations.sum", null],
    ["db/tests/20261102230000_x.sql", null],
    ["other/db/migrations/20261102230000_x.sql", null],
  ];
  for (const [file, version] of cases) assert.equal(migrationVersion(file), version, file);
});

// Every input class from the contract (#1091 c.6584597473), one row each.
const CLASSES = [
  ["1 same version on main, other name", { self: [add("20261102220000_mine.sql")] }, [`${M("20261102220000_mine.sql")}|main`]],
  ["1b same name on main, other content", { self: [add("20261102220000_teacher_role_event.sql", "other")] }, [`${M("20261102220000_teacher_role_event.sql")}|main`]],
  ["1c same name and content on main is the same migration", { self: [add("20261102220000_teacher_role_event.sql")] }, []],
  ["2 same version in another open PR", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [add(B)] }] }, [`${M(A)}|7`]],
  ["2b a draft PR is open", { self: [add(A)], pulls: [{ number: 7, state: "open", draft: true, files: [add(B)] }] }, [`${M(A)}|7`]],
  ["2c same name, other content in another PR", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [add(A, "other")] }] }, [`${M(A)}|7`]],
  ["2d same name and content in a stacked PR", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [add(A)] }] }, []],
  ["3 the PR itself in the open list, even from an older head", { self: [add(A)], pulls: [{ number: 1, state: "open", files: [add(A, "older-head")] }] }, []],
  ["4 different versions", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [add(C)] }] }, []],
  ["5a own file renamed onto another PR's version", { self: [{ filename: M(A), previous_filename: M(C), status: "renamed", sha: "r" }], pulls: [{ number: 7, state: "open", files: [add(B)] }] }, [`${M(A)}|7`]],
  ["5b another PR renames its file onto our version", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [{ filename: M(B), previous_filename: M(C), status: "renamed", sha: "r" }] }] }, [`${M(A)}|7`]],
  ["5c renaming a main migration within its version is the ledger's case", { self: [{ filename: M("20261102220000_renamed.sql"), previous_filename: M("20261102220000_teacher_role_event.sql"), status: "renamed", sha: "r" }] }, []],
  ["5e removing a main migration and adding one of its version is the ledger's case", { self: [{ filename: M("20261102220000_teacher_role_event.sql"), status: "removed", sha: "d" }, add("20261102220000_new.sql")] }, []],
  ["5d copied file counts as introduced", { self: [{ filename: M("20261102220000_copy.sql"), previous_filename: M("x.sql"), status: "copied", sha: "c" }] }, [`${M("20261102220000_copy.sql")}|main`]],
  ["6 PR without migrations", { self: [{ filename: "src/a.ts", status: "added", sha: "s" }], pulls: [{ number: 7, state: "open", files: [add(A)] }] }, []],
  ["7 closed or merged PR", { self: [add(A)], pulls: [{ number: 7, state: "closed", files: [add(B)] }] }, []],
  ["8 two new files of one version in the same PR", { self: [add(A), add(B)] }, [`${M(A)}|this PR`, `${M(B)}|this PR`]],
  ["9 not migrations", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [
    { filename: M("x/20261102230000_x.sql"), status: "added", sha: "n" },
    { filename: "db/tests/20261102230000_x.sql", status: "added", sha: "n" },
    { filename: M("20261102230000_x.SQL"), status: "added", sha: "n" },
  ] }] }, []],
  ["10 removed file is not introduced", { self: [add(A)], pulls: [{ number: 7, state: "open", files: [{ filename: M(B), status: "removed", sha: "d" }] }] }, []],
  ["10b modified file is not introduced", { self: [{ filename: M("20261102220000_teacher_role_event.sql"), status: "modified", sha: "m" }] }, []],
  ["11 versions compare as strings", { self: [add("020261102230000_x.sql")], pulls: [{ number: 7, state: "open", files: [add(B)] }] }, []],
  ["12 every colliding PR is named", { self: [add(A)], pulls: [
    { number: 7, state: "open", files: [add(B)] },
    { number: 9, state: "open", files: [add("20261102230000_delta.sql")] },
  ] }, [`${M(A)}|7`, `${M(A)}|9`]],
];

for (const [name, input, expected] of CLASSES) {
  test(`class ${name}`, () => assert.deepEqual(by(run(input)), expected.sort()));
}

test("concurrency: two PRs open at once with one version both fail", () => {
  const prA = { number: 10, state: "open", files: [add(A)] };
  const prB = { number: 11, state: "open", files: [add(B)] };
  const forA = findCollisions({ self: prA, main: MAIN, pulls: [prA, prB] });
  const forB = findCollisions({ self: prB, main: MAIN, pulls: [prA, prB] });
  assert.deepEqual(by(forA), [`${M(A)}|11`]);
  assert.deepEqual(by(forB), [`${M(B)}|10`]);
});

test("concurrency: a run before the other PR exists passes, the later run fails", () => {
  const prA = { number: 10, state: "open", files: [add(A)] };
  const prB = { number: 11, state: "open", files: [add(B)] };
  assert.deepEqual(findCollisions({ self: prA, main: MAIN, pulls: [prA] }), []);
  assert.deepEqual(by(findCollisions({ self: prB, main: MAIN, pulls: [prA, prB] })), [`${M(B)}|10`]);
});

test("the failure message names the colliding PR and file", () => {
  const [collision] = run({ self: [add(A)], pulls: [{ number: 7, state: "open", files: [add(B)] }] });
  assert.match(formatCollision(collision), /db\/migrations\/20261102230000_alpha\.sql: version 20261102230000 is also used by #7 \(db\/migrations\/20261102230000_beta\.sql\)/);
  const [onMain] = run({ self: [add("20261102220000_mine.sql")] });
  assert.match(formatCollision(onMain), /is also used by main \(db\/migrations\/20261102220000_teacher_role_event\.sql\)/);
});

test("localDuplicates finds two files of one version in a checkout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mv-"));
  for (const name of [A, B, C, "README.md"]) writeFileSync(path.join(dir, name), "");
  mkdirSync(path.join(dir, "20261102240000_dir.sql"));
  assert.deepEqual(localDuplicates(readLocalNames(dir)), [{ version: "20261102230000", files: [M(A), M(B)] }]);
  assert.deepEqual(localDuplicates([C]), []);
});

test("the main checkout has no duplicate version", () => {
  assert.deepEqual(localDuplicates(readLocalNames("db/migrations")), []);
});

// --- REST layer -------------------------------------------------------------

function fakeApi(routes) {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    for (const [pattern, reply] of routes) {
      const match = pattern.exec(url);
      if (match) return typeof reply === "function" ? reply(match) : reply;
    }
    throw new Error(`GitHub API 404: ${url}`);
  };
  return { api, calls };
}

const page = (items, match) => {
  const n = Number(new URLSearchParams(match.input.split("?")[1]).get("page"));
  return items.slice((n - 1) * 100, n * 100);
};

const pr = (number, extra = {}) => ({ number, state: "open", head: { sha: "h".repeat(40) }, changed_files: 1, ...extra });

test("checkPullRequest reads every page of open PRs and files and finds the collision", async () => {
  const others = Array.from({ length: 150 }, (_, i) => pr(100 + i));
  const bigFiles = Array.from({ length: 120 }, (_, i) => ({ filename: `src/f${i}.ts`, status: "added", sha: "s" }));
  bigFiles.push(add(B));
  const { api } = fakeApi([
    [/^\/repos\/o\/r\/pulls\/1$/, pr(1)],
    [/^\/repos\/o\/r\/pulls\/(\d+)$/, (m) => pr(Number(m[1]), { changed_files: m[1] === "249" ? 121 : 0 })],
    [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([add(A)], m)],
    [/^\/repos\/o\/r\/contents\/db\/migrations\?ref=main$/, MAIN.map((f) => ({ ...f, type: "file" }))],
    [/^\/repos\/o\/r\/pulls\?state=open/, (m) => page([pr(1), ...others], m)],
    [/^\/repos\/o\/r\/pulls\/249\/files\?/, (m) => page(bigFiles, m)],
    [/^\/repos\/o\/r\/pulls\/\d+\/files\?/, () => []],
  ]);
  const collisions = await checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: "h".repeat(40) });
  assert.deepEqual(by(collisions), [`${M(A)}|249`]);
});

test("checkPullRequest without migrations reads no other PR", async () => {
  const { api, calls } = fakeApi([
    [/^\/repos\/o\/r\/pulls\/1$/, pr(1)],
    [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([{ filename: "src/a.ts", status: "added", sha: "s" }], m)],
  ]);
  assert.deepEqual(await checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: "h".repeat(40) }), []);
  assert.equal(calls.some((url) => url.includes("state=open") || url.includes("contents")), false);
});

test("checkPullRequest fails closed", async () => {
  const head = "h".repeat(40);
  const base = [
    [/^\/repos\/o\/r\/contents\/db\/migrations\?ref=main$/, MAIN.map((f) => ({ ...f, type: "file" }))],
    [/^\/repos\/o\/r\/pulls\?state=open/, (m) => page([pr(1), pr(7)], m)],
  ];
  const selfFiles = [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([add(A)], m)];
  const cases = [
    ["moved head", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1, { head: { sha: "x".repeat(40) } })], selfFiles, ...base], /changed after this CI run/],
    ["incomplete own file list", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1, { changed_files: 5 })], selfFiles, ...base], /incomplete/],
    ["more open PRs than the listing reads", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, base[0],
      [/^\/repos\/o\/r\/pulls\?state=open/, () => Array.from({ length: 100 }, (_, i) => pr(2 + i))]], /every open PR/],
    ["API error on another PR", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base], /404/],
    ["other PR at the 3000 file limit", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base, [/^\/repos\/o\/r\/pulls\/7$/, pr(7)],
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, () => Array.from({ length: 100 }, () => ({ filename: "x", status: "added", sha: "s" }))]], /all files of #7/],
    // A lagging /files of another PR omits its migration: the short page must not count as complete.
    ["other PR's file list shorter than changed_files", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base,
      [/^\/repos\/o\/r\/pulls\/7$/, pr(7, { changed_files: 2 })],
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([{ filename: "src/a.ts", status: "added", sha: "s" }], m)]], /all files of #7/],
    ["other PR without changed_files", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base,
      [/^\/repos\/o\/r\/pulls\/7$/, pr(7, { changed_files: undefined })],
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([add(B)], m)]], /all files of #7/],
    ["other PR's head keeps moving", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base,
      [/^\/repos\/o\/r\/pulls\/7$/, movingHead()],
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([add(B)], m)]], /#7 kept changing/],
    ["other PR without a head", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base,
      [/^\/repos\/o\/r\/pulls\/7$/, pr(7, { head: undefined })],
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([add(B)], m)]], /#7 kept changing/],
  ];
  for (const [name, routes, error] of cases) {
    const { api } = fakeApi(routes);
    await assert.rejects(checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: head }), error, name);
  }
});

function movingHead(stableAfter = Infinity) {
  let calls = 0;
  return () => {
    calls += 1;
    return pr(7, { head: { sha: String(Math.min(calls, stableAfter)).repeat(40).slice(0, 40) } });
  };
}

test("checkPullRequest rereads another PR whose head moved once", async () => {
  const { api, calls } = fakeApi([
    [/^\/repos\/o\/r\/pulls\/1$/, pr(1)],
    [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([add(A)], m)],
    [/^\/repos\/o\/r\/contents\/db\/migrations\?ref=main$/, MAIN.map((f) => ({ ...f, type: "file" }))],
    [/^\/repos\/o\/r\/pulls\?state=open/, (m) => page([pr(1), pr(7)], m)],
    [/^\/repos\/o\/r\/pulls\/7$/, movingHead(2)],
    [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([add(B)], m)],
  ]);
  const collisions = await checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: "h".repeat(40) });
  assert.deepEqual(by(collisions), [`${M(A)}|7`]);
  assert.equal(calls.filter((url) => url === "/repos/o/r/pulls/7").length, 4);
  assert.equal(calls.filter((url) => url.startsWith("/repos/o/r/pulls/1")).length, 2, "the PR itself is read once");
});

test("checkPullRequest gives up on a moving head after two reads", async () => {
  const { api, calls } = fakeApi([
    [/^\/repos\/o\/r\/pulls\/1$/, pr(1)],
    [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([add(A)], m)],
    [/^\/repos\/o\/r\/contents\/db\/migrations\?ref=main$/, MAIN.map((f) => ({ ...f, type: "file" }))],
    [/^\/repos\/o\/r\/pulls\?state=open/, (m) => page([pr(1), pr(7)], m)],
    [/^\/repos\/o\/r\/pulls\/7$/, movingHead()],
    [/^\/repos\/o\/r\/pulls\/7\/files\?/, (m) => page([add(B)], m)],
  ]);
  await assert.rejects(checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: "h".repeat(40) }), /#7 kept changing/);
  assert.equal(calls.filter((url) => url === "/repos/o/r/pulls/7").length, 4);
});

test("CI runs the check in the build job with the workflow token", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = /- name: Migration version collisions \(P6, DAN-499\)\n([\s\S]*?)\n {6}- /.exec(ci);
  assert.ok(step, "step missing from ci.yml");
  assert.match(step[1], /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step[1], /run: node scripts\/engineering\/migration-versions\.mjs\n/);
  assert.doesNotMatch(step[1], /\bif:/, "the local duplicate check must run on every event");
});
