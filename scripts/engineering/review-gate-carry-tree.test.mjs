// F-046 class table (M0.6d, DAN-178, #1111): the D-101 carry over a clean merge
// of the base branch, through the real `carriedHeads` with a fake GitHub that
// serves every route the hardened carry reads (branch tip, compare with merge
// base, recursive tree). Invented SHAs only. The table is in the contract on
// #1091 (c.6587871281); K12 is the F-027 rule that a failed check keeps the
// negative of a reached head (#1396).
import test from "node:test";
import assert from "node:assert/strict";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import { evaluateGate, evaluateMergeAuthorization, lastBaseChange, sinceBaseChange } from "./review-gate-core.mjs";

const sha = (c) => c.repeat(40);
const head = sha("a");
const earlier = sha("b");
const tip = sha("e");
const tip2 = sha("d");
const oldBase = sha("9");
const mainParent = sha("f");
const ownerLogin = "danielrisavi77-create";

let counter = 0;
const at = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();
const review = (s, verdict = "PASS", slot = "b") => ({
  body: `Agent-Review: claude:${slot}:reviewer\nReview-Head: ${s}\nReview-Verdict: ${verdict}\n`,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: at(),
});
const override = (s) => ({
  body: `Owner-Override: PASS\nOverride-Head: ${s}\nOverride-Reason: demo\n`,
  user: { login: ownerLogin, type: "User" },
  author_association: "OWNER",
  performed_via_github_app: null,
  created_at: at(),
});

const command = (s) => ({ ...override(s), body: `Owner-Command: merge\nCommand-Head: ${s}\nDatum: 2026-11-05\n` });

const PATCH = "@@ -1 +1 @@\n-a\n+b";
const change = (over = {}) => ({ filename: "a.mjs", status: "modified", patch: PATCH, sha: sha("1"), ...over });
const entry = (over = {}) => ({ path: "a.mjs", mode: "100644", type: "blob", sha: sha("2"), ...over });

const COMPARE_RE = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/;

// head = a merge of main (at `tip`) on top of `earlier`. Every knob defaults to
// a clean D-101 merge: same diff, same tree entries on both heads and bases.
function world({
  prBase = tip,
  tips = [tip],
  diff = () => [change()],
  trees = {},
  truncated = [],
  fail = () => false,
  mergeBase = (base, s) => (s === head ? base : oldBase),
} = {}) {
  const calls = [];
  let tipReads = 0;
  const route = (path) => {
    if (/\/branches\/main$/.test(path)) return { name: "main", commit: { sha: tips[Math.min(tipReads++, tips.length - 1)] } };
    if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: earlier }, { sha: mainParent }] };
    if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: sha("0") }] };
    if (path.includes(`/compare/main...${mainParent}`)) return { status: "behind", files: [] };
    const range = path.match(COMPARE_RE);
    if (range) {
      const [, base, s] = range;
      const at = mergeBase(base, s);
      return { status: "ahead", ...(at ? { merge_base_commit: { sha: at } } : {}), files: diff(base, s) };
    }
    const tree = path.match(/\/git\/trees\/([0-9a-f]{40})/);
    if (tree) return { sha: tree[1], truncated: truncated.includes(tree[1]), tree: trees[tree[1]] ?? [entry()] };
    throw new Error(`unexpected ${path}`);
  };
  const fetchImpl = async (url) => {
    const path = url.replace("https://api.test", "");
    calls.push(path);
    if (fail(path)) return { ok: false, status: 502, text: async () => "Bad Gateway" };
    const value = route(path);
    return { ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) };
  };
  const api = createApi({ fetchImpl, baseUrl: "https://api.test", token: "t", timeoutMs: 1000 });
  return { api, pr: { head: { sha: head }, base: { sha: prBase, ref: "main" } }, calls };
}

const heads = (w, comments = [review(earlier)], lines = []) =>
  carriedHeads(w.api, "o", "r", w.pr, comments, { log: (line) => lines.push(line) });
const carry = async (...args) => [...(await heads(...args))];
const treeOf = (s, over) => ({ [s]: [entry(over)] });

test("K1 a clean base merge with the same diff and tree entries carries (D-101)", async () => {
  assert.deepEqual(await carry(world()), [earlier]);
});

test("K2 a different patch in one file carries nothing", async () => {
  const w = world({ diff: (base, s) => [change(s === head ? { patch: "@@ -1 +1 @@\n-a\n+c" } : {})] });
  assert.deepEqual(await carry(w), []);
});

for (const [id, over] of [
  ["K3 mode", { mode: "100755" }],
  ["K4 type", { mode: "120000", type: "blob" }],
  ["K4b submodule", { mode: "160000", type: "commit" }],
]) {
  for (const [side, s] of [["current", head], ["earlier", earlier]]) {
    test(`${id}: a different tree entry on the ${side} head with the same patch carries nothing`, async () => {
      assert.deepEqual(await carry(world({ trees: treeOf(s, over) })), []);
    });
  }
}

