import assert from "node:assert/strict";
import test from "node:test";

import { evaluateGate } from "../engineering/review-gate-core.mjs";
import { overrideBlock, parseOverrideArgs } from "./orchestrator-core.mjs";

const head = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const gate = (body, headSha = head) => evaluateGate({
  ownerLogin,
  headSha,
  body: "Agent: claude:a:platforma\nRisk: critical\nTask: WF-1\n",
  comments: [{
    body,
    user: { login: ownerLogin },
    author_association: "OWNER",
    performed_via_github_app: null,
    created_at: "2026-10-10T00:00:00Z",
  }],
});

test("the printed block is what the engineering gate accepts, for that head only", () => {
  const block = overrideBlock(head, "demo blocker, review quota exhausted");
  assert.equal(block, `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: demo blocker, review quota exhausted\n`);
  assert.equal(gate(block).state, "success");
  assert.equal(gate(block, "c".repeat(40)).state, "pending");
  assert.throws(() => overrideBlock("abc123", "x"), /full head SHA/);
  assert.throws(() => overrideBlock(undefined, "x"), /full head SHA/);
});

test("override arguments: PR numbers, a required one-line reason", () => {
  assert.deepEqual(parseOverrideArgs(["173", "#198", "173", "--reason", " quota\n  out "]), { nums: [173, 198], reason: "quota out" });
  for (const bad of [["173"], ["--reason", "x"], ["173", "--reason", "  "], ["173", "--reason"], ["0", "--reason", "x"], ["x1", "--reason", "x"]]) {
    assert.throws(() => parseOverrideArgs(bad), /usage|unknown argument/, JSON.stringify(bad));
  }
});
