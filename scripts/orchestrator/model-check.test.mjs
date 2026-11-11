// DAN-695 step 4: tables and properties for the model check, written before the
// code (contract on #1836). Invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { declaredModel, expectedTier, modelOutcome, modelTier, OUTCOMES } from "./model-check.mjs";

const SHA = (c) => c.repeat(40);
const verdict = (kind, head, v, model, over = {}) => {
  const [a, h, r, m] = kind === "review"
    ? ["Agent-Review", "Review-Head", "Review-Verdict", "Review-Model"]
    : ["QA-Agent", "QA-Head", "QA-Verdict", "QA-Model"];
  const line = model === undefined ? "" : `${m}: ${model}\n`;
  return {
    author_association: "OWNER", user: { login: "u" }, created_at: "2026-10-01T10:00:00Z",
    body: `${a}: claude:x\n${h}: ${head}\n${r}: ${v}\n${line}`, ...over,
  };
};

test("modelTier: id, marketing name, other runtimes, empty and ambiguous values", () => {
  const cases = [
    ["claude-opus-5-5", "opus"],
    ["claude-sonnet-5-5[1m]", "sonnet"],
    ["claude-haiku-5-5", "haiku"],
    ["Opus 5.5", "opus"],
    ["SONNET", "sonnet"],
    ["  opus  ", "opus"],
    ["claude-opus-4-8[1m]", "opus"],
    ["Fable 5.2", "other"],
    ["claude-fable-5-2", "other"],
    ["gpt-5-codex", "other"],
    ["Astra", "other"],
    ["opusx", "other"],
    ["magnum-opus", "opus"],
    ["opus or sonnet", "other"],
    ["claude-opus-5-5 (fallback sonnet)", "other"],
    // A Claude tier next to another model family is unclear.
    ["claude-opus-5-5 + gpt-5-codex", "other"],
    ["claude-fable-5-5 opus", "other"],
    // Placeholders name no model: undeclared, not a model outside the table.
    ["n/a", null],
    ["N/A", null],
    ["-", null],
    ["\u2014", null],
    ["unknown", null],
    ["none", null],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
  ];
  for (const [value, tier] of cases) assert.equal(modelTier(value), tier, JSON.stringify(value));
});

const P = {
  sensitive: ["src/domain/sync/drain.ts"],
  sensitiveDb: ["db/migrations/0042_x.sql"],
  rules: ["docs/ORKESTRATOR.md"],
  ruleCard: [".claude/uloge/qa.md"],
  testsOnly: ["tests/unit/a.test.ts", "e2e/b.spec.ts"],
  docsOnly: ["docs/PLAN-DEMO.md", "README.md"],
  mixed: ["src/lib/x.ts", "tests/unit/x.test.ts"],
  plain: ["src/lib/x.ts"],
  empty: [],
};

test("expectedTier: table of risk x role x paths (ORKESTRATOR §7)", () => {
  const O = "opus", S = "sonnet", N = null;
  // [risk, paths, review, qa]
  const table = [
    ["low", "plain", S, N],
    ["low", "sensitive", S, N],
    ["low", "docsOnly", S, N],
    ["low", "testsOnly", S, N],
    ["low", "mixed", S, N],
    ["low", "rules", O, N],
    ["low", "empty", O, N],
    ["standard", "plain", S, N],
    ["standard", "mixed", S, N],
    ["standard", "sensitive", O, N],
    ["standard", "sensitiveDb", O, N],
    ["standard", "rules", O, N],
    ["standard", "testsOnly", S, N],
    ["standard", "docsOnly", S, N],
    ["standard", "empty", O, N],
    ["critical", "plain", O, O],
    ["critical", "mixed", O, O],
    ["critical", "sensitive", O, O],
    ["critical", "testsOnly", S, S],
    ["critical", "docsOnly", S, S],
    ["critical", "rules", O, O],
    ["critical", "ruleCard", O, O],
    ["critical", "empty", O, O],
    [null, "plain", O, O],
    ["unknown", "docsOnly", O, O],
    ["unknown", "sensitive", O, O],
    ["unknown", "rules", O, O],
    ["unknown", "testsOnly", O, O],
    ["unknown", "mixed", O, O],
    [null, "empty", O, O],
  ];
  for (const [risk, key, review, qa] of table) {
    assert.equal(expectedTier("review", risk, P[key]), review, `review ${risk} ${key}`);
    assert.equal(expectedTier("qa", risk, P[key]), qa, `qa ${risk} ${key}`);
  }
  assert.equal(expectedTier("writer", "critical", P.plain), null);
  assert.equal(expectedTier("review", "critical", undefined), "opus");
  assert.equal(expectedTier("review", "standard", ["SRC/Domain/Sync/x.ts"]), "opus");
});

test("modelOutcome: ok, below, undeclared, other, n/a", () => {
  assert.equal(modelOutcome("claude-opus-5-5", "opus"), "ok");
  assert.equal(modelOutcome("claude-opus-5-5", "sonnet"), "ok");
  assert.equal(modelOutcome("claude-sonnet-5-5", "sonnet"), "ok");
  assert.equal(modelOutcome("claude-sonnet-5-5", "opus"), "below");
  assert.equal(modelOutcome("claude-haiku-5-5", "sonnet"), "below");
  assert.equal(modelOutcome(null, "opus"), "undeclared");
  assert.equal(modelOutcome("n/a", "opus"), "undeclared");
  assert.equal(modelOutcome("gpt-5-codex", "opus"), "other");
  assert.equal(modelOutcome("claude-sonnet-5-5", null), "n/a");
  assert.equal(modelOutcome(null, null), "n/a");
});

