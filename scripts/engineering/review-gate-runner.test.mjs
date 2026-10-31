// The real review-gate.mjs entrypoint against a fake GitHub (fetch replaced
// through --import): a run that fails after the head is known must replace an
// older status with pending instead of leaving it as it was.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runner = path.resolve("scripts/engineering/review-gate.mjs");
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

const FAKE_FETCH = `
import { appendFileSync } from "node:fs";
const plan = JSON.parse(process.env.FAKE_GH);
const reply = (status, body) => ({
  ok: status < 400, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
let statusCount = 0;
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if ((options.method ?? "GET") === "POST" && path.includes("/statuses/")) {
    appendFileSync(process.env.FAKE_LOG, JSON.stringify({ path, body: JSON.parse(options.body) }) + "\\n");
    statusCount++;
    return plan.statusFails || statusCount === plan.failPostNumber ? reply(500, { message: "down" }) : reply(201, {});
  }
  if (plan.fail.some((p) => path.endsWith(p))) throw new TypeError("fetch failed");
  if (/\\/pulls\\/\\d+$/.test(path)) {
    return reply(200, { number: 7, state: "open", head: { sha: "${HEAD}", repo: { full_name: "o/r" } },
      base: { sha: "${BASE}", repo: { full_name: "o/r" } },
      html_url: "https://github.com/o/r/pull/7", body: "", ...plan.pr });
  }
  if (path.endsWith("/pulls/7/files")) return reply(200, plan.files ?? []);
  if (path.endsWith("/pulls")) return reply(200, plan.openPulls ?? []);
  if (path.includes("/commits/")) return reply(200, { sha: "${HEAD}", parents: [{ sha: "${BASE}" }] });
  if (path.includes("/compare/")) return reply(200, { files: [], commits: [] });
  return reply(200, []);
};
`;

function run(event, { fail = [], statusFails = false, failPostNumber = 0, pr = {}, files, openPulls } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-runner-"));
  const fake = path.join(dir, "fake-fetch.mjs");
  const eventPath = path.join(dir, "event.json");
  const log = path.join(dir, "status.log");
  writeFileSync(fake, FAKE_FETCH);
  writeFileSync(eventPath, JSON.stringify(event));
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(fake).href, runner], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_API_URL: "https://api.example.test",
      GITHUB_TOKEN: "t",
      FAKE_GH: JSON.stringify({ fail, statusFails, failPostNumber, pr, files, openPulls }),
      FAKE_LOG: log,
    },
  });
  const posts = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { code: result.status, posts, stderr: result.stderr };
}

const comment = { issue: { number: 7, pull_request: {} } };
const pullRequest = {
  pull_request: {
    number: 7, state: "open", html_url: "https://github.com/o/r/pull/7",
    head: { sha: HEAD, repo: { full_name: "o/r" } }, base: { repo: { full_name: "o/r" } },
  },
};

test("a failed comment read after the head is known marks the head pending", () => {
  const { code, posts } = run(comment, { fail: ["/issues/7/comments"] });
  assert.equal(code, 1);
  // Failure path does not compute Auto-merge eligible.
  assert.deepEqual(posts.map((p) => p.body.context), ["Merge authorization", "Engineering review gate"]);
  for (const post of posts) {
    assert.equal(post.path, `/repos/o/r/statuses/${HEAD}`);
    assert.equal(post.body.state, "pending");
    assert.match(post.body.description, /failed before a verdict/);
  }
});

test("a failed PR read marks the event head pending when the event names one", () => {
  const withHead = run(pullRequest, { fail: ["/pulls/7"] });
  assert.equal(withHead.code, 1);
  assert.deepEqual(withHead.posts.map((p) => [p.path, p.body.state]), [
    [`/repos/o/r/statuses/${HEAD}`, "pending"],
    [`/repos/o/r/statuses/${HEAD}`, "pending"],
  ]);

  const withoutHead = run(comment, { fail: ["/pulls/7"] });
  assert.equal(withoutHead.code, 1);
  assert.equal(withoutHead.posts.length, 0);
});

