// DAN-372, plan #1173 A1, A2, A4: a decision file in docs/odluke/ gets the same
// outcome as docs/DECISIONS.md in every consumer of D97_MANUAL_PATHS. The
// existing asserts for docs/DECISIONS.md stay where they are; this table adds
// the decision files next to them.
import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMetadata, minimumRisk } from "./pr-metadata-core.mjs";
import {
  changedPaths,
  isLowDocExemptPath,
  isNewTestExempt,
  isOwnerFreePath,
  lowReviewExempt,
  ownerCommandPaths,
  ownerFreeCritical,
} from "./protected-paths.mjs";
import { evaluatePullRequest } from "./review-gate-core.mjs";
import { d97ManualMatches, evaluateReady } from "../orchestrator/orchestrator-core.mjs";

const head = "c".repeat(40);
const body = (risk) => `Agent: claude:ob372:platforma\nRisk: ${risk}\nTask: DAN-372\n`;
// The same comment shape as the whole-PR decision in risk-floor.test.mjs.
const comment = (text, slug, n) => ({
  body: text,
  user: { login: "owner-x" },
  author_association: "OWNER",
  performed_via_github_app: { slug },
  created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
});
const passes = [
  comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, "claude", 1),
  comment(`QA-Agent: chatgpt:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: negative paths\n`, "chatgpt-codex-connector", 2),
];
const gate = (files, autoMerge) =>
  evaluatePullRequest({
    pr: { body: body("critical"), head: { sha: head }, auto_merge: autoMerge ? { merge_method: "squash" } : null, changed_files: files.length },
    files,
    comments: passes,
    ownerLogin: "owner-x",
  }).result;
const manualRow = (files) =>
  evaluateReady({ gate: { state: "success" }, rollup: [], head, base: "main", files }).find((r) => r.id === "d97-manual");

/** Every consumer, for one PR file list (REST shape). */
function outcomes(list) {
  const paths = changedPaths(list);
  return {
    owner: ownerCommandPaths(paths).length > 0,
    floor: minimumRisk(paths).risk,
    record: minimumRisk(paths).labels.includes("decision record, D-97 by content"),
    low: evaluateMetadata({ body: body("low"), files: paths }).ok,
    lowExempt: lowReviewExempt(paths),
    ownerFree: ownerFreeCritical(paths),
    newTestExempt: paths.some(isNewTestExempt),
    autoMergeHeld: gate(list, true).state === "pending" && gate(list, false).state === "success",
    orchestrator: d97ManualMatches(paths).length > 0 && Boolean(manualRow(paths)),
  };
}
const HELD = { owner: true, floor: "standard", record: true, low: false, lowExempt: false, ownerFree: false, newTestExempt: false, autoMergeHeld: true, orchestrator: true };

test("A1: a decision file is held like docs/DECISIONS.md, for a change, an addition and a deletion", () => {
  assert.deepEqual(outcomes([{ filename: "docs/DECISIONS.md", status: "modified" }]), HELD);
  for (const status of ["modified", "added", "removed"]) {
    assert.deepEqual(outcomes([{ filename: "docs/odluke/D-05.md", status }]), HELD, status);
  }
});

test("A4: a rename out of docs/odluke/ counts under both names", () => {
  const renamed = [{ filename: "docs/x.md", previous_filename: "docs/odluke/D-97.md", status: "renamed" }];
  assert.deepEqual(changedPaths(renamed), ["docs/odluke/D-97.md", "docs/x.md"]);
  assert.deepEqual(outcomes(renamed), HELD);
});

test("A2: every spelling of a decision file is held; the neighbours are not decision files", () => {
  for (const filename of [
    "docs/Odluke/D-05.md",
    "DOCS/ODLUKE/d-05.md",
    "docs\\odluke\\D-05.md",
    "./docs/odluke/D-05.md",
    "docs//odluke/D-05.md",
    "docs/odluke/sub/D-05.md",
    "docs/odluke/README.md",
    "docs/odluke/x.json",
  ]) {
    const got = outcomes([{ filename, status: "modified" }]);
    assert.equal(got.owner, true, filename);
    assert.equal(got.floor, "standard", filename);
    assert.equal(got.low, false, filename);
    assert.equal(got.lowExempt, false, filename);
    assert.equal(got.ownerFree, false, filename);
    assert.equal(isOwnerFreePath(filename), false, filename);
    assert.equal(got.orchestrator, true, filename);
  }
  // docs/odluke.md is an ordinary low document directly in docs/ (D-189); a
  // decision written there fails the index check instead (decisions-index A3).
  assert.equal(isLowDocExemptPath("docs/odluke.md"), true);
  assert.equal(ownerCommandPaths(["docs/odluke.md"]).length, 0);
  // docs/odluke2/ is neither a decision directory nor a low document.
  assert.equal(ownerCommandPaths(["docs/odluke2/x.md"]).length, 0);
  assert.equal(isLowDocExemptPath("docs/odluke2/x.md"), false);
  assert.equal(minimumRisk(["docs/odluke2/x.md"]).risk, "low");
});
