import assert from "node:assert/strict";
import test from "node:test";

import { checkQueue, queueItems } from "./health-core.mjs";
import { latestVerdict } from "./orchestrator-core.mjs";

// #130: the gate keys a slot without letter case; the orchestrator tools must
// count what the gate counts.
const H = "9".repeat(40);
const NOW = Date.parse("2026-10-10T12:00:00Z");
const at = (min) => new Date(NOW - min * 60000).toISOString();
const comment = (body, over = {}) => ({
  body,
  author_association: "OWNER",
  user: { login: "x" },
  created_at: at(5),
  performed_via_github_app: { slug: "claude" },
  ...over,
});

test("latestVerdict: claude:b and claude:B are one identity, so the newer verdict counts (#130)", () => {
  const rv = (slot, verdict, min) =>
    comment(`Agent-Review: claude:${slot}:reviewer\nReview-Head: ${H}\nReview-Verdict: ${verdict}`, { created_at: at(min) });
  assert.equal(latestVerdict([rv("b", "FAIL", 60), rv("B", "PASS", 30)], "review", H).verdict, "PASS");
});

test("queue: a verdict clears the item whatever the letter case of its slot (#130)", () => {
  const queue = comment(
    `RED ZA REVIEW (claude:a:orchestrator)\n\n- **#189** (\`critical\`) head \`${H}\` → \`claude:reviewC\`.`,
    { created_at: at(200), performed_via_github_app: null },
  );
  const items = queueItems([queue]).filter((i) => i.number === 189);
  assert.deepEqual(items.map((i) => i.slots), [["claude:reviewC"]]);
  const prs = [{ number: 189, state: "OPEN", isDraft: false, headRefOid: H, headRefName: "x" }];
  const v = (agent) => comment(`Agent-Review: ${agent}\nReview-Head: ${H}\nReview-Verdict: PASS`, { created_at: at(10) });
  const run = (list) => checkQueue({ queue: items, prs, comments: new Map([[189, list]]), now: NOW }).map((x) => x.level);
  assert.equal(run([v("claude:reviewC:reviewer")])[0], "PASS");
  assert.equal(run([v("claude:REVIEWC:reviewer")])[0], "PASS");
  assert.equal(run([v("claude:reviewb:reviewer")])[0], "FAIL");
});
