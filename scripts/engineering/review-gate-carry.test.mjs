import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CARRIED_HEADS,
  MAX_MERGE_STEPS,
  carriedByCompare,
  carriedHeadCandidates,
  evaluateGate,
  evaluatePullRequest,
  onlyBaseMerges,
  sameChange,
} from "./review-gate-core.mjs";

const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const body = (risk = "standard") => `Agent: claude:a:backend\nRisk: ${risk}\nTask: B-1\n`;

let counter = 0;
const comment = (text, { appSlug = "claude", login = "claude[bot]", association = "COLLABORATOR" } = {}) => ({
  body: text,
  user: { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const review = (sha, verdict = "PASS") =>
  comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`);
const qa = (sha, verdict = "PASS") =>
  comment(`QA-Agent: chatgpt:c:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: offline\n`, {
    appSlug: "chatgpt-codex-connector",
    login: "chatgpt-codex-connector[bot]",
  });
const override = (sha) =>
  comment(`Owner-Override: PASS\nOverride-Head: ${sha}\nOverride-Reason: demo\n`, {
    appSlug: null,
    login: ownerLogin,
    association: "OWNER",
  });

const file = (filename, patch = "@@ -1 +1 @@\n-a\n+b") => ({ filename, status: "modified", patch, sha: "1".repeat(40) });

test("verdicts on a carried earlier head count for the current head", () => {
  const comments = [review(earlier), qa(earlier)];
  const carried = evaluateGate({ body: body("critical"), headSha: head, ownerLogin, comments, carriedHeads: new Set([earlier]) });
  assert.equal(carried.state, "success");
  const strict = evaluateGate({ body: body("critical"), headSha: head, ownerLogin, comments });
  assert.equal(strict.state, "pending");
});

test("a carried FAIL holds the gate like a current one", () => {
  const result = evaluateGate({
    body: body(),
    headSha: head,
    ownerLogin,
    comments: [review(earlier, "FAIL")],
    carriedHeads: new Set([earlier]),
  });
  assert.equal(result.state, "pending");
  assert.match(result.description, /fail/);
});

test("Owner Override never carries to a later head", () => {
  const result = evaluateGate({
    body: body(),
    headSha: head,
    ownerLogin,
    comments: [override(earlier)],
    carriedHeads: new Set([earlier]),
  });
  assert.equal(result.state, "pending");
});

const merge = (sha) => ({ sha, parents: [{}, {}] });
const plain = (sha) => ({ sha, parents: [{}] });

test("candidates are trusted canonical heads behind base merges, in walk order, without the current head", () => {
  const outsider = comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${"c".repeat(40)}\nReview-Verdict: PASS\n`, {
    association: "NONE",
  });
  const fenced = comment(`\`\`\`\nAgent-Review: claude:b:reviewer\nReview-Head: ${"d".repeat(40)}\nReview-Verdict: PASS\n\`\`\`\n`);
  const path = [merge(head), merge("c".repeat(40)), merge("d".repeat(40)), merge("e".repeat(40)), plain(earlier)];
  const { heads, reason } = carriedHeadCandidates(
    [review(earlier), outsider, fenced, qa(head), review("E".repeat(40)), qa(earlier)],
    head,
    path,
  );
  assert.equal(reason, null);
  assert.deepEqual(heads, ["e".repeat(40), earlier]);
});

test("a head behind a non-merge commit is not a candidate", () => {
  const path = [merge(head), plain("c".repeat(40))];
  const { heads } = carriedHeadCandidates([review(earlier), review("c".repeat(40))], head, path);
  assert.deepEqual(heads, ["c".repeat(40)]);
  assert.deepEqual(carriedHeadCandidates([review(earlier)], head, [plain(head)]).heads, []);
});

test("more verdict heads than the cap carry nothing, so an older FAIL is never dropped", () => {
  const shas = Array.from({ length: MAX_CARRIED_HEADS + 1 }, (_, i) => String(i + 1).repeat(40));
  const path = [merge(head), ...shas.slice(0, -1).map(merge), plain(shas.at(-1))];
  // The oldest head holds a FAIL; the newer ones hold PASS verdicts.
  const comments = [review(shas.at(-1), "FAIL"), ...shas.slice(0, -1).map((sha) => qa(sha))];
  const { heads, reason } = carriedHeadCandidates(comments, head, path);
  assert.deepEqual(heads, []);
  assert.match(reason, /more than 5/);
  const fewer = shas.slice(0, -1);
  const within = carriedHeadCandidates(comments.slice(1), head, [merge(head), ...fewer.slice(0, -1).map(merge), plain(fewer.at(-1))]);
  assert.equal(within.heads.length, MAX_CARRIED_HEADS);
});

