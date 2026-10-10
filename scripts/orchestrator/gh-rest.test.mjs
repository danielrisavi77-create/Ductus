import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRollup, ghList, mergedPrs, prView, reviewThreads, toPr } from "./gh.mjs";
import { evaluateChecks, summarizeThreads } from "./orchestrator-core.mjs";

const rest = (over = {}) => ({
  number: 7, title: "t", body: null, state: "open", draft: false, merged_at: null, mergeable: true,
  head: { sha: "abc123" }, base: { ref: "main" }, created_at: "2026-10-01T00:00:00Z", auto_merge: null, ...over,
});

test("toPr maps REST fields to the gh-CLI names", () => {
  assert.deepEqual(toPr(rest()), {
    number: 7, title: "t", body: "", state: "OPEN", isDraft: false, headRefOid: "abc123", baseRefName: "main",
    createdAt: "2026-10-01T00:00:00Z", mergedAt: null, mergeable: "MERGEABLE", autoMergeRequest: null,
  });
  assert.equal(toPr(rest({ mergeable: false })).mergeable, "CONFLICTING");
  assert.equal(toPr(rest({ mergeable: null })).mergeable, "UNKNOWN");
  assert.equal(toPr(rest({ state: "closed", merged_at: "2026-10-02T00:00:00Z" })).state, "MERGED");
  assert.equal(toPr(rest({ state: "closed" })).state, "CLOSED");
  assert.deepEqual(toPr(rest({ auto_merge: { merge_method: "squash" } })).autoMergeRequest, { merge_method: "squash" });
});

test("prView reads an UNKNOWN mergeable once more, and only for an open PR", async () => {
  const answers = [rest({ mergeable: null }), rest({ mergeable: false })];
  const calls = [];
  const pr = await prView(7, { waitMs: 0, json: async (a) => { calls.push(a); return answers.shift(); } });
  assert.equal(pr.mergeable, "CONFLICTING");
  assert.deepEqual(calls, [["api", "repos/{owner}/{repo}/pulls/7"], ["api", "repos/{owner}/{repo}/pulls/7"]]);

  let n = 0;
  const closed = await prView(7, { waitMs: 0, json: async () => { n += 1; return rest({ state: "closed", mergeable: null }); } });
  assert.equal(closed.state, "CLOSED");
  assert.equal(n, 1);
});

test("mergedPrs keeps merged PRs from the date on, ascending", async () => {
  let path;
  const prs = await mergedPrs("2026-10-05", {
    list: async (p) => {
      path = p;
      return [
        rest({ number: 9, state: "closed", merged_at: "2026-10-06T10:00:00Z" }),
        rest({ number: 3, state: "closed", merged_at: "2026-10-05T00:00:00Z" }),
        rest({ number: 4, state: "closed", merged_at: "2026-10-04T23:59:59Z" }),
        rest({ number: 5, state: "closed" }),
      ];
    },
  });
  assert.equal(path, "repos/{owner}/{repo}/pulls?state=closed&base=main&per_page=100");
  assert.deepEqual(prs.map((p) => p.number), [3, 9]);
});

test("checkRollup joins check runs and statuses in the rollup shape evaluateChecks reads", async () => {
  const run = (name, status, conclusion, suite = 1, started = "2026-10-01T00:00:00Z") => ({
    name, status, conclusion, started_at: started, completed_at: null, check_suite: { id: suite },
  });
  const rollup = await checkRollup("abc", {
    list: async (path, _exec, opts) => (opts?.key === "check_runs"
      ? [run("test", "completed", "success"), run("lint", "in_progress", null), run("e2e", "completed", "failure"),
        run("e2e", "completed", "success", 1, "2026-10-01T01:00:00Z"), run("test", "completed", "failure", 2)]
      : [{ context: "Engineering review gate", state: "pending", created_at: "2026-10-01T00:00:00Z" }]),
  });
  const ck = evaluateChecks(rollup);
  assert.equal(ck.total, 4);
  // the e2e re-run wins; "test" from another suite stays a separate check
  assert.deepEqual(ck.bad, [{ name: "lint", state: "IN_PROGRESS" }, { name: "test", state: "FAILURE" }]);
  // a completed run without conclusion is not green
  const odd = await checkRollup("abc", { list: async (_p, _e, o) => (o?.key ? [run("x", "completed", null)] : []) });
  assert.deepEqual(evaluateChecks(odd).bad, [{ name: "x", state: "COMPLETED" }]);
});

test("reviewThreads maps CCR threads to the node shape and reads authors only when needed", async () => {
  const lists = [];
  const nodes = await reviewThreads(7, {
    json: async () => [
      { resolved: true, comment_ids: [1] },
      { resolved: false, comment_ids: [2, 3] },
    ],
    list: async (p) => { lists.push(p); return [{ id: 1, user: { login: "a" } }, { id: 2, user: { login: "b" } }]; },
  });
  assert.deepEqual(lists, ["repos/{owner}/{repo}/pulls/7/comments?per_page=100"]);
  assert.deepEqual(summarizeThreads(nodes), { count: 1, authors: ["b"] });

  const none = await reviewThreads(7, { json: async () => [{ resolved: true, comment_ids: [1] }], list: async () => assert.fail("no read") });
  assert.deepEqual(summarizeThreads(none), { count: 0, authors: [] });
  await assert.rejects(reviewThreads(7, { json: async () => ({ message: "x" }) }), /unexpected/);
});

test("ghList requests pages by number until a short page, and picks a keyed array", async () => {
  const calls = [];
  const exec = async (_cmd, args) => {
    calls.push(args[1]);
    return JSON.stringify({ check_runs: calls.length === 1 ? [1, 2] : [3] });
  };
  assert.deepEqual(await ghList("x?per_page=2", exec, { key: "check_runs" }), [1, 2, 3]);
  assert.deepEqual(calls, ["x?per_page=2&page=1", "x?per_page=2&page=2"]);
  await assert.rejects(ghList("y", async () => "{}"), /unexpected response for y/);
  await assert.rejects(ghList("z?per_page=1", async () => "[1]"), /more than 50 pages/);
});
