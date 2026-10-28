import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRevisionToConditions,
  hasNeedsReReview,
  needsReReview,
  normalizeForComparison,
  simpleHash,
  type ValidityCondition,
} from "./conditional-validity";

function makeCondition(
  overrides: Partial<ValidityCondition> = {},
): ValidityCondition {
  return {
    kind: "text_range",
    revision_id: "rev-1",
    text_snapshot_hash: simpleHash(normalizeForComparison("broj sudionika je 42")),
    text_excerpt: "broj sudionika je 42",
    status: "valid",
    accepted_at: "2026-10-13T00:00:00Z",
    accepted_by: "teacher-1",
    ...overrides,
  };
}

describe("conditional-validity spike (S-UV1)", () => {
  beforeEach(() => {
    process.env.CONDITIONAL_VALIDITY = "true";
  });
  afterEach(() => {
    delete process.env.CONDITIONAL_VALIDITY;
  });

  describe("normalizeForComparison", () => {
    it("collapses whitespace and trims trailing punctuation", () => {
      expect(normalizeForComparison("  hello   world.  ")).toBe("hello world");
      expect(normalizeForComparison("test!")).toBe("test");
      expect(normalizeForComparison("  test ! ?.  ")).toBe("test");
      expect(normalizeForComparison(" ! . ")).toBe("");
    });
  });

  describe("needsReReview", () => {
    it("returns false when status is not valid", () => {
      const c = makeCondition({ status: "needs_re_review" });
      expect(needsReReview(c, "anything")).toBe(false);
    });

    it("detects word change inside range", () => {
      const c = makeCondition();
      expect(needsReReview(c, "broj sudionika je 43")).toBe(true);
    });

    it("ignores trivial whitespace and trailing punctuation", () => {
      const c = makeCondition();
      expect(needsReReview(c, "  broj sudionika je 42.  ")).toBe(false);
    });

    it("detects semantic change: povezano je -> uzrokuje", () => {
      const original = "rezultati su povezani s prethodnim radovima";
      const c = makeCondition({
        text_snapshot_hash: simpleHash(normalizeForComparison(original)),
        text_excerpt: original,
      });
      expect(needsReReview(c, "rezultati uzrokuju promjene")).toBe(true);
    });

    it("does not mistake a numeric substring or decimal extension for the protected number", () => {
      const c = makeCondition({
        kind: "protected_element",
        protected_kind: "number",
        protected_value: "42",
        text_snapshot_hash: undefined,
      });
      expect(needsReReview(c, "broj sudionika je 142")).toBe(true);
      expect(needsReReview(c, "broj sudionika je 420")).toBe(true);
      expect(needsReReview(c, "broj sudionika je 42.0")).toBe(true);
      expect(needsReReview(c, "broj sudionika je -42")).toBe(true);
      expect(needsReReview(c, "broj sudionika je 42.")).toBe(false);
      expect(needsReReview(c, "masa je 42,5kg")).toBe(true);
      expect(needsReReview(c, "masa je 42.0kg")).toBe(true);
    });

    it("fails closed for a condition that cannot be evaluated", () => {
      const noHashRange = makeCondition({ text_snapshot_hash: undefined });
      const negation = makeCondition({
        kind: "protected_element",
        protected_kind: "negation",
        protected_value: "ne",
        text_snapshot_hash: undefined,
      });
      const quote = makeCondition({
        kind: "protected_element",
        protected_kind: "literal_quote",
        protected_value: "citat",
        text_snapshot_hash: undefined,
      });
      const emptyNumber = makeCondition({
        kind: "protected_element",
        protected_kind: "number",
        protected_value: "",
        text_snapshot_hash: undefined,
      });
      for (const c of [noHashRange, negation, quote, emptyNumber]) {
        expect(needsReReview(c, "potpuno novi tekst")).toBe(true);
      }
      const result = applyRevisionToConditions([negation], "potpuno novi tekst");
      expect(result[0]?.status).toBe("needs_re_review");
    });

    it("detects protected number change", () => {
      const c = makeCondition({
        kind: "protected_element",
        protected_kind: "number",
        protected_value: "42",
        text_snapshot_hash: undefined,
      });
      expect(needsReReview(c, "broj sudionika je 43")).toBe(true);
      expect(needsReReview(c, "broj sudionika je 42")).toBe(false);
    });
  });

  describe("applyRevisionToConditions", () => {
    it("marks only the changed condition as needs_re_review", () => {
      const conditions = [
        makeCondition({ text_excerpt: "prva tvrdnja" }),
        makeCondition({
          text_excerpt: "druga tvrdnja",
          text_snapshot_hash: simpleHash(normalizeForComparison("druga tvrdnja")),
        }),
      ];
      const updated = applyRevisionToConditions(conditions, (condition) =>
        condition.text_excerpt === "druga tvrdnja" ? "druga tvrdnja" : "promijenjena prva tvrdnja",
      );
      expect(updated[0]?.status).toBe("needs_re_review");
      expect(updated[1]?.status).toBe("valid");
    });

    it("keeps old confirmation visible (does not delete)", () => {
      const conditions = [makeCondition()];
      const updated = applyRevisionToConditions(conditions, "potpuno novi tekst");
      expect(updated).toHaveLength(1);
      expect(updated[0]?.status).toBe("needs_re_review");
      expect(updated[0]?.text_excerpt).toBe("broj sudionika je 42");
    });

    it("fails conservatively for a range that cannot be resolved", () => {
      const c = makeCondition();
      const result = applyRevisionToConditions([c], () => null);
      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe("needs_re_review");
    });

    it("returns empty array when no conditions", () => {
      expect(applyRevisionToConditions(undefined, "any")).toEqual([]);
    });

    it("does nothing when feature flag is off", () => {
      delete process.env.CONDITIONAL_VALIDITY;
      const conditions = [makeCondition()];
      const updated = applyRevisionToConditions(conditions, "potpuno novi tekst");
      expect(updated[0]?.status).toBe("valid");
    });
  });

  describe("hasNeedsReReview", () => {
    it("returns true when any condition needs re-review", () => {
      const conditions = [
        makeCondition(),
        makeCondition({ status: "needs_re_review" }),
      ];
      expect(hasNeedsReReview(conditions)).toBe(true);
    });

    it("returns false when all are valid", () => {
      expect(hasNeedsReReview([makeCondition()])).toBe(false);
    });
  });

  describe("manual scenario (Croatian)", () => {
    it("flags re-review when number and claim strength change", () => {
      const original =
        "Istraživanje je pokazalo da je broj sudionika 42 i da su rezultati povezani s prethodnim radovima.";
      const conditions: ValidityCondition[] = [
        {
          kind: "text_range",
          revision_id: "rev-1",
          text_snapshot_hash: simpleHash(normalizeForComparison(original)),
          text_excerpt: original.slice(0, 80),
          status: "valid",
          accepted_at: "2026-10-13T00:00:00Z",
          accepted_by: "teacher-1",
        },
        {
          kind: "protected_element",
          revision_id: "rev-1",
          protected_kind: "number",
          protected_value: "42",
          status: "valid",
          accepted_at: "2026-10-13T00:00:00Z",
          accepted_by: "teacher-1",
        },
      ];

      const updatedText =
        "Istraživanje je pokazalo da je broj sudionika 43 i da rezultati uzrokuju promjene.";

      const result = applyRevisionToConditions(conditions, updatedText);
      expect(result.some((c) => c.status === "needs_re_review")).toBe(true);
      expect(hasNeedsReReview(result)).toBe(true);
    });
  });
});