test("K5 a different entry at either merge base carries nothing (R1)", async () => {
  assert.deepEqual(await carry(world({ trees: treeOf(tip, { mode: "100755" }) })), []);
  assert.deepEqual(await carry(world({ trees: treeOf(oldBase, { mode: "100755" }) })), []);
});

test("K5b a file present at one merge base and absent at the other carries nothing", async () => {
  assert.deepEqual(await carry(world({ trees: { [tip]: [] } })), []);
  assert.deepEqual(await carry(world({ trees: { [oldBase]: [] } })), []);
});

test("K6 a rename reads the base side at the old path", async () => {
  const diff = () => [change({ filename: "b.mjs", previous_filename: "old.mjs", status: "renamed" })];
  const atOld = (mode) => [entry({ path: "old.mjs", mode })];
  const onHeads = { [head]: [entry({ path: "b.mjs" })], [earlier]: [entry({ path: "b.mjs" })] };
  assert.deepEqual(await carry(world({ diff, trees: { ...onHeads, [tip]: atOld("100644"), [oldBase]: atOld("100644") } })), [earlier]);
  assert.deepEqual(await carry(world({ diff, trees: { ...onHeads, [tip]: atOld("100755"), [oldBase]: atOld("100644") } })), []);
});

test("K7 the diff is judged against the live base tip, not the PR's stored base", async () => {
  const stale = sha("c");
  const diff = (base, s) => [change(base === tip && s === head ? { patch: "@@ -1 +1 @@\n-a\n+z" } : {})];
  assert.deepEqual(await carry(world({ prBase: stale, diff })), []);
});

test("K8 the base tip is read once and every compare uses that tip", async () => {
  const w = world({ tips: [tip, tip2] });
  assert.deepEqual(await carry(w), [earlier]);
  assert.equal(w.calls.filter((path) => /\/branches\/main$/.test(path)).length, 1, w.calls.join("\n"));
  const ranges = w.calls.filter((path) => COMPARE_RE.test(path));
  assert.ok(ranges.length >= 2 && ranges.every((path) => path.includes(`/compare/${tip}...`)), ranges.join("\n"));
});

const FAILING_CALLS = [
  ["K9a branch tip", (path) => /\/branches\/main$/.test(path)],
  ["K9b compare for the current head", (path) => COMPARE_RE.test(path) && path.includes(`...${head}`)],
  ["K9c compare for the earlier head", (path) => COMPARE_RE.test(path) && path.includes(`...${earlier}`)],
  ["K9d tree of the current head", (path) => path.includes(`/git/trees/${head}`)],
  ["K9d tree of the earlier head", (path) => path.includes(`/git/trees/${earlier}`)],
  ["K9e tree of a merge base", (path) => path.includes(`/git/trees/${oldBase}`)],
];
for (const [id, pred] of FAILING_CALLS) {
  test(`${id}: an error carries nothing and the failing call was reached`, async () => {
    const w = world({ fail: pred });
    const lines = [];
    assert.deepEqual(await carry(w, undefined, lines), []);
    assert.ok(w.calls.some(pred), `not reached:\n${w.calls.join("\n")}`);
    assert.ok(lines.some((line) => /failed closed/.test(line)), lines.join("\n"));
  });
}

test("K9f a truncated tree carries nothing", async () => {
  for (const s of [head, earlier, tip, oldBase]) assert.deepEqual(await carry(world({ truncated: [s] })), [], s);
});

test("K9g a compare without a merge base carries nothing", async () => {
  assert.deepEqual(await carry(world({ mergeBase: (base, s) => (s === head ? undefined : oldBase) })), []);
  assert.deepEqual(await carry(world({ mergeBase: (base, s) => (s === head ? base : undefined) })), []);
});

test("K9h a branch tip without a readable SHA carries nothing", async () => {
  for (const bad of [undefined, "", "e".repeat(39)]) assert.deepEqual(await carry(world({ tips: [bad] })), [], String(bad));
});

// K9i (QA c.6657595775): a tree entry needs `path`, `mode` and `type` as
// non-empty strings before any key is built; otherwise nothing carries. Each
// class is first served the same way on all four trees, where the old key
// ("undefined undefined" or "absent" on every side) matched and carried.
const BAD_ENTRIES = [
  ["only a path", { path: "a.mjs" }],
  ["no mode", { path: "a.mjs", type: "blob" }],
  ["no type", { path: "a.mjs", mode: "100644" }],
  ["no path", { mode: "100644", type: "blob" }],
  ["a numeric mode", { path: "a.mjs", mode: 100644, type: "blob" }],
  ["a null type", { path: "a.mjs", mode: "100644", type: null }],
  ["an empty path", { path: "", mode: "100644", type: "blob" }],
  ["an empty mode", { path: "a.mjs", mode: "", type: "blob" }],
  ["a null entry", null],
  ["a string entry", "a.mjs"],
];
const allTrees = (items) => Object.fromEntries([head, earlier, tip, oldBase].map((s) => [s, items]));

