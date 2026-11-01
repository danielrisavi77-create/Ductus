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
// Verdicts are posted under the owner's account through an App, as on real PRs.
const comment = (text, { appSlug = "claude", login = ownerLogin, association = "OWNER" } = {}) => ({
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

test("Owner Override on an earlier head does not count unless that head is carried", () => {
  const result = evaluateGate({
    body: body(),
    headSha: head,
    ownerLogin,
    comments: [override(earlier)],
    carriedHeads: new Set(),
  });
  assert.equal(result.state, "pending");
});

// A merge of the base branch: two parents, the second confirmed in the base
// branch by the runner (`mergesBase`, #231 question 1).
const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
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

// Distinct full SHAs that are neither `head` nor `earlier`.
const sha = (i) => (i + 1).toString(16).padStart(40, "0");

test("more verdict heads than the cap carry nothing, so an older FAIL is never dropped", () => {
  // Owner, 26 Oct 2026 (#87 6415952844): 20 heads behind 20 base merges.
  assert.equal(MAX_CARRIED_HEADS, 20);
  const shas = Array.from({ length: MAX_CARRIED_HEADS + 1 }, (_, i) => sha(i));
  // The oldest head holds a FAIL; the newer ones hold PASS verdicts.
  const comments = [review(shas.at(-1), "FAIL"), ...shas.slice(0, -1).map((s) => qa(s))];
  // The walk the runner makes (MAX_MERGE_STEPS + 1 commits) cannot see past
  // the twentieth head, so a twenty-first never carries and its FAIL is not
  // dropped silently: nothing carries at all.
  const walked = [merge(head), ...shas.slice(0, -1).map(merge)];
  assert.equal(walked.length, MAX_MERGE_STEPS + 1);
  const unseen = carriedHeadCandidates(comments, head, walked);
  assert.deepEqual(unseen.heads, []);
  assert.match(unseen.reason, /non-merge/);
  // The cap equals the walk: at most MAX_MERGE_STEPS heads lie behind base
  // merges, so the cap is a second guard that the walk keeps out of reach.
  assert.ok(MAX_CARRIED_HEADS >= MAX_MERGE_STEPS);
  // Twenty verdict heads behind base merges all carry.
  const fewer = shas.slice(0, -1);
  const within = carriedHeadCandidates(comments.slice(1), head, [merge(head), ...fewer.slice(0, -1).map(merge), plain(fewer.at(-1))]);
  assert.equal(within.reason, null);
  assert.equal(within.heads.length, MAX_CARRIED_HEADS);
});

test("a non-merge commit among twenty heads breaks the carry for every head behind it", () => {
  const shas = Array.from({ length: MAX_CARRIED_HEADS }, (_, i) => sha(i));
  const comments = shas.map((s) => review(s));
  // Head 10 is the PR's own new commit, not a base merge.
  const path = [merge(head), ...shas.slice(0, 9).map(merge), plain(shas[9]), ...shas.slice(10, -1).map(merge), plain(shas.at(-1))];
  const { heads, reason } = carriedHeadCandidates(comments, head, path);
  assert.equal(reason, null);
  assert.deepEqual(heads, shas.slice(0, 10));
  assert.equal(onlyBaseMerges(path, shas.at(-1)), false);
  assert.equal(onlyBaseMerges(path, shas[10]), false);
});

test("an unfinished first-parent walk carries nothing", () => {
  const path = Array.from({ length: MAX_MERGE_STEPS + 1 }, (_, i) => merge(i === 1 ? earlier : String(i % 10).repeat(40)));
  // A named head the walk never saw (an older FAIL beyond the step limit)
  // stops every carry, also of the head it did see.
  const unseen = "d".repeat(40);
  const { heads, reason } = carriedHeadCandidates([review(earlier), review(unseen, "FAIL")], head, [merge(head), ...path.slice(1)]);
  assert.deepEqual(heads, []);
  assert.match(reason, /non-merge/);
  // F-148: a walk that stopped after it saw every named head is finished for
  // the carry; nothing named lies beyond it.
  assert.deepEqual(carriedHeadCandidates([review(earlier)], head, [merge(head), merge(earlier)]), { heads: [earlier], reason: null });
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

// #231, question 1 (owner delegated, 12 Oct 2026): only merges of the base
// branch carry, never an octopus and never a merge of another branch, even
// with an identical PR diff (plan 3.2, 3.3, 3.1, 10.1).
test("only a two-parent merge whose second parent is in the base branch allows a carry", () => {
  const other = (sha) => ({ sha, parents: [{}, {}], mergesBase: false });
  const unchecked = (sha) => ({ sha, parents: [{}, {}] });
  const octopus = (sha) => ({ sha, parents: [{}, {}, {}], mergesBase: true });
  assert.equal(onlyBaseMerges([merge(head), plain(earlier)], earlier), true);
  for (const step of [other, unchecked, octopus]) {
    assert.equal(onlyBaseMerges([step(head), plain(earlier)], earlier), false, JSON.stringify(step(head)));
    assert.equal(onlyBaseMerges([merge(head), step("c".repeat(40)), plain(earlier)], earlier), false);
  }
  assert.deepEqual(carriedHeadCandidates([review(earlier)], head, [other(head), plain(earlier)]).heads, []);
  assert.deepEqual(carriedHeadCandidates([review(earlier)], head, [merge(head), plain(earlier)]).heads, [earlier]);
});

// Plan 3.9: the exact boundary of MAX_MERGE_STEPS.
// Owner, 26 Oct 2026 (#87 6415952844): twenty, up from ten.
test("twenty base merges still carry, twenty-one do not", () => {
  const merges = (n) => Array.from({ length: n }, (_, i) => merge(i === 0 ? head : sha(i)));
  assert.equal(MAX_MERGE_STEPS, 20);
  assert.equal(onlyBaseMerges([...merges(20), plain(earlier)], earlier), true);
  assert.equal(onlyBaseMerges([...merges(21), plain(earlier)], earlier), false);
  assert.deepEqual(carriedHeadCandidates([review(earlier)], head, [...merges(20), plain(earlier)]).heads, [earlier]);
  // The runner's walk stops after MAX_MERGE_STEPS + 1 commits: behind 21
  // merges it never reaches a non-merge commit, so nothing carries.
  const { heads, reason } = carriedHeadCandidates([review(earlier)], head, merges(21));
  assert.deepEqual(heads, []);
  assert.match(reason, /non-merge/);
});

// #231, question 4 (owner delegated, 12 Oct 2026), plan 5.4: a FAIL or BLOCK
// on the current head is never lifted by a later PASS of the same principal on
// a carried head.
test("a verdict on the current head beats a later carried verdict of the same principal", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    const comments = [review(head, verdict), review(earlier, "PASS"), qa(head)];
    const result = evaluateGate({ body: body("critical"), headSha: head, comments, ownerLogin, carriedHeads: new Set([earlier]) });
    assert.equal(result.state, "pending", verdict);
    assert.match(result.description, new RegExp(verdict.toLowerCase()), verdict);
  }
  // F-023 (owner decision 31. 10. 2026.): a later PASS on the current head no
  // longer replaces an older current FAIL of the same principal.
  const held = evaluateGate({
    body: body("critical"),
    headSha: head,
    comments: [review(head, "FAIL"), review(head, "PASS"), qa(head)],
    ownerLogin,
    carriedHeads: new Set([earlier]),
  });
  assert.equal(held.state, "pending");
  // Owner decision 16 Oct 2026 (review 6217017710): a later FAIL or BLOCK of
  // the same principal on a carried head still blocks an older current PASS.
  for (const verdict of ["FAIL", "BLOCK"]) {
    const later = evaluateGate({
      body: body("critical"),
      headSha: head,
      comments: [review(head, "PASS"), review(earlier, verdict), qa(head)],
      ownerLogin,
      carriedHeads: new Set([earlier]),
    });
    assert.equal(later.state, "pending", `PASS(current) then ${verdict}(carried)`);
    assert.match(later.description, new RegExp(verdict.toLowerCase()), verdict);
    // An older carried FAIL or BLOCK is replaced by a later current PASS.
    const replaced = evaluateGate({
      body: body("critical"),
      headSha: head,
      comments: [review(earlier, verdict), review(head, "PASS"), qa(head)],
      ownerLogin,
      carriedHeads: new Set([earlier]),
    });
    assert.equal(replaced.state, "success", `${verdict}(carried) then PASS(current)`);
  }
  // Review 6217178508 (eaaa2ab): an intermediate carried FAIL or BLOCK must
  // not make the current FAIL or BLOCK disappear before a later carried PASS.
  for (const currentVerdict of ["FAIL", "BLOCK"]) {
    for (const middle of ["FAIL", "BLOCK"]) {
      const result = evaluateGate({
        body: body("critical"),
        headSha: head,
        comments: [review(head, currentVerdict), review(earlier, middle), review(earlier, "PASS"), qa(head)],
        ownerLogin,
        carriedHeads: new Set([earlier]),
      });
      assert.equal(result.state, "pending", `${currentVerdict}(current), ${middle}(carried), PASS(carried)`);
    }
    // F-023: a PASS on the same current head no longer clears it; a PASS on a
    // new head after the carried negatives does.
    const sameHead = evaluateGate({
      body: body("critical"),
      headSha: head,
      comments: [review(head, currentVerdict), review(earlier, currentVerdict), review(head, "PASS"), qa(head)],
      ownerLogin,
      carriedHeads: new Set([earlier]),
    });
    assert.equal(sameHead.state, "pending", `${currentVerdict} then PASS on the same current head`);
    const newHead = evaluateGate({
      body: body("critical"),
      headSha: head,
      comments: [review(earlier, currentVerdict), review(head, "PASS"), qa(head)],
      ownerLogin,
      carriedHeads: new Set([earlier]),
    });
    assert.equal(newHead.state, "success", `${currentVerdict} then PASS on a new head`);
  }
  // A carried PASS still counts when the principal has nothing on the current head.
  const carried = evaluateGate({ body: body("critical"), headSha: head, comments: [review(earlier), qa(head)], ownerLogin, carriedHeads: new Set([earlier]) });
  assert.equal(carried.state, "success");
  // Review of #1155 (F-023-R1): a later PASS of the same principal on another
  // carried head does not lift its FAIL or BLOCK on a carried head either. All
  // carried heads carry the same PR diff, so none of them is a new push.
  const older = "c".repeat(40);
  for (const verdict of ["FAIL", "BLOCK"]) {
    for (const [negativeOn, passOn] of [[earlier, older], [older, earlier]]) {
      const result = evaluateGate({
        body: body("critical"),
        headSha: head,
        comments: [review(negativeOn, verdict), review(passOn, "PASS"), qa(head)],
        ownerLogin,
        carriedHeads: new Set([earlier, older]),
      });
      assert.equal(result.state, "pending", `${verdict} on ${negativeOn.slice(0, 1)}, then PASS on ${passOn.slice(0, 1)}`);
    }
    // Control: a PASS on the current head after the carried negative lifts it.
    const current = evaluateGate({
      body: body("critical"),
      headSha: head,
      comments: [review(older, verdict), review(earlier, "PASS"), review(head, "PASS"), qa(head)],
      ownerLogin,
      carriedHeads: new Set([earlier, older]),
    });
    assert.equal(current.state, "success", `${verdict} carried, then PASS on the current head`);
  }
});
