import { afterEach, beforeEach, describe, it } from "vitest";
import * as fc from "fast-check";
import {
  applyRevisionToConditions,
  hasNeedsReReview,
  normalizeForComparison,
  snapshotHash,
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
        fc.array(fc.constantFrom(" ", "\t", "\n", ".", ",", ";", ":", "!", "?"), {
          maxLength: 10,
        }).map((parts) => parts.join("")),
        (base, noise) => {
          const original = base.trim();
          if (!original) return true;

          const condition: ValidityCondition = {
            kind: "text_range",
            revision_id: "rev-1",
            text_snapshot_hash: snapshotHash(normalizeForComparison(original)),
            status: "valid",
            accepted_at: "2026-10-13T00:00:00Z",
            accepted_by: "t",
          };

          const trivial = `  ${original}${noise}.  `;
          const result = applyRevisionToConditions([condition], trivial);
          return !hasNeedsReReview(result);
        },
      ),
      { numRuns: 50 },
    );
  });

  // F-168: the expected outcome comes from how the text is built, never from
  // normalizeForComparison, the function under test. Words hold letters and
  // digits only, so a different word is always a changed sentence, whatever
  // the final mark (owner decision of 31 October 2026, #87 comment 6544623431:
  // a change of the final mark alone is no change).
  it("changing a word always triggers re-review (independent oracle)", () => {
    const word = fc.stringMatching(/^[a-zA-Z0-9čćđšžČĆĐŠŽ]{1,12}$/);
    const mark = fc.constantFrom("", ".", "?", "!", " ", " .");
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 12 }),
        fc.nat(),
        word,
        mark,
        mark,
        (words, at, replacement, before, after) => {
          const i = at % words.length;
          fc.pre(words[i] !== replacement);
          const original = words.join(" ") + before;
          const changed = words.map((w, j) => (j === i ? replacement : w)).join(" ") + after;
          const condition: ValidityCondition = {
            kind: "text_range",
            revision_id: "rev-1",
            text_snapshot_hash: snapshotHash(normalizeForComparison(original)),
            status: "valid",
            accepted_at: "2026-10-13T00:00:00Z",
            accepted_by: "t",
          };
          return hasNeedsReReview(applyRevisionToConditions([condition], changed));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("changing a word in arbitrary text triggers re-review", () => {
    fc.assert(changingAWord(), { numRuns: 50 });
  });

  // #963: this seed and path once produced "!" -> " ", a change that only
  // removes trailing punctuation and whitespace, which normalisation ignores
  // on purpose (see the test above). It must stay a passing case.
  it("changing a word: regression seed of #963", () => {
    fc.assert(changingAWord(), {
      seed: -167247653,
      path: "9:0:0:0:0:0:1:0:0:0:0:1:1",
      endOnFailure: true,
    });
  });

  function changingAWord() {
    return fc.property(
      fc.string({ minLength: 5, maxLength: 100 }),
      fc.string({ minLength: 1, maxLength: 20 }),
      (base, replacement) => {
        const original = base.trim();
        if (!original || original === replacement) return true;

        const condition: ValidityCondition = {
          kind: "text_range",
          revision_id: "rev-1",
          text_snapshot_hash: snapshotHash(normalizeForComparison(original)),
          status: "valid",
          accepted_at: "2026-10-13T00:00:00Z",
          accepted_by: "t",
        };

        const changed = original.replace(/\S+/, replacement);
        // Only trailing punctuation or whitespace changed (#963): not a
        // changed word; the test above covers that case.
        if (normalizeForComparison(changed) === normalizeForComparison(original)) return true;

        const result = applyRevisionToConditions([condition], changed);
        return hasNeedsReReview(result);
      },
    );
  }

  it("old confirmation is never deleted", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (text) => {
        const condition: ValidityCondition = {
          kind: "text_range",
          revision_id: "rev-1",
          text_excerpt: "original excerpt",
          text_snapshot_hash: snapshotHash(normalizeForComparison("original")),
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
