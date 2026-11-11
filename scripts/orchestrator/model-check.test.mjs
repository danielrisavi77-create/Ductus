// DAN-695 step 4: tables and properties for the model check, written before the
// code (contract on #1836). Invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { checkRole, declaredModel, expectedTier, modelOutcome, modelTier, OUTCOMES } from "./model-check.mjs";

const SHA = (c) => c.repeat(40);
// A verdict as the gate counts it: owner account, posted through the Claude App,
// a valid reviewer or QA slot, QA with its scope. `over` replaces any field.
const verdict = (kind, head, v, model, over = {}) => {
  const [a, h, r, m, role] = kind === "review"
    ? ["Agent-Review", "Review-Head", "Review-Verdict", "Review-Model", "reviewer"]
    : ["QA-Agent", "QA-Head", "QA-Verdict", "QA-Model", "qa"];
  const line = model === undefined ? "" : `${m}: ${model}\n`;
  const scope = kind === "qa" ? "QA-Scope: full\n" : "";
  const slot = over.slot ?? "x";
  const rest = { ...over };
  delete rest.slot;
  return {
    author_association: "OWNER", user: { login: "u", type: "User" }, performed_via_github_app: { slug: "claude" },
    created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
    body: `${a}: claude:${slot}:${role}\n${h}: ${head}\n${r}: ${v}\n${scope}${line}`, ...rest,
  };
};
const OWNER = { ownerLogin: "u", authorAgent: "claude:w:platforma" };

test("modelTier: allowlist of Claude forms; anything else is other", () => {
  // Input classes (contract on #1836): [class, value, tier]
  const cases = [
    ["id", "claude-opus-5-5", "opus"],
    ["id", "claude-haiku-5-5", "haiku"],
    ["id with context suffix", "claude-sonnet-5-5[1m]", "sonnet"],
    ["id with context suffix", "claude-opus-4-8[1m]", "opus"],
    ["id with date", "claude-sonnet-4-5-20250929", "sonnet"],
    ["old id form", "claude-3-5-sonnet-20241022", "sonnet"],
    ["old id form", "claude-3-opus", "opus"],
    ["name", "Opus 5.5", "opus"],
    ["name", "Claude Sonnet 5.5", "sonnet"],
    ["bare tier", "SONNET", "sonnet"],
    ["bare tier, spaces", "  opus  ", "opus"],
    ["other family", "Fable 5.2", "other"],
    ["other family", "claude-fable-5-2", "other"],
    ["other family", "gpt-5-codex", "other"],
    ["unknown name", "Astra", "other"],
    ["tier inside a word", "opusx", "other"],
    ["tier inside a word", "magnum-opus", "other"],
    ["two tiers", "opus or sonnet", "other"],
    ["note after the id", "claude-opus-5-5 (fallback sonnet)", "other"],
    // Finding (2) of cxcr1946: a tier mixed with any other name is unclear,
    // whether or not that name is a known family.
    ["mixed, unknown family", "claude-opus-5-5 + Astra", "other"],
    ["mixed, unknown family", "Opus + Nova", "other"],
    ["mixed, known family", "claude-opus-5-5 + gpt-5-codex", "other"],
    ["mixed, known family", "claude-fable-5-5 opus", "other"],
    ["id and name together", "claude-opus-5-5 / Opus 5.5", "other"],
    ["two lines", "claude-opus-5-5\nAstra", "other"],
    // Placeholders name no model: undeclared, not a model outside the table.
    ["placeholder", "n/a", null],
    ["placeholder", "N/A", null],
    ["placeholder", "-", null],
    ["placeholder", "\u2014", null],
    ["placeholder", "unknown", null],
    ["placeholder", "none", null],
    ["empty", "", null],
    ["empty", "   ", null],
    ["missing", null, null],
    ["missing", undefined, null],
  ];
  for (const [kind, value, tier] of cases) assert.equal(modelTier(value), tier, `${kind}: ${JSON.stringify(value)}`);
});

test("property: an allowed form followed by any other word is other", () => {
  const allowed = fc.constantFrom("claude-opus-5-5", "claude-sonnet-5-5[1m]", "Opus 5.5", "haiku");
  const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9.-]{0,11}$/);
  const sep = fc.constantFrom(" ", " + ", ", ", " / ", " & ");
  fc.assert(fc.property(allowed, sep, word, (model, s, extra) => {
    // A trailing version number is part of the name form ("Opus 5.5").
    fc.pre(!/^\d/.test(extra));
    assert.equal(modelTier(`${model}${s}${extra}`), "other", `${model}${s}${extra}`);
  }));
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

