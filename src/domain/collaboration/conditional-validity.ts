/**
 * Spike S-UV1: Uvjetovana valjanost pregleda (JSONB verzija).
 * Feature flag: conditional_validity
 *
 * Ovo je minimalni model za dokazivanje koncepta.
 * Ne zamjenjuje D-45; proširuje ga.
 */

export type ValidityConditionKind = "text_range" | "protected_element";

export type ValidityConditionStatus = "valid" | "needs_re_review" | "superseded";

// Callers with multiple independent anchors must resolve text per condition.
// A literal string remains supported for a single common anchored range.
// Missing or failed resolution is treated conservatively as changed.
export type CurrentConditionText =
  | string
  | ((condition: ValidityCondition) => string | null | undefined);

export type ValidityCondition = {
  kind: ValidityConditionKind;
  revision_id: string;
  anchor_range_hash?: string;
  text_snapshot_hash?: string;
  text_excerpt?: string;
  protected_kind?: "number" | "literal_quote" | "negation";
  protected_value?: string;
  status: ValidityConditionStatus;
  accepted_at: string;
  accepted_by: string;
};

export type ReviewRequestWithConditions = {
  id: string;
  comment_id: string;
  state: "open" | "student_claimed" | "accepted" | "reopened";
  accepted_revision_id?: string;
  anchor_range_hash?: string;
  conditions?: ValidityCondition[];
};

/** Feature flag. U spikeu se čita iz env; u produkciji iz configa. */
export function isConditionalValidityEnabled(): boolean {
  return process.env.CONDITIONAL_VALIDITY === "true";
}

/** Konzervativni normalizator za spike (whitespace + trailing punctuation). */
export function normalizeForComparison(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");
}

/** Jednostavan hash za spike (ne kriptografski). U produkciji zamijeniti. */
export function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export function needsReReview(
  condition: ValidityCondition,
  currentTextInRange: string,
): boolean {
  if (condition.status !== "valid") return false;

  const normalized = normalizeForComparison(currentTextInRange);

  if (condition.text_snapshot_hash) {
    return simpleHash(normalized) !== condition.text_snapshot_hash;
  }

  if (condition.protected_value && condition.protected_kind === "number") {
    // substring matching would incorrectly accept 142 or 42.0 as the old 42.
    // A protected numeric value is only present as a complete number token.
    const tokens = currentTextInRange.match(
      /(?<![\p{L}\p{N}])[+\-\u2212]?\p{N}+(?:[.,]\p{N}+)*(?![\p{L}\p{N}])/gu,
    ) ?? [];
    return !tokens.includes(condition.protected_value);
  }

  return false;
}

export function applyRevisionToConditions(
  conditions: ValidityCondition[] | undefined,
  currentTextInRange: CurrentConditionText,
): ValidityCondition[] {
  if (!conditions || !isConditionalValidityEnabled()) return conditions ?? [];
  return conditions.map((c) => {
    if (c.status !== "valid") return c;
    let current: string | null | undefined;
    try {
      current = typeof currentTextInRange === "function"
        ? currentTextInRange(c)
        : currentTextInRange;
    } catch {
      // The expected text could not be read: never imply a valid confirmation.
      current = null;
    }
    if (typeof current !== "string" || needsReReview(c, current)) {
      return { ...c, status: "needs_re_review" as const };
    }
    return c;
  });
}

export function hasNeedsReReview(conditions: ValidityCondition[] | undefined): boolean {
  return (conditions ?? []).some((c) => c.status === "needs_re_review");
}
