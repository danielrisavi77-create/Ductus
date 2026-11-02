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
  const others = Array.from({ length: 150 }, (_, i) => pr(100 + i, { changed_files: 0 }));
  const bigFiles = Array.from({ length: 120 }, (_, i) => ({ filename: `src/f${i}.ts`, status: "added", sha: "s" }));
  bigFiles.push(add(B));
  const { api } = fakeApi([
    [/^\/repos\/o\/r\/pulls\/1$/, pr(1)],
    [/^\/repos\/o\/r\/pulls\/1\/files\?/, (m) => page([add(A)], m)],
    [/^\/repos\/o\/r\/contents\/db\/migrations\?ref=main$/, MAIN.map((f) => ({ ...f, type: "file" }))],
    [/^\/repos\/o\/r\/pulls\?state=open/, (m) => page([pr(1), ...others], m)],
    [/^\/repos\/o\/r\/pulls\/249$/, pr(249, { changed_files: bigFiles.length })],
    [/^\/repos\/o\/r\/pulls\/(\d+)$/, (m) => pr(Number(m[1]), { changed_files: 0 })],
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
  const seven = [/^\/repos\/o\/r\/pulls\/7$/, pr(7, { changed_files: 3000 })];
  const cases = [
    ["moved head", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1, { head: { sha: "x".repeat(40) } })], selfFiles, ...base], /changed after this CI run/],
    ["incomplete own file list", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1, { changed_files: 5 })], selfFiles, ...base], /incomplete/],
    ["more open PRs than the listing reads", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, base[0],
      [/^\/repos\/o\/r\/pulls\?state=open/, () => Array.from({ length: 100 }, (_, i) => pr(2 + i))]], /every open PR/],
    ["API error on another PR", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base], /404/],
    ["other PR at the 3000 file limit", [[/^\/repos\/o\/r\/pulls\/1$/, pr(1)], selfFiles, ...base, seven,
      [/^\/repos\/o\/r\/pulls\/7\/files\?/, () => Array.from({ length: 100 }, () => ({ filename: "x", status: "added", sha: "s" }))]], /incomplete/],
  ];
  for (const [name, routes, error] of cases) {
    const { api } = fakeApi(routes);
    await assert.rejects(checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: head }), error, name);
  }
});

// --- Completeness and stability of another PR's file list (review c.6585772874,
// QA c.6585887022): contract #1091 c.6585991241, classes R1-R11. PR 1 adds A;
// PR 7 is the other open PR. `other` is what GitHub serves for PR 7: its head,
// changed_files and the /files list; `onFiles(state, page, call)` changes it
// after a /files page is served, to model a push between two requests.

const filler = (n) => Array.from({ length: n }, (_, i) => ({ filename: `src/f${i}.ts`, status: "added", sha: "s" }));
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);

function world({ other, onFiles = () => {}, self = { head: "h".repeat(40) }, onSelfFiles = () => {}, calls = [] }) {
  const state = { ...other };
  const own = { ...self };
  let fileCalls = 0;
  const slice = (items, url) => {
    const n = Number(new URLSearchParams(url.split("?")[1]).get("page"));
    return [n, items.slice((n - 1) * 100, n * 100)];
  };
  const api = async (url) => {
    calls.push(url);
    const u = url.replace(/^\/repos\/o\/r/, "");
    if (u === "/pulls/1") return pr(1, { head: { sha: own.head } });
    if (u.startsWith("/pulls/1/files?")) {
      const [, batch] = slice([add(A)], u);
      onSelfFiles(own);
      return batch;
    }
    if (u === "/contents/db/migrations?ref=main") return MAIN.map((f) => ({ ...f, type: "file" }));
    if (u.startsWith("/pulls?state=open")) return slice([pr(1), pr(7)], u)[1];
    if (u === "/pulls/7") {
      const meta = { number: 7, state: "open", changed_files: state.changed };
      return state.head === undefined ? meta : { ...meta, head: { sha: state.head } };
    }
    if (u.startsWith("/pulls/7/files?")) {
      const [n, batch] = slice(state.files, u);
      fileCalls += 1;
      const served = state.serve ? state.serve(batch) : batch;
      onFiles(state, n, fileCalls);
      return served;
    }
    throw new Error(`GitHub API 404: ${url}`);
  };
  return api;
}

const check = (api) => checkPullRequest({ api, owner: "o", repo: "r", number: 1, headSha: "h".repeat(40) });
const COLLISION = [`${M(A)}|7`];