test("declaredModel counts only a PASS the gate counts on the merged head", () => {
  const head = SHA("b");
  const found = (comments, kind = "review", ctx = OWNER) => declaredModel(comments, kind, head, ctx);
  const none = { found: false, model: null };
  const at = (t) => ({ created_at: `2026-10-01T${t}:00Z`, updated_at: `2026-10-01T${t}:00Z` });
  // [class, comments, kind, expected]
  const table = [
    ["App PASS", [verdict("review", head, "PASS", "claude-opus-5-5")], "review", { found: true, model: "claude-opus-5-5" }],
    ["App PASS without a model line", [verdict("review", head, "PASS")], "review", { found: true, model: null }],
    ["head in upper case", [verdict("review", head.toUpperCase(), "PASS", "Sonnet")], "review", { found: true, model: "Sonnet" }],
    ["QA App PASS", [verdict("qa", head, "PASS", "claude-opus-5-5")], "qa", { found: true, model: "claude-opus-5-5" }],
    ["QA PASS without QA-Scope", [verdict("qa", head, "PASS", "claude-opus-5-5", {
      body: `QA-Agent: claude:x:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Model: claude-opus-5-5\n` })], "qa", none],
    ["CLI channel of the owner", [verdict("review", head, "PASS", "gpt-5-codex", {
      performed_via_github_app: null,
      body: `Agent-Review: codex:c:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\nReview-Model: gpt-5-codex\nReview-Channel: codex-cli\n` })],
    "review", { found: true, model: "gpt-5-codex" }],
    ["owner comment without App or CLI line", [verdict("review", head, "PASS", "claude-opus-5-5", { performed_via_github_app: null })], "review", none],
    ["App that does not run the declared runtime", [verdict("review", head, "PASS", "claude-opus-5-5", { performed_via_github_app: { slug: "grok-by-xai" } })], "review", none],
    ["agent without a reviewer role", [verdict("review", head, "PASS", "claude-opus-5-5", {
      body: `Agent-Review: claude:x\nReview-Head: ${head}\nReview-Verdict: PASS\nReview-Model: claude-opus-5-5\n` })], "review", none],
    // Finding (1) of cxcr1946, F-012: an edited PASS is never counted.
    ["edited PASS", [verdict("review", head, "PASS", "claude-opus-5-5", { updated_at: "2026-10-01T10:05:00Z" })], "review", none],
    ["edited PASS, then a new PASS of the same slot", [
      verdict("review", head, "PASS", "claude-sonnet-5-5", { updated_at: "2026-10-01T10:05:00Z" }),
      verdict("review", head, "PASS", "claude-opus-5-5", at("11:00")),
    ], "review", { found: true, model: "claude-opus-5-5" }],
    ["author's own PASS", [verdict("review", head, "PASS", "claude-opus-5-5", { slot: "w" })], "review", none],
    ["untrusted author", [verdict("review", head, "PASS", "claude-opus-5-5", { author_association: "NONE" })], "review", none],
    ["bot account", [verdict("review", head, "PASS", "claude-opus-5-5", { user: { login: "b[bot]", type: "Bot" } })], "review", none],
    ["another head", [verdict("review", SHA("a"), "PASS", "claude-opus-5-5")], "review", none],
    ["FAIL", [verdict("review", head, "FAIL", "claude-opus-5-5")], "review", none],
    ["QA line does not answer for review", [verdict("qa", head, "PASS", "claude-opus-5-5")], "review", none],
    ["review line does not answer for QA", [verdict("review", head, "PASS", "claude-opus-5-5")], "qa", none],
    ["several PASS: the newest counts", [
      verdict("review", head, "PASS", "claude-opus-5-5", { ...at("11:00"), slot: "y" }),
      verdict("review", head, "PASS", "claude-sonnet-5-5", at("09:00")),
    ], "review", { found: true, model: "claude-opus-5-5" }],
    ["PASS then FAIL of the same slot", [
      verdict("qa", head, "PASS", "claude-sonnet-5-5"),
      verdict("qa", head, "FAIL", undefined, at("12:00")),
    ], "qa", none],
    ["FAIL then PASS of the same slot (F-023)", [
      verdict("qa", head, "FAIL", undefined, at("09:00")),
      verdict("qa", head, "PASS", "claude-opus-5-5"),
    ], "qa", none],
    ["another slot's FAIL", [
      verdict("review", head, "PASS", "claude-opus-5-5"),
      verdict("review", head, "FAIL", undefined, { ...at("11:00"), slot: "y" }),
    ], "review", none],
  ];
  for (const [kind, comments, role, expected] of table) assert.deepEqual(found(comments, role), expected, kind);

  const nonCanonical = verdict("review", head, "PASS", "claude-opus-5-5");
  nonCanonical.body = `Note\n${nonCanonical.body}`;
  assert.deepEqual(found([nonCanonical]), none, "non-canonical block");
  // Without the owner's login no CLI comment is authenticated.
  const cli = verdict("review", head, "PASS", "gpt-5-codex", {
    performed_via_github_app: null,
    body: `Agent-Review: codex:c:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\nReview-Model: gpt-5-codex\nReview-Channel: codex-cli\n` });
  assert.deepEqual(found([cli], "review", { ...OWNER, ownerLogin: null }), none, "CLI without owner login");
  assert.deepEqual(declaredModel([verdict("review", head, "PASS", "x")], "review", null, OWNER), none);
  assert.deepEqual(declaredModel([verdict("review", head, "PASS", "x")], "review", "abc123", OWNER), none);
});

test("finding (1) of cxcr1946: an unauthenticated newer Opus line never replaces a valid Sonnet PASS", () => {
  const head = SHA("c");
  const valid = verdict("review", head, "PASS", "claude-sonnet-5-5");
  const forged = verdict("review", head, "PASS", "Opus", {
    performed_via_github_app: null, created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z" });
  const pr = { headRefOid: head };
  const result = checkRole([valid, forged], "review", pr, "critical", ["src/lib/x.ts"], OWNER);
  assert.deepEqual(result, { declared: "claude-sonnet-5-5", expected: "opus", outcome: "below" });
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