test("declaredModel reads only a trusted canonical PASS on the merged head", () => {
  const head = SHA("b");
  const found = (comments, kind = "review") => declaredModel(comments, kind, head);
  assert.deepEqual(found([verdict("review", head, "PASS", "claude-opus-5-5")]), { found: true, model: "claude-opus-5-5" });
  assert.deepEqual(found([verdict("review", head, "PASS")]), { found: true, model: null });
  assert.deepEqual(found([verdict("review", head.toUpperCase(), "PASS", "Sonnet")]), { found: true, model: "Sonnet" });
  assert.deepEqual(found([verdict("qa", head, "PASS", "claude-opus-5-5")], "qa"), { found: true, model: "claude-opus-5-5" });
  // Model line on another head, in a FAIL, in an untrusted or non-canonical comment: not read.
  assert.deepEqual(found([verdict("review", SHA("a"), "PASS", "claude-opus-5-5")]), { found: false, model: null });
  assert.deepEqual(found([verdict("review", head, "FAIL", "claude-opus-5-5")]), { found: false, model: null });
  assert.deepEqual(found([verdict("review", head, "PASS", "claude-opus-5-5", { author_association: "NONE" })]), { found: false, model: null });
  const nonCanonical = verdict("review", head, "PASS", "claude-opus-5-5");
  nonCanonical.body = `Note\n${nonCanonical.body}`;
  assert.deepEqual(found([nonCanonical]), { found: false, model: null });
  // A QA model line never answers for review, nor the other way round.
  assert.deepEqual(found([verdict("qa", head, "PASS", "claude-opus-5-5")]), { found: false, model: null });
  // Several PASS on the merged head: the newest one counts.
  const older = verdict("review", head, "PASS", "claude-sonnet-5-5", { created_at: "2026-10-01T09:00:00Z" });
  const newer = verdict("review", head, "PASS", "claude-opus-5-5", { created_at: "2026-10-01T11:00:00Z" });
  assert.deepEqual(found([newer, older]), { found: true, model: "claude-opus-5-5" });
  // A later FAIL from the same identity replaces its PASS, as in the gate: nothing is read.
  const failLater = verdict("qa", head, "FAIL", undefined, { created_at: "2026-10-01T12:00:00Z" });
  assert.deepEqual(found([verdict("qa", head, "PASS", "claude-sonnet-5-5"), failLater], "qa"), { found: false, model: null });
  // Another identity's FAIL on the merged head also means the gate holds no PASS there.
  const otherFail = verdict("review", head, "FAIL", undefined, { body: `Agent-Review: claude:y\nReview-Head: ${head}\nReview-Verdict: FAIL\n` });
  assert.deepEqual(found([verdict("review", head, "PASS", "claude-opus-5-5"), otherFail]), { found: false, model: null });
  assert.deepEqual(declaredModel([verdict("review", head, "PASS", "x")], "review", null), { found: false, model: null });
  assert.deepEqual(declaredModel([verdict("review", head, "PASS", "x")], "review", "abc123"), { found: false, model: null });
});

const RISKS = ["low", "standard", "critical", null, "weird"];
const PATH_POOL = Object.values(P).flat().concat(["docs/x.md", "app/api/y/route.ts", "src/server/db/pool.ts"]);
const arbRisk = fc.constantFrom(...RISKS);
const arbRole = fc.constantFrom("review", "qa");
// At least one path: an empty list means "unknown" and expects Opus, so adding a
// document to it may correctly lower a critical PR to Sonnet.
const arbPaths = fc.array(fc.constantFrom(...PATH_POOL), { minLength: 1, maxLength: 6 });
const RANK = { haiku: 1, sonnet: 2, opus: 3 };

test("property: adding a path never lowers the expected tier", () => {
  fc.assert(fc.property(arbRole, arbRisk, arbPaths, fc.constantFrom(...PATH_POOL), (role, risk, paths, extra) => {
    const before = expectedTier(role, risk, paths);
    const after = expectedTier(role, risk, [...paths, extra]);
    assert.equal(before === null, after === null);
    if (before !== null) assert.ok(RANK[after] >= RANK[before], `${before} -> ${after}`);
  }));
});

test("property: Opus is never below; the outcome is always one of five", () => {
  const arbModel = fc.oneof(
    fc.constantFrom("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "Opus", "gpt-5-codex", "", null),
    fc.string(),
  );
  fc.assert(fc.property(arbRole, arbRisk, fc.array(fc.constantFrom(...PATH_POOL)), arbModel, (role, risk, paths, model) => {
    const expected = expectedTier(role, risk, paths);
    assert.ok(OUTCOMES.includes(modelOutcome(model, expected)));
    if (modelTier(model) === "opus") assert.notEqual(modelOutcome(model, expected), "below");
  }));
});