test("K9i the QA case {truncated:false, tree:[{path:\"a.mjs\"}]} with the same patches carries nothing", async () => {
  const lines = [];
  assert.deepEqual(await carry(world({ trees: allTrees([{ path: "a.mjs" }]) }), undefined, lines), []);
  assert.ok(lines.some((line) => /failed closed/.test(line)), lines.join("\n"));
});

for (const [id, bad] of BAD_ENTRIES) {
  test(`K9i a tree entry with ${id} carries nothing, on all trees or on any one`, async () => {
    assert.deepEqual(await carry(world({ trees: allTrees([bad]) })), [], "all trees");
    for (const s of [head, earlier, tip, oldBase]) {
      const lines = [];
      assert.deepEqual(await carry(world({ trees: { [s]: [entry(), bad] } }), undefined, lines), [], s);
      assert.ok(lines.some((line) => line.includes(`tree of ${s}`)), lines.join("\n"));
    }
  });
}

test("K10 an Owner-Override carries over a clean base merge, and not over a changed tree entry", async () => {
  assert.deepEqual(await carry(world(), [override(earlier)]), [earlier]);
  assert.deepEqual(await carry(world({ trees: treeOf(head, { mode: "100755" }) }), [override(earlier)]), []);
});

test("K11 a verdict from before the last base change never reaches the carry (F-013)", async () => {
  const old = review(earlier);
  const changedAt = new Date(Date.parse(old.created_at) + 1000).toISOString();
  const cutoff = lastBaseChange([{ event: "base_ref_changed", created_at: changedAt }]);
  const w = world();
  assert.deepEqual(await carry(w, sinceBaseChange([old], cutoff)), []);
  assert.deepEqual(w.calls, []);
});

// K12 (#1396, F-027): a failed tip or tree check keeps the negative of a head
// the walk reached, and carries no PASS, override or merge command.
const BODY = "Agent: claude:a:platforma\nRisk: standard\nTask: B-1\n";
const gateWith = (comments, carriedHeads) => evaluateGate({ body: BODY, headSha: head, ownerLogin, comments, carriedHeads });
const K12_FAILURES = [
  ...FAILING_CALLS.filter(([id]) => !/^K9[bc] /.test(id)).map(([id, fail]) => [id, { fail }]),
  ["K9f truncated tree of the current head", { truncated: [head] }],
  ["K9f truncated tree of the earlier head", { truncated: [earlier] }],
  ["K9g compare without a merge base", { mergeBase: (base, s) => (s === head ? undefined : oldBase) }],
  ["K9h unreadable tip", { tips: ["e".repeat(39)] }],
  ["K9i tree entry with only a path", { trees: allTrees([{ path: "a.mjs" }]) }],
];
for (const [id, knobs] of K12_FAILURES) {
  test(`K12 ${id}: the negative of a reached head stays, and nothing positive carries`, async () => {
    const fail = review(earlier, "FAIL", "c");
    const positives = [review(earlier), override(earlier), command(earlier)];
    const lines = [];
    const kept = await heads(world(knobs), [...positives, fail], lines);
    assert.deepEqual([...kept], [], "nothing carries");
    assert.deepEqual([...(kept.heldNegatives ?? [])], [earlier], lines.join("\n"));
    const current = [review(head), fail];
    assert.equal(gateWith(current, new Set()).state, "success", "control: without the kept head the FAIL is not read");
    const held = gateWith(current, kept);
    assert.equal(held.state, "pending");
    assert.match(held.description, /fail/);

    const onlyPositive = await heads(world(knobs), positives);
    assert.equal(onlyPositive.size, 0);
    assert.notEqual(gateWith(positives, onlyPositive).state, "success");
    const authorization = evaluateMergeAuthorization({
      gate: { state: "success", description: "ok", qaPass: true },
      metadata: { ok: true, risk: "critical", minimumRisk: "critical" },
      paths: ["scripts/engineering/review-gate-api.mjs"],
      comments: positives,
      headSha: head,
      ownerLogin,
      carriedHeads: onlyPositive,
    });
    assert.notEqual(authorization.description, "Owner merge command names this head.");
    assert.equal(
      evaluateMergeAuthorization({
        gate: { state: "success", description: "ok", qaPass: true },
        metadata: { ok: true, risk: "critical", minimumRisk: "critical" },
        paths: ["scripts/engineering/review-gate-api.mjs"],
        comments: positives,
        headSha: head,
        ownerLogin,
        carriedHeads: new Set([earlier]),
      }).description,
      "Owner merge command names this head.",
      "control: a carried head would let the command count",
    );
  });
}
