import assert from "node:assert/strict";
import test from "node:test";

import { canonicalVerdicts, latestOnHead } from "./health-core.mjs";
import { latestVerdict } from "./orchestrator-core.mjs";

// #129: the orchestrator tools order verdicts by the time of the last edit,
// as the gate does.
const H = "9".repeat(40);
const comment = (verdict, created, updated) => ({
  body: `Agent-Review: claude:b:reviewer\nReview-Head: ${H}\nReview-Verdict: ${verdict}`,
  author_association: "OWNER",
  user: { login: "x" },
  performed_via_github_app: { slug: "claude" },
  created_at: created,
  ...(updated ? { updated_at: updated } : {}),
});
// An older comment rewritten to FAIL after the PASS was written.
const comments = [
  comment("FAIL", "2026-10-10T10:00:00Z", "2026-10-10T12:00:00Z"),
  comment("PASS", "2026-10-10T11:00:00Z"),
];

test("latestVerdict: the verdict edited last is the principal's newest (#129)", () => {
  assert.equal(latestVerdict(comments, "review", H).verdict, "FAIL");
});

test("orch:health: the verdict edited last is the principal's newest (#129)", () => {
  assert.deepEqual(latestOnHead(canonicalVerdicts(comments), H).map((v) => v.verdict), ["FAIL"]);
});
