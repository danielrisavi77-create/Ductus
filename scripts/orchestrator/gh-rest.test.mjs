import assert from "node:assert/strict";
import { test } from "node:test";

import { ccrThreads, checkRollup, ghList, graphqlThreads, mainPathsSince, mergedPrs, prView, reviewThreads, toPr } from "./gh.mjs";
import { evaluateChecks, summarizeThreads } from "./orchestrator-core.mjs";

const rest = (over = {}) => ({
  number: 7, title: "t", body: null, state: "open", draft: false, merged_at: null, mergeable: true,
  head: { sha: "abc123", ref: "feat/x" }, base: { ref: "main" }, created_at: "2026-10-01T00:00:00Z", auto_merge: null,
  user: { login: "someone", type: "User" }, ...over,
});

test("toPr maps REST fields to the gh-CLI names", () => {
  assert.deepEqual(toPr(rest()), {
    number: 7, title: "t", body: "", state: "OPEN", isDraft: false, headRefOid: "abc123", headRefName: "feat/x",
    author: { login: "someone", type: "User" }, baseRefName: "main",
    createdAt: "2026-10-01T00:00:00Z", mergedAt: null, mergeable: "MERGEABLE", autoMergeRequest: null,
  });
  assert.deepEqual(toPr(rest({ user: undefined })).author, { login: null, type: null });
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
  const run = (name, status, conclusion, suite = 1, started = "2026-10-01T00:00:00Z", appId = 15368) => ({
    name, status, conclusion, started_at: started, completed_at: null, app: { id: appId }, check_suite: { id: suite },
  });
  const rollup = await checkRollup("abc", {
    list: async (path, _exec, opts) => (opts?.key === "check_runs"
      ? [run("test", "completed", "success"), run("lint", "in_progress", null), run("e2e", "completed", "failure"),
        run("e2e", "completed", "success", 1, "2026-10-01T01:00:00Z"), run("test", "completed", "failure", 2)]
      : [{ context: "Engineering review gate", state: "pending", created_at: "2026-10-01T00:00:00Z" }]),
  });
  const ck = evaluateChecks(rollup);
  assert.equal(ck.total, 4);
  assert.ok(rollup.filter((item) => item.name).every((item) => item.appId === 15368));
  assert.equal(rollup.find((item) => item.context)?.appId, undefined);
  // the e2e re-run wins; "test" from another suite stays a separate check
  assert.deepEqual(ck.bad, [{ name: "lint", state: "IN_PROGRESS" }, { name: "test", state: "FAILURE" }]);
  // a completed run without conclusion is not green
  const odd = await checkRollup("abc", { list: async (_p, _e, o) => (o?.key ? [run("x", "completed", null)] : []) });
  assert.deepEqual(evaluateChecks(odd).bad, [{ name: "x", state: "COMPLETED" }]);
  // the App slug is carried, so the merge queue's own checks can be told apart by App, not by name
  const slugged = await checkRollup("abc", {
    list: async (_p, _e, o) => (o?.key ? [{ ...run("Mergify Merge Queue", "in_progress", null), app: { id: 10562, slug: "mergify" } }, run("lint", "completed", "success")] : []),
  });
  assert.deepEqual(slugged.map((c) => c.appSlug), ["mergify", null]);
});

test("ccrThreads maps CCR threads to the node shape and reads authors only when needed", async () => {
  const lists = [];
  const nodes = await ccrThreads(7, {
    json: async () => [
      { resolved: true, comment_ids: [1] },
      { resolved: false, comment_ids: [2, 3] },
    ],
    list: async (p) => { lists.push(p); return [{ id: 1, user: { login: "a" } }, { id: 2, user: { login: "b" } }]; },
  });
  assert.deepEqual(lists, ["repos/{owner}/{repo}/pulls/7/comments?per_page=100"]);
  assert.deepEqual(summarizeThreads(nodes), { count: 1, authors: ["b"] });

  const none = await ccrThreads(7, { json: async () => [{ resolved: true, comment_ids: [1] }], list: async () => assert.fail("no read") });
  assert.deepEqual(summarizeThreads(none), { count: 0, authors: [] });
  await assert.rejects(ccrThreads(7, { json: async () => ({ message: "x" }) }), /unexpected/);
  // a thread without a boolean resolved flag is not read as resolved
  await assert.rejects(ccrThreads(7, { json: async () => [{ comment_ids: [1] }], list: async () => [] }), /without resolved/);
});

