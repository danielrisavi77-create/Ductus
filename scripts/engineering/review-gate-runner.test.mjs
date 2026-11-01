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
let pullListReads = 0;
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
      base: { sha: "${BASE}", ref: "main", repo: { full_name: "o/r", default_branch: "main" } },
      html_url: "https://github.com/o/r/pull/7", body: "", ...plan.pr });
  }
  if (path.endsWith("/pulls/7/files")) return reply(200, plan.files ?? []);
  if (path.endsWith("/issues/7/comments")) return reply(200, plan.comments ?? []);
  if (path.endsWith("/issues/7/events")) return reply(200, plan.timeline ?? []);
  if (path.endsWith("/pulls/7/reviews")) return reply(200, plan.reviews ?? []);
  if (path.endsWith("/pulls")) {
    pullListReads++;
    if (pullListReads > 1 && plan.failListReread) throw new TypeError("fetch failed");
    return reply(200, (pullListReads > 1 ? plan.openPullsReread : undefined) ?? plan.openPulls ?? []);
  }
  if (path.includes("/commits/")) return reply(200, { sha: "${HEAD}", parents: [{ sha: "${BASE}" }] });
  if (path.includes("/compare/")) return reply(200, { files: [], commits: [] });
  return reply(200, []);
};
`;

function run(event, { fail = [], statusFails = false, failPostNumber = 0, pr = {}, files, openPulls, comments, timeline, reviews, openPullsReread, failListReread } = {}) {
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
      FAKE_GH: JSON.stringify({ fail, statusFails, failPostNumber, pr, files, openPulls, comments, timeline, reviews, openPullsReread, failListReread }),
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
    head: { sha: HEAD, repo: { full_name: "o/r" } },
    base: { ref: "main", repo: { full_name: "o/r", default_branch: "main" } },
  },
};

test("a failed comment read after the head is known marks the head pending", () => {
  const { code, posts } = run(comment, { fail: ["/issues/7/comments"] });
  assert.equal(code, 1);
  // The failure path resets all three statuses (QA c.6558749797 on #1117).
  assert.deepEqual(posts.map((p) => p.body.context), ["Merge authorization", "Auto-merge eligible", "Engineering review gate"]);
  for (const post of posts) {
    assert.equal(post.path, `/repos/o/r/statuses/${HEAD}`);
    assert.equal(post.body.state, "pending");
    assert.match(post.body.description, /failed before a verdict/);
  }
});

test("a failed PR read marks the event head pending when the event names one", () => {
  const withHead = run(pullRequest, { fail: ["/pulls/7"] });
  assert.equal(withHead.code, 1);
  assert.deepEqual(withHead.posts.map((p) => [p.path, p.body.context, p.body.state]), [
    [`/repos/o/r/statuses/${HEAD}`, "Merge authorization", "pending"],
    [`/repos/o/r/statuses/${HEAD}`, "Auto-merge eligible", "pending"],
    [`/repos/o/r/statuses/${HEAD}`, "Engineering review gate", "pending"],
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

test("another open PR on the same head leaves every status pending (F-165, F-040)", () => {
  for (const other of [{ number: 8, head: { sha: HEAD } }, { number: 9, head: { sha: HEAD.toUpperCase() }, base: { ref: "feature" } }]) {
    const { code, posts } = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible, other] });
    assert.equal(code, 0);
    assert.deepEqual(states(posts), ALL.map((c) => [c, "pending"]));
    for (const post of posts) {
      assert.equal(post.path, `/repos/o/r/statuses/${HEAD}`);
      assert.match(post.body.description, /another open PR shares this head/);
    }
  }
  // A failed read of the open PRs fails the run closed.
  const failed = run(comment, { pr: eligible, files: addedTest, fail: ["/pulls"] });
  assert.equal(failed.code, 1);
  assert.ok(failed.posts.every((p) => p.body.state !== "success"));
});

// F-040: two open PRs on one head, one to main and one to a side branch whose
// diff is a single docs file. A status belongs to the head, so the test folds
// the runs in order into the statuses the head is left with: no order of
// events may leave a green one, also when the PR to main was green first
// (Codex review c.6564729651).
const finalStates = (runs) => {
  const last = {};
  for (const { posts } of runs) for (const p of posts) last[p.body.context] = [p.path, p.body.state];
  return last;
};
test("F-040 regression: no green gate status in the registered case", () => {
  const side = {
    ...eligible, number: 8, body: "Agent: claude:a:platforma\nRisk: low\nTask: B-1\n",
    head: { ...eligible.head, ref: "feat/y" }, base: { ...eligible.base, ref: "side" },
  };
  const docs = [{ filename: "docs/x.md", status: "modified" }];
  // The side PR as seen by its own run (the fake serves PR number 7).
  const asSide = { pr: { ...side, number: 7 }, files: docs, openPulls: [{ ...eligible, number: 8 }, { ...side, number: 7 }] };
  const mainAlone = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible] });
  assert.deepEqual(states(mainAlone.posts), ALL.map((c) => [c, "success"]));
  const sequences = [
    // Green first, then the side PR is opened, then later events on either PR.
    [mainAlone, run(pullRequest, asSide)],
    [mainAlone, run(pullRequest, asSide), run(comment, { pr: eligible, files: addedTest, openPulls: [eligible, side] })],
    [mainAlone, run(pullRequest, asSide), run(comment, asSide)],
    [run(comment, asSide), run(pullRequest, { pr: eligible, files: addedTest, openPulls: [eligible, side] })],
  ];
  for (const [index, runs] of sequences.entries()) {
    for (const { code } of runs) assert.equal(code, 0, `sequence ${index}`);
    const last = finalStates(runs);
    assert.deepEqual(Object.keys(last).sort(), [...ALL].sort(), `sequence ${index}`);
    for (const [statusContext, [where, state]] of Object.entries(last)) {
      assert.equal(where, `/repos/o/r/statuses/${HEAD}`, `sequence ${index} ${statusContext}`);
      assert.equal(state, "pending", `sequence ${index} ${statusContext}`);
    }
  }
  // Every write the side PR makes on the shared head is the shared-head marker.
  for (const post of run(comment, asSide).posts) {
    assert.equal(post.body.state, "pending");
    assert.match(post.body.description, /another open PR shares this head/);
  }
});

// F-040 (QA c.6564767686): the run of the PR to main read the open PRs before
// another PR on its head was opened, and that PR's run wrote pending first.
test("a green run re-reads the open PRs and clears its statuses when the head is now shared (F-040)", () => {
  const other = { ...eligible, number: 8 };
  const raced = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], openPullsReread: [eligible, other] });
  assert.equal(raced.code, 0);
  const last = finalStates([raced]);
  for (const c of ALL) assert.equal(last[c][1], "pending", c);
  for (const post of raced.posts.slice(-3)) assert.match(post.body.description, /another open PR shares this head/);
  // A failed re-read fails the run closed.
  const unread = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], failListReread: true });
  assert.equal(unread.code, 1);
  for (const c of ALL) assert.equal(finalStates([unread])[c][1], "pending", c);
  // Control: a head still alone keeps its three green statuses.
  const alone = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], openPullsReread: [eligible] });
  assert.deepEqual(states(alone.posts), ALL.map((c) => [c, "success"]));
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

// F-013: a PASS written while the base was another branch judged another diff.
const standard = {
  ...eligible,
  body: "Agent: claude:a:platforma\nRisk: standard\nTask: B-1\n",
};
const srcFile = [{ filename: "src/a.ts", status: "modified" }];
const passAt = (at) => ({
  body: `Agent-Review: claude:b:reviewer\nReview-Head: ${HEAD}\nReview-Verdict: PASS\n`,
  user: { login: "o" },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: at,
  updated_at: at,
});
const baseChange = (at) => ({ event: "base_ref_changed", created_at: at });
const gateState = (out) => out.posts.find((p) => p.body.context === "Engineering review gate")?.body.state;

test("control: a review PASS on the head turns the gate green when the base never changed (F-013)", () => {
  const out = run(comment, { pr: standard, files: srcFile, openPulls: [standard], comments: [passAt("2026-10-31T10:00:00Z")] });
  assert.equal(out.code, 0);
  assert.equal(gateState(out), "success");
});

test("a PASS from before the last base change does not count, one after it does (F-013)", () => {
  const before = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard],
    comments: [passAt("2026-10-31T10:00:00Z")],
    timeline: [{ event: "commented", created_at: "2026-10-31T09:00:00Z" }, baseChange("2026-10-31T11:00:00Z")],
  });
  assert.equal(before.code, 0);
  assert.ok(before.posts.every((p) => p.body.state !== "success"), JSON.stringify(states(before.posts)));
  // The same second as the change is not after it.
  const same = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard],
    comments: [passAt("2026-10-31T11:00:00Z")], timeline: [baseChange("2026-10-31T11:00:00Z")],
  });
  assert.notEqual(gateState(same), "success");
  // Only the last change counts: a review between two changes is dropped too.
  const between = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard],
    comments: [passAt("2026-10-31T10:30:00Z")],
    timeline: [baseChange("2026-10-31T10:00:00Z"), baseChange("2026-10-31T11:00:00Z")],
  });
  assert.notEqual(gateState(between), "success");
  const after = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard],
    comments: [passAt("2026-10-31T12:00:00Z")], timeline: [baseChange("2026-10-31T11:00:00Z")],
  });
  assert.equal(gateState(after), "success");
});

test("an unreadable timeline or change time fails closed (F-013)", () => {
  const failed = run(comment, { pr: standard, files: srcFile, openPulls: [standard], comments: [passAt("2026-10-31T10:00:00Z")], fail: ["/issues/7/events"] });
  assert.equal(failed.code, 1);
  assert.ok(failed.posts.every((p) => p.body.state !== "success"));
  const noTime = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard],
    comments: [passAt("2026-10-31T12:00:00Z")], timeline: [{ event: "base_ref_changed" }],
  });
  assert.notEqual(gateState(noTime), "success");
});

// QA c.6558749797 on #1117 (1): a PR exempt from review (only a new test)
// needs no comment, so dropping all comments for an unreadable change time
// left it green. The run stops and marks all three statuses pending.
test("a base change without a readable time stops a review-exempt PR too (F-013)", () => {
  for (const timeline of [[{ event: "base_ref_changed" }], [{ event: "base_ref_changed", created_at: "garbage" }]]) {
    const out = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], timeline });
    assert.equal(out.code, 1, JSON.stringify(timeline));
    assert.deepEqual(states(out.posts), ALL.map((c) => [c, "pending"]), JSON.stringify(timeline));
    for (const post of out.posts) assert.match(post.body.description, /failed before a verdict/);
  }
  // Control: the same PR with a readable change time stays green.
  const readable = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], timeline: [baseChange("2026-10-31T11:00:00Z")] });
  assert.equal(readable.code, 0);
  assert.deepEqual(states(readable.posts), ALL.map((c) => [c, "success"]));
});

// QA c.6558749797 on #1117 (2): a failed events read must not leave an older
// green Auto-merge eligible; the failure path writes all three as pending.
test("a failed events read marks all three statuses pending (F-013)", () => {
  const out = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], fail: ["/issues/7/events"] });
  assert.equal(out.code, 1);
  assert.deepEqual(states(out.posts), ALL.map((c) => [c, "pending"]));
  // A queue carrier never gets Auto-merge eligible, not even on failure.
  const carrierFail = run(comment, { pr: carrier, failPostNumber: 1 });
  assert.equal(carrierFail.code, 1);
  assert.ok(carrierFail.posts.every((p) => p.body.context !== "Auto-merge eligible"));
});

// QA c.6561448849 on #1117: the base change filter covers issue comments only.
// PR reviews reach quota evidence unfiltered, so a review of the exhausted App
// without a readable time still voids the evidence after a base change.
const byOwnerAt = (body, at) => ({
  body, user: { login: "o" }, author_association: "OWNER",
  performed_via_github_app: { slug: "claude" }, created_at: at, updated_at: at,
});
const quotaFallback = [
  {
    body: "You have reached your Codex usage limits for code reviews. Ask an admin to raise the limit.",
    user: { login: "chatgpt-codex-connector[bot]", type: "Bot" }, author_association: "NONE",
    performed_via_github_app: { slug: "chatgpt-codex-connector" },
    created_at: "2026-10-31T12:00:00Z", updated_at: "2026-10-31T12:00:00Z",
  },
  byOwnerAt(`Agent-Review: claude:b:reviewer\nReview-Head: ${HEAD}\nReview-Verdict: PASS\n`, "2026-10-31T12:10:00Z"),
  byOwnerAt(
    `QA-Agent: claude:c:qa\nQA-Head: ${HEAD}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector\n`,
    "2026-10-31T12:20:00Z",
  ),
];
const fallbackPr = { ...eligible, body: "Agent: chatgpt:a:backend\nRisk: critical\nTask: B-1\n" };
const codexPrReview = (submittedAt) => ({
  user: { login: "chatgpt-codex-connector[bot]", type: "Bot" }, state: "PENDING", body: "Codex Review", submitted_at: submittedAt,
});

test("a Codex PR review without a readable time voids quota evidence after a base change (F-013)", () => {
  const input = { pr: fallbackPr, files: srcFile, openPulls: [fallbackPr], comments: quotaFallback, timeline: [baseChange("2026-10-31T11:00:00Z")] };
  // Control: without the review the fallback holds after the change.
  assert.equal(gateState(run(comment, input)), "success");
  for (const submittedAt of [null, undefined, "garbage"]) {
    const out = run(comment, { ...input, reviews: [codexPrReview(submittedAt)] });
    assert.equal(out.code, 0, String(submittedAt));
    assert.equal(gateState(out), "pending", String(submittedAt));
  }
  // An old review with a readable time before the change still voids nothing,
  // as on main: it predates the quota message.
  assert.equal(gateState(run(comment, { ...input, reviews: [codexPrReview("2026-10-31T10:00:00Z")] })), "success");
});

// Codex review c.6562680923 on #1117: GitHub retargets a dependent PR after its
// base branch is deleted and records automatic_base_change_succeeded, not
// base_ref_changed. That change voids an older PASS and Owner-Command as well.
const autoChange = (at) => ({ event: "automatic_base_change_succeeded", created_at: at });
const mergeState = (out) => out.posts.find((p) => p.body.context === "Merge authorization")?.body.state;
const d97Pr = { ...fallbackPr, body: "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n" };
const d97File = [{ filename: "scripts/engineering/review-gate.mjs", status: "modified" }];
// The owner writes a merge command directly, not through an App.
const ownerCommandAt = (at) => ({ ...byOwnerAt(`Owner-Command: merge\nCommand-Head: ${HEAD}\n`, at), performed_via_github_app: null });

test("an automatic base change voids an older PASS and Owner-Command, as a manual one does (F-013)", () => {
  // A review PASS from before the automatic change does not count; one after it does.
  const stale = run(comment, { pr: standard, files: srcFile, openPulls: [standard], comments: [passAt("2026-10-31T10:00:00Z")], timeline: [autoChange("2026-10-31T11:00:00Z")] });
  assert.equal(stale.code, 0);
  assert.ok(stale.posts.every((p) => p.body.state !== "success"), JSON.stringify(states(stale.posts)));
  const fresh = run(comment, { pr: standard, files: srcFile, openPulls: [standard], comments: [passAt("2026-10-31T12:00:00Z")], timeline: [autoChange("2026-10-31T11:00:00Z")] });
  assert.equal(gateState(fresh), "success");
  // The failed variant changes nothing: the PASS keeps counting.
  const failedAuto = run(comment, {
    pr: standard, files: srcFile, openPulls: [standard], comments: [passAt("2026-10-31T10:00:00Z")],
    timeline: [{ event: "automatic_base_change_failed", created_at: "2026-10-31T11:00:00Z" }],
  });
  assert.equal(gateState(failedAuto), "success");
  // D-97 PR, verdicts after the change: the owner command from before it does not authorize the merge.
  const input = { pr: d97Pr, files: d97File, openPulls: [d97Pr], timeline: [autoChange("2026-10-31T11:00:00Z")] };
  const oldCommand = run(comment, { ...input, comments: [ownerCommandAt("2026-10-31T10:30:00Z"), ...quotaFallback] });
  assert.equal(oldCommand.code, 0);
  assert.equal(gateState(oldCommand), "success");
  assert.equal(mergeState(oldCommand), "pending");
  const newCommand = run(comment, { ...input, comments: [...quotaFallback, ownerCommandAt("2026-10-31T12:30:00Z")] });
  assert.equal(mergeState(newCommand), "success");
  // An automatic change without a readable time stops the run.
  const noTime = run(comment, { pr: eligible, files: addedTest, openPulls: [eligible], timeline: [{ event: "automatic_base_change_succeeded" }] });
  assert.equal(noTime.code, 1);
  assert.deepEqual(states(noTime.posts), ALL.map((c) => [c, "pending"]));
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

test("a PR off the default branch writes only the shared-head marker on a head another open PR shares (F-014, F-040)", () => {
  const side = { ...eligible, number: 9, base: { ...eligible.base, ref: "feature" } };
  const main = { ...eligible, number: 8 };
  // F-040: the head's statuses must not stay green while it is shared, so the
  // side PR clears them; it never writes success or its own base marker there.
  const shared = run(comment, { pr: side, files: addedTest, openPulls: [side, main] });
  assert.equal(shared.code, 0);
  assert.deepEqual(states(shared.posts), ALL.map((c) => [c, "pending"]));
  for (const post of shared.posts) {
    assert.equal(post.path, `/repos/o/r/statuses/${HEAD}`);
    assert.match(post.body.description, /another open PR shares this head/);
  }
  // An unread list counts as shared: nothing is written, and the run fails.
  const unread = run(comment, { pr: side, files: addedTest, fail: ["/pulls"] });
  assert.equal(unread.code, 1);
  assert.deepEqual(unread.posts, []);
  // Any other failed read of a side-base PR writes nothing either: the failure
  // marker would land on a head a PR to main may own.
  for (const fail of [["/issues/7/comments"], ["/pulls/7/files"], ["/pulls/7/reviews"], ["/pulls/7/comments"]]) {
    const failed = run(comment, { pr: side, files: addedTest, openPulls: [side, main], fail });
    assert.equal(failed.code, 1, fail[0]);
    assert.deepEqual(failed.posts, [], fail[0]);
  }
  // A side-base event whose PR read fails does not mark the event head.
  const sideEvent = { pull_request: { ...pullRequest.pull_request, base: { ref: "feature", repo: { full_name: "o/r", default_branch: "main" } } } };
  const eventFail = run(sideEvent, { fail: ["/pulls/7"] });
  assert.equal(eventFail.code, 1);
  assert.deepEqual(eventFail.posts, []);
  // Control: alone on its head it still gets the pending marker.
  const alone = run(comment, { pr: side, files: addedTest, openPulls: [side] });
  assert.deepEqual(states(alone.posts), ALL.map((c) => [c, "pending"]));
});
