// F-165: a commit status belongs to the head, not to the PR, so the gate grants
// green statuses only for a PR that targets the default branch, and "Auto-merge
// eligible" only when no other open PR shares that head. The runner wiring is
// tested in review-gate-runner.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";

import { sharesHeadWithOpenPr, targetsDefaultBranch } from "./review-gate-core.mjs";

const HEAD = "a".repeat(40);
const pr = (base) => ({ number: 7, head: { sha: HEAD }, base });

test("only a PR whose base is the repository's default branch targets it (F-165)", () => {
  assert.equal(targetsDefaultBranch(pr({ ref: "main", repo: { default_branch: "main" } })), true);
  for (const base of [
    { ref: "feature", repo: { default_branch: "main" } },
    { ref: "main", repo: { default_branch: "trunk" } },
    { ref: "main", repo: {} },
    { ref: "main" },
    { repo: { default_branch: "main" } },
    { ref: "", repo: { default_branch: "" } },
    {},
    undefined,
  ]) {
    assert.equal(targetsDefaultBranch(pr(base)), false, JSON.stringify(base));
  }
  assert.equal(targetsDefaultBranch(undefined), false);
});

test("another open PR on the same head is found; the PR itself and other heads are not (F-165)", () => {
  const self = pr({ ref: "main" });
  assert.equal(sharesHeadWithOpenPr(self, []), false);
  assert.equal(sharesHeadWithOpenPr(self, [{ number: 7, head: { sha: HEAD } }]), false);
  assert.equal(sharesHeadWithOpenPr(self, [{ number: 8, head: { sha: "b".repeat(40) } }]), false);
  assert.equal(sharesHeadWithOpenPr(self, [{ number: 7, head: { sha: HEAD } }, { number: 8, head: { sha: HEAD } }]), true);
  assert.equal(sharesHeadWithOpenPr(self, [{ number: 9, head: { sha: HEAD.toUpperCase() } }]), true);
});

test("an unread list of open PRs fails closed (F-165)", () => {
  for (const list of [undefined, null, {}, "x"]) {
    assert.equal(sharesHeadWithOpenPr(pr({ ref: "main" }), list), true, String(list));
  }
});