test("a failing status post still ends the run with exit 1 and no crash", () => {
  const { code, posts, stderr } = run(comment, { fail: ["/issues/7/comments"], statusFails: true });
  assert.equal(code, 1);
  assert.equal(posts.length, 1);
  assert.match(stderr, /Could not mark the head pending/);
});

test("control: a run that reads everything posts the authorization and the gate status and exits 0", () => {
  const { code, posts } = run(comment);
  assert.equal(code, 0);
  assert.deepEqual(posts.map((p) => p.body.context), ["Merge authorization", "Auto-merge eligible", "Engineering review gate"]);
  for (const post of posts) assert.doesNotMatch(post.body.description, /failed before a verdict/);
});

const carrier = {
  number: 7, state: "open", draft: true, title: "merge queue: main #1",
  user: { login: "mergify[bot]", id: 37929162, type: "Bot" },
  head: { sha: HEAD, ref: "mergify/merge-queue/012345abcd", repo: { id: 1, full_name: "o/r" } },
  base: { sha: BASE, ref: "main", repo: { id: 1, full_name: "o/r" } },
};

test("carrier statuses come from the live API identity, not the event or missing source verdicts", () => {
  const { code, posts } = run(comment, { pr: carrier, fail: ["/issues/7/comments"] });
  assert.equal(code, 0);
  assert.deepEqual(posts.map((p) => [p.path, p.body.context, p.body.state]), [
    [`/repos/o/r/statuses/${HEAD}`, "Merge authorization", "success"],
    [`/repos/o/r/statuses/${HEAD}`, "Engineering review gate", "success"],
  ]);
  assert.match(posts[0].body.description, /source approvals enforced by queue conditions/);
  // Spoofing event metadata does not change the fresh API response.
  const spoof = run({ pull_request: carrier });
  assert.ok(spoof.posts.every((p) => p.body.state !== "success"));
});

test("a carrier publish failure replaces a partial success with pending on both contexts", () => {
  const { code, posts } = run(comment, { pr: carrier, failPostNumber: 2 });
  assert.equal(code, 1);
  assert.deepEqual(posts.slice(-2).map((p) => [p.body.context, p.body.state]), [
    ["Merge authorization", "pending"], ["Engineering review gate", "pending"],
  ]);
});

// F-165: a PR that only adds a test file, so all three statuses would be green.
const repoMeta = { id: 1, full_name: "o/r", default_branch: "main" };
const eligible = {
  number: 7, state: "open", user: { login: "o" }, changed_files: 1, auto_merge: null,
  body: "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n",
  head: { sha: HEAD, ref: "feat/x", repo: repoMeta },
  base: { sha: BASE, ref: "main", repo: repoMeta },
};
const addedTest = [{ filename: "src/a.test.ts", status: "added" }];
const states = (posts) => posts.map((p) => [p.body.context, p.body.state]);
const ALL = ["Merge authorization", "Auto-merge eligible", "Engineering review gate"];

test("control: a PR on the default branch keeps all three green statuses (F-165)", () => {
  const { code, posts } = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible] });
  assert.equal(code, 0);
  assert.deepEqual(states(posts), ALL.map((c) => [c, "success"]));
});

test("a PR whose base is not the default branch gets no green status for its head (F-165)", () => {
  for (const base of [
    { ...eligible.base, ref: "feature" },
    { ...eligible.base, repo: { ...repoMeta, default_branch: "trunk" } },
    { ...eligible.base, repo: { id: 1, full_name: "o/r" } },
  ]) {
    const { code, posts } = run(comment, { pr: { ...eligible, base }, files: addedTest, openPulls: [] });
    assert.equal(code, 0);
    assert.deepEqual(states(posts), ALL.map((c) => [c, "pending"]), JSON.stringify(base));
    for (const post of posts) {
      assert.equal(post.path, `/repos/o/r/statuses/${HEAD}`);
      assert.match(post.body.description, /only for PRs that target the default branch/);
    }
  }
});

