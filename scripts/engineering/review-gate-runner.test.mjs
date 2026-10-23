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
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url).pathname;
  if ((options.method ?? "GET") === "POST" && path.includes("/statuses/")) {
    appendFileSync(process.env.FAKE_LOG, JSON.stringify({ path, body: JSON.parse(options.body) }) + "\\n");
    return plan.statusFails ? reply(500, { message: "down" }) : reply(201, {});
  }
  if (plan.fail.some((p) => path.endsWith(p))) throw new TypeError("fetch failed");
  if (/\\/pulls\\/\\d+$/.test(path)) {
    return reply(200, { number: 7, head: { sha: "${HEAD}" }, base: { sha: "${BASE}" },
      html_url: "https://github.com/o/r/pull/7", body: "", ...plan.pr });
  }
  if (path.includes("/commits/")) return reply(200, { sha: "${HEAD}", parents: [{ sha: "${BASE}" }] });
  if (path.includes("/compare/")) return reply(200, { files: [], commits: [] });
  return reply(200, []);
};
`;

function run(event, { fail = [], statusFails = false, pr = {} } = {}) {
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
      FAKE_GH: JSON.stringify({ fail, statusFails, pr }),
      FAKE_LOG: log,
    },
  });
  const posts = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { code: result.status, posts, stderr: result.stderr };
}

const comment = { issue: { number: 7, pull_request: {} } };
const pullRequest = { pull_request: { number: 7, head: { sha: HEAD }, html_url: "https://github.com/o/r/pull/7" } };

test("a failed comment read after the head is known marks the head pending", () => {
  const { code, posts } = run(comment, { fail: ["/issues/7/comments"] });
  assert.equal(code, 1);
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
  assert.deepEqual(posts.map((p) => p.body.context), ["Merge authorization", "Engineering review gate"]);
  for (const post of posts) assert.doesNotMatch(post.body.description, /failed before a verdict/);
});

const batchPr = (over = {}) => ({
  user: { login: "mergify[bot]" },
  head: { sha: HEAD, ref: "mergify/merge-queue/abc", repo: { full_name: "o/r" } },
  ...over,
});

test("DAN-240: Mergify's own batch branch gets both statuses green without reading PR metadata", () => {
  const { code, posts } = run(comment, { pr: batchPr(), fail: ["/issues/7/comments"] });
  assert.equal(code, 0);
  assert.deepEqual(posts.map((p) => [p.body.context, p.body.state]), [
    ["Merge authorization", "success"],
    ["Engineering review gate", "success"],
  ]);
});

test("DAN-240: the batch exception needs Mergify as author, this repository and the queue branch name", () => {
  for (const over of [
    { user: { login: "someone" } },
    { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "o/r" } } },
    { head: { sha: HEAD, ref: "mergify/merge-queue/abc", repo: { full_name: "fork/r" } } },
  ]) {
    const { posts } = run(comment, { pr: batchPr(over) });
    assert.notEqual(posts[0].body.description, "Mergify merge-queue branch: each queued PR passed the gate.");
    assert.doesNotMatch(posts.map((p) => p.body.state).join(), /success/);
  }
});
