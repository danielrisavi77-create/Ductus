import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  applyRevisionToConditions,
  hasNeedsReReview,
  normalizeForComparison,
  simpleHash,
  type ValidityCondition,
} from "./conditional-validity";

describe("conditional-validity property tests (S-UV1)", () => {
  beforeEach(() => {
    process.env.CONDITIONAL_VALIDITY = "true";
  });
  afterEach(() => {
    delete process.env.CONDITIONAL_VALIDITY;
  });

  it("trivial whitespace and trailing punctuation never trigger re-review", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 10 }),
        (base, noise) => {
          const original = base.trim();
          if (!original) return true;

          const condition: ValidityCondition = {
            kind: "text_range",
            revision_id: "rev-1",
            text_snapshot_hash: simpleHash(normalizeForComparison(original)),
            status: "valid",
            accepted_at: "2026-10-13T00:00:00Z",
            accepted_by: "t",
          };

          const trivial = `  ${original}${noise.replace(/[a-zA-Z0-9]/g, "")}.  `;
          const result = applyRevisionToConditions([condition], trivial);
          return !hasNeedsReReview(result);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("changing a word always triggers re-review", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (base, replacement) => {
          const original = base.trim();
          if (!original || original === replacement) return true;

          const condition: ValidityCondition = {
            kind: "text_range",
            revision_id: "rev-1",
            text_snapshot_hash: simpleHash(normalizeForComparison(original)),
            status: "valid",
            accepted_at: "2026-10-13T00:00:00Z",
            accepted_by: "t",
          };

          const changed = original.replace(/\S+/, replacement);
          if (changed === original) return true;

          const result = applyRevisionToConditions([condition], changed);
          return hasNeedsReReview(result);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("old confirmation is never deleted", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (text) => {
        const condition: ValidityCondition = {
          kind: "text_range",
          revision_id: "rev-1",
          text_excerpt: "original excerpt",
          text_snapshot_hash: simpleHash(normalizeForComparison("original")),
          status: "valid",
          accepted_at: "2026-10-13T00:00:00Z",
          accepted_by: "t",
        };
        const result = applyRevisionToConditions([condition], text);
        return result.length === 1 && result[0]?.text_excerpt === "original excerpt";
      }),
      { numRuns: 30 },
    );
  });
});