const READS = [
  ["R1 short page, changed_files larger (a lagging /files without the migration)", { other: { head: H1, changed: 2, files: filler(1) } }, /File list of #7 is incomplete/],
  ["R2 head of the other PR changes between pages on every read", {
    other: { head: H1, changed: 101, files: [...filler(100), add(B)] },
    onFiles: (s, n, call) => { if (n === 1) s.head = `${call}`.padStart(40, "0"); },
  }, /#7 kept changing/],
  ["R2b head changes in both reads, a third read would be stable: two reads are the bound", {
    other: { head: H1, changed: 101, files: [...filler(100), add(B)] },
    onFiles: (s, n, call) => { if (call <= 3) s.head = `${call}`.padStart(40, "0"); },
  }, /#7 kept changing/],
  ["R3 head changes once, the second read is stable", {
    other: { head: H1, changed: 101, files: [...filler(100), add(B)] },
    onFiles: (s, n, call) => { if (call === 1) s.head = H2; },
  }, COLLISION],
  ["R4 exactly 100 files, empty next page, changed_files 100", { other: { head: H1, changed: 100, files: [...filler(99), add(B)] } }, COLLISION],
  ["R5 100 files, empty next page, changed_files 101", { other: { head: H1, changed: 101, files: [...filler(99), add(B)] } }, /File list of #7 is incomplete/],
  ["R6 101 files, the migration on the second page", { other: { head: H1, changed: 101, files: [...filler(100), add(B)] } }, COLLISION],
  ["R7 other PR without migrations, complete and stable", { other: { head: H1, changed: 3, files: filler(3) } }, []],
  ["R8 correct complete list", { other: { head: H1, changed: 1, files: [add(B)] } }, COLLISION],
  ["R9a changed_files missing", { other: { head: H1, changed: undefined, files: [add(B)] } }, /File list of #7 is incomplete/],
  ["R9b head missing", { other: { head: undefined, changed: 1, files: [add(B)] } }, /#7 has no head/],
  ["R11 a /files page that is not a list", { other: { head: H1, changed: 1, files: [add(B)], serve: () => ({ message: "x" }) } }, /not a list/],
];

for (const [name, input, expected] of READS) {
  test(`read ${name}`, async () => {
    if (expected instanceof RegExp) await assert.rejects(check(world(input)), expected);
    else assert.deepEqual(by(await check(world(input))), expected);
  });
}

test("read R10 own head moves while the PR's own files are read", async () => {
  const api = world({ other: { head: H1, changed: 1, files: [add(B)] }, onSelfFiles: (own) => { own.head = H2; } });
  await assert.rejects(check(api), /changed after this CI run/);
});

test("read: the PR's own files are read once, not again as an open PR", async () => {
  const calls = [];
  assert.deepEqual(by(await check(world({ other: { head: H1, changed: 1, files: [add(B)] }, calls }))), COLLISION);
  assert.equal(calls.filter((url) => url.includes("/pulls/1/files?")).length, 1);
  assert.equal(calls.filter((url) => url.endsWith("/pulls/7")).length, 2);
});

// Istodobnost: the QA scenario (c.6585887022). B has 101 files with the
// migration on page 2; after page 1 B pushes a head that drops the 100 others.
const pushAfterFirstPage = (s, n) => {
  if (n !== 1) return;
  s.head = s.head === H1 ? H2 : H1;
  s.files = [add(B)];
  s.changed = 1;
};

test("concurrency: a push into another PR between two /files requests never passes", async () => {
  // The push lands once: the first read sees a moved head and is discarded,
  // the second read is stable and reports the collision.
  let pushed = false;
  const once = world({
    other: { head: H1, changed: 101, files: [...filler(100), add(B)] },
    onFiles: (s, n) => { if (!pushed) { pushAfterFirstPage(s, n); pushed = n === 1; } },
  });
  assert.deepEqual(by(await check(once)), COLLISION);
});

test("concurrency: pushes during both reads of another PR fail the step", async () => {
  // Negative: every read sees page 1 of one head and page 2 of another.
  const always = world({
    other: { head: H1, changed: 101, files: [...filler(100), add(B)] },
    onFiles: (s, n) => {
      if (n === 1) pushAfterFirstPage(s, n);
      else { s.files = [...filler(100), add(B)]; s.changed = 101; }
    },
  });
  await assert.rejects(check(always), /#7 kept changing/);
});

test("CI runs the check in the build job with the workflow token", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = /- name: Migration version collisions \(P6, DAN-499\)\n([\s\S]*?)\n {6}- /.exec(ci);
  assert.ok(step, "step missing from ci.yml");
  assert.match(step[1], /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step[1], /run: node scripts\/engineering\/migration-versions\.mjs\n/);
  assert.doesNotMatch(step[1], /\bif:/, "the local duplicate check must run on every event");
});