const REPO = async () => ({ owner: "o", repo: "r" });
const thread = (isResolved, login) => ({ isResolved, comments: { nodes: [{ author: { login } }] } });
const gqlPage = (nodes, { next = null, total = nodes.length } = {}) => ({
  data: { repository: { pullRequest: { reviewThreads: {
    totalCount: total, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes,
  } } } },
});

test("graphqlThreads reads every page with the cursor and keeps open threads open", async () => {
  const calls = [];
  const pages = [gqlPage([thread(true, "a"), thread(false, "b")], { next: "c1", total: 3 }), gqlPage([thread(false, "c")], { total: 3 })];
  const nodes = await graphqlThreads(7, { repo: REPO, json: async (args) => { calls.push(args); return pages[calls.length - 1]; } });
  assert.deepEqual(summarizeThreads(nodes), { count: 2, authors: ["b", "c"] });
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
    assert.ok(args.includes("owner=o") && args.includes("repo=r") && args.includes("n=7"));
  }
  assert.ok(!calls[0].some((a) => a.startsWith("after=")));
  assert.ok(calls[1].includes("after=c1"));
  // no threads at all is a complete, empty read
  assert.deepEqual(summarizeThreads(await graphqlThreads(7, { repo: REPO, json: async () => gqlPage([]) })), { count: 0, authors: [] });
});

test("graphqlThreads throws on every answer that is not a complete thread list", async () => {
  const bad = [
    { errors: [{ message: "x" }], data: null },
    { data: { repository: { pullRequest: null } } },
    { data: { repository: null } },
    {},
    null,
    gqlPage([{ comments: { nodes: [] } }]), // isResolved missing
    gqlPage([thread("false", "a")]), // isResolved not boolean
    gqlPage([thread(false, "a")], { total: 2 }), // fewer threads than totalCount
    gqlPage([thread(false, "a")], { next: "" }), // next page without cursor
    { data: { repository: { pullRequest: { reviewThreads: { totalCount: 0, nodes: [] } } } } }, // no pageInfo
  ];
  for (const body of bad) {
    await assert.rejects(graphqlThreads(7, { repo: REPO, json: async () => body }), Error, JSON.stringify(body));
  }
  // a cursor that never ends is cut, not trusted
  await assert.rejects(graphqlThreads(7, { repo: REPO, json: async () => gqlPage([], { next: "again" }) }), /pages/);
});

test("reviewThreads uses graphql, falls back to the ccr route, and throws when both fail", async () => {
  const open = [thread(false, "x")];
  const fail = (m) => async () => { throw new Error(m); };
  assert.deepEqual(await reviewThreads(7, { graphql: async () => open, ccr: async () => assert.fail("not reached") }), open);
  assert.deepEqual(await reviewThreads(7, { graphql: fail("HTTP 403"), ccr: async () => open }), open);
  await assert.rejects(
    reviewThreads(7, { graphql: fail("HTTP 403"), ccr: fail("HTTP 404: Not Found") }),
    /graphql: HTTP 403; ccr: HTTP 404: Not Found/,
  );
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

test("mainPathsSince reads the compare once, whole, and fails closed at the 300-file cap (review495a)", async () => {
  const calls = [];
  const files = Array.from({ length: 157 }, (_, i) => ({ filename: `src/f${i}.ts` }));
  const exec = async (_cmd, args) => { calls.push(args[1]); return JSON.stringify({ files }); };
  const paths = await mainPathsSince("a".repeat(40), "b".repeat(40), exec);
  assert.equal(paths.length, 157);
  assert.deepEqual(calls, [`repos/{owner}/{repo}/compare/${"a".repeat(40)}...${"b".repeat(40)}`]);
  const renamed = async () => JSON.stringify({ files: [{ filename: "n.ts", previous_filename: "o.ts" }] });
  assert.deepEqual(await mainPathsSince("a".repeat(40), "b".repeat(40), renamed), ["n.ts", "o.ts"]);
  const cut = async () => JSON.stringify({ files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) });
  await assert.rejects(mainPathsSince("a".repeat(40), "b".repeat(40), cut), /300-file API cap/);
  await assert.rejects(mainPathsSince("a".repeat(40), "b".repeat(40), async () => JSON.stringify({ files: null })), /no file list/);
});