test("another open PR on the same head leaves Auto-merge eligible pending (F-165)", () => {
  for (const other of [{ number: 8, head: { sha: HEAD } }, { number: 9, head: { sha: HEAD }, base: { ref: "feature" } }]) {
    const { code, posts } = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible, other] });
    assert.equal(code, 0);
    assert.deepEqual(states(posts), [
      ["Merge authorization", "success"], ["Auto-merge eligible", "pending"], ["Engineering review gate", "success"],
    ]);
    assert.match(posts[1].body.description, /another open PR shares this head/);
  }
  // A failed read of the open PRs fails the run closed.
  const failed = run(comment, { pr: eligible, files: addedTest, fail: ["/pulls"] });
  assert.equal(failed.code, 1);
  assert.ok(failed.posts.every((p) => p.body.state !== "success"));
});

test("a queue carrier keeps its statuses without a default_branch field (F-165)", () => {
  assert.equal(carrier.base.repo.default_branch, undefined);
  const { code, posts } = run(comment, { pr: carrier, openPulls: [{ number: 8, head: { sha: HEAD } }] });
  assert.equal(code, 0);
  assert.deepEqual(states(posts), [["Merge authorization", "success"], ["Engineering review gate", "success"]]);
});

test("a renamed human branch, fork, non-draft or different bot is still subject to the original gate", () => {
  for (const changed of [
    { user: { ...carrier.user, login: "owner", id: 2, type: "User" } },
    { user: { ...carrier.user, id: 2 } },
    { head: { ...carrier.head, repo: { id: 2, full_name: "fork/r" } } },
    { draft: false }, { state: "closed" }, { title: "Update merge queue configuration" },
  ]) {
    const { code, posts } = run(comment, { pr: { ...carrier, ...changed } });
    assert.equal(code, 0);
    assert.ok(posts.every((p) => p.body.state !== "success"), JSON.stringify(changed));
  }
});

// F-014: statuses are per commit. A closed PR, or a PR whose head lives in
// another repository, may share its head SHA with an open PR of this
// repository, so the gate writes nothing for it, on any path.
const external = [
  { state: "closed" },
  { head: { ...eligible.head, repo: { id: 2, full_name: "fork/r" } } },
  { head: { ...eligible.head, repo: null } },
  { head: { sha: HEAD, ref: "feat/x" } },
  { base: { ...eligible.base, repo: { ...repoMeta, full_name: "other/r" } } },
];

test("a closed PR or a head outside this repository gets no status at all (F-014)", () => {
  for (const changed of external) {
    const label = JSON.stringify(changed);
    const ok = run(comment, { pr: { ...eligible, ...changed }, files: addedTest, openPulls: [eligible] });
    assert.equal(ok.code, 0, label);
    assert.deepEqual(ok.posts, [], label);
    // A later read failure does not fall back to the head either.
    const failed = run(comment, { pr: { ...eligible, ...changed }, fail: ["/issues/7/comments"] });
    assert.equal(failed.code, 0, label);
    assert.deepEqual(failed.posts, [], label);
  }
});

test("a failed PR read marks the event head only for an open PR of this repository (F-014)", () => {
  for (const changed of [
    { state: "closed" },
    { head: { sha: HEAD, repo: { full_name: "fork/r" } } },
    { head: { sha: HEAD, repo: null } },
    { head: { sha: HEAD } },
  ]) {
    const event = { pull_request: { ...pullRequest.pull_request, ...changed } };
    const { code, posts } = run(event, { fail: ["/pulls/7"] });
    assert.equal(code, 1, JSON.stringify(changed));
    assert.deepEqual(posts, [], JSON.stringify(changed));
  }
});

test("a PR off the default branch writes nothing on a head another open PR shares (F-014)", () => {
  const side = { ...eligible, number: 9, base: { ...eligible.base, ref: "feature" } };
  const main = { ...eligible, number: 8 };
  const shared = run(comment, { pr: side, files: addedTest, openPulls: [side, main] });
  assert.equal(shared.code, 0);
  assert.deepEqual(shared.posts, []);
  // An unread list counts as shared: nothing is written, and the run fails.
  const unread = run(comment, { pr: side, files: addedTest, fail: ["/pulls"] });
  assert.equal(unread.code, 1);
  assert.ok(unread.posts.every((p) => p.body.state !== "success"));
  // Control: alone on its head it still gets the pending marker.
  const alone = run(comment, { pr: side, files: addedTest, openPulls: [side] });
  assert.deepEqual(states(alone.posts), ALL.map((c) => [c, "pending"]));
});