test("an unfinished first-parent walk carries nothing", () => {
  const path = Array.from({ length: MAX_MERGE_STEPS + 1 }, (_, i) => merge(i === 1 ? earlier : String(i % 10).repeat(40)));
  const { heads, reason } = carriedHeadCandidates([review(earlier)], head, [merge(head), ...path.slice(1)]);
  assert.deepEqual(heads, []);
  assert.match(reason, /non-merge/);
  assert.deepEqual(carriedHeadCandidates([], head, []), { heads: [], reason: null });
});

test("only merge commits on the first-parent path allow a carry", () => {
  assert.equal(onlyBaseMerges([merge(head), merge("c".repeat(40)), plain(earlier)], earlier), true);
  assert.equal(onlyBaseMerges([merge(head), plain("c".repeat(40)), plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges([plain(head), plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges([merge(head), merge("c".repeat(40))], earlier), false);
  assert.equal(onlyBaseMerges([plain(earlier)], earlier), false);
  const long = Array.from({ length: MAX_MERGE_STEPS + 1 }, (_, i) => merge(String(i % 10).repeat(40)));
  assert.equal(onlyBaseMerges([...long, plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges(undefined, earlier), false);
});

test("the PR diff must be identical file by file", () => {
  const current = { files: [file("a.mjs"), file("b.md")] };
  assert.equal(sameChange(current, { files: [file("b.md"), file("a.mjs")] }), true);
  assert.equal(sameChange(current, { files: [file("a.mjs"), file("b.md", "@@ -1 +1 @@\n-a\n+c")] }), false);
  assert.equal(sameChange(current, { files: [file("a.mjs")] }), false);
  assert.equal(sameChange({ files: [] }, { files: [] }), false);
  const big = { files: Array.from({ length: 300 }, (_, i) => file(`f${i}`)) };
  assert.equal(sameChange(big, big), false);
});

test("a file without a patch never carries", () => {
  const binary = (sha) => ({ filename: "x.png", status: "modified", sha });
  assert.equal(sameChange({ files: [binary("1".repeat(40))] }, { files: [binary("1".repeat(40))] }), false);
  assert.equal(sameChange({ files: [file("a.mjs"), binary("1".repeat(40))] }, { files: [file("a.mjs"), binary("1".repeat(40))] }), false);
  const renamed = { filename: "b.png", previous_filename: "a.png", status: "renamed", sha: "1".repeat(40) };
  assert.equal(sameChange({ files: [renamed] }, { files: [renamed] }), false);
});

test("a merge that changes the base side of the PR's hunk does not carry", () => {
  // Same head side, different base side: the PR now undoes a newer base change.
  const before = { files: [file("a.mjs", "@@ -1 +1 @@\n-a\n+b")] };
  const after = { files: [file("a.mjs", "@@ -1 +1 @@\n-c\n+b")] };
  assert.equal(sameChange(after, before), false);
});

test("an error on any compare carries nothing, so an older FAIL is never dropped", async () => {
  const current = { files: [file("a.mjs")] };
  const pass = "c".repeat(40);
  const ok = async () => current;
  assert.deepEqual([...(await carriedByCompare([pass, earlier], current, ok))], [pass, earlier]);
  for (const failing of [pass, earlier]) {
    const flaky = async (sha) => {
      if (sha === failing) throw new Error("502");
      return current;
    };
    assert.equal((await carriedByCompare([pass, earlier], current, flaky)).size, 0);
  }
  const differs = async (sha) => (sha === pass ? current : { files: [file("a.mjs", "@@ -1 +1 @@\n-a\n+c")] });
  assert.deepEqual([...(await carriedByCompare([pass, earlier], current, differs))], [pass]);
});

test("a success that counts a carried verdict names the earlier head", () => {
  const comments = [review(earlier), qa(head)];
  const result = evaluateGate({ body: body("critical"), headSha: head, ownerLogin, comments, carriedHeads: new Set([earlier]) });
  assert.equal(result.state, "success");
  assert.match(result.description, /Carried from bbbbbbb\.$/);
  const current = evaluateGate({ body: body(), headSha: head, ownerLogin, comments: [review(head)] });
  assert.doesNotMatch(current.description, /Carried/);
});

test("evaluatePullRequest passes carried heads to the gate", () => {
  const pr = { body: body(), head: { sha: head }, changed_files: 1, auto_merge: null };
  const files = [{ filename: "apps/web/a.ts", status: "modified" }];
  const comments = [review(earlier)];
  const carried = evaluatePullRequest({ pr, files, comments, ownerLogin, carriedHeads: new Set([earlier]) });
  assert.equal(carried.result.state, "success");
  const strict = evaluatePullRequest({ pr, files, comments, ownerLogin });
  assert.equal(strict.result.state, "pending");
});
