// F-046 class table (M0.6d, DAN-178, #1111): the D-101 carry over a clean merge
// of the base branch, through the real `carriedHeads` with a fake GitHub that
// already serves every route the hardened carry reads (branch tip, compare with
// merge base, recursive tree). Invented SHAs only.
//
// Only the classes that already hold on main are here, as regression guards:
// K1 (D-101 still carries), K2 (content), K9b/c (compare errors), K10 (override,
// positive) and K11 (F-013). The remaining classes (K3-K9a, K9d-K9h, K10
// negative) land in this file with the code, after #1396 merges; the table is
// in the contract on #1091 (c.6587871281).
import test from "node:test";
import assert from "node:assert/strict";

import { carriedHeads, createApi } from "./review-gate-api.mjs";
import { lastBaseChange, sinceBaseChange } from "./review-gate-core.mjs";

const sha = (c) => c.repeat(40);
const head = sha("a");
const earlier = sha("b");
const tip = sha("e");
const oldBase = sha("9");
const mainParent = sha("f");
const ownerLogin = "danielrisavi77-create";

let counter = 0;
const at = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();
const review = (s) => ({
  body: `Agent-Review: claude:b:reviewer\nReview-Head: ${s}\nReview-Verdict: PASS\n`,
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

const PATCH = "@@ -1 +1 @@\n-a\n+b";
const change = (over = {}) => ({ filename: "a.mjs", status: "modified", patch: PATCH, sha: sha("1"), ...over });
const entry = (over = {}) => ({ path: "a.mjs", mode: "100644", type: "blob", sha: sha("2"), ...over });

const COMPARE_RE = /\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/;

// head = a merge of main (at `tip`) on top of `earlier`. Every knob defaults to
// a clean D-101 merge: same diff, same tree entries on both heads and bases.
function world({ diff = () => [change()], fail = () => false } = {}) {
  const calls = [];
  const route = (path) => {
    if (/\/branches\/main$/.test(path)) return { name: "main", commit: { sha: tip } };
    if (path.endsWith(`/commits/${head}`)) return { sha: head, parents: [{ sha: earlier }, { sha: mainParent }] };
    if (path.endsWith(`/commits/${earlier}`)) return { sha: earlier, parents: [{ sha: sha("0") }] };
    if (path.includes(`/compare/main...${mainParent}`)) return { status: "behind", files: [] };
    const range = path.match(COMPARE_RE);
    if (range) {
      const [, base, s] = range;
      return { status: "ahead", merge_base_commit: { sha: s === head ? base : oldBase }, files: diff(base, s) };
    }
    const tree = path.match(/\/git\/trees\/([0-9a-f]{40})/);
    if (tree) return { sha: tree[1], truncated: false, tree: [entry()] };
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
  return { api, pr: { head: { sha: head }, base: { sha: tip, ref: "main" } }, calls };
}

const carry = async (w, comments = [review(earlier)], lines = []) =>
  [...(await carriedHeads(w.api, "o", "r", w.pr, comments, { log: (line) => lines.push(line) }))];

test("K1 a clean base merge with the same diff and tree entries carries (D-101)", async () => {
  assert.deepEqual(await carry(world()), [earlier]);
});

test("K2 a different patch in one file carries nothing", async () => {
  const w = world({ diff: (base, s) => [change(s === head ? { patch: "@@ -1 +1 @@\n-a\n+c" } : {})] });
  assert.deepEqual(await carry(w), []);
});

for (const [id, pred] of [
  ["K9b compare for the current head", (path) => COMPARE_RE.test(path) && path.includes(`...${head}`)],
  ["K9c compare for the earlier head", (path) => COMPARE_RE.test(path) && path.includes(`...${earlier}`)],
]) {
  test(`${id}: an error carries nothing and the failing call was reached`, async () => {
    const w = world({ fail: pred });
    const lines = [];
    assert.deepEqual(await carry(w, undefined, lines), []);
    assert.ok(w.calls.some(pred), `not reached:\n${w.calls.join("\n")}`);
    assert.ok(lines.some((line) => /failed closed/.test(line)), lines.join("\n"));
  });
}

test("K10 an Owner-Override carries over a clean base merge like a verdict", async () => {
  assert.deepEqual(await carry(world(), [override(earlier)]), [earlier]);
});

test("K11 a verdict from before the last base change never reaches the carry (F-013)", async () => {
  const old = review(earlier);
  const changedAt = new Date(Date.parse(old.created_at) + 1000).toISOString();
  const cutoff = lastBaseChange([{ event: "base_ref_changed", created_at: changedAt }]);
  const w = world();
  assert.deepEqual(await carry(w, sinceBaseChange([old], cutoff)), []);
  assert.deepEqual(w.calls, []);
});
