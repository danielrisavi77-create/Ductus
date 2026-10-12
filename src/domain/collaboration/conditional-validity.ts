/**
 * Spike S-UV1: Uvjetovana valjanost pregleda (JSONB verzija).
 * Feature flag: conditional_validity
 *
 * Ovo je minimalni model za dokazivanje koncepta.
 * Ne zamjenjuje D-45; proširuje ga.
 */

export type ValidityConditionKind = "text_range" | "protected_element";

export type ValidityConditionStatus = "valid" | "needs_re_review" | "superseded";

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
    return !currentTextInRange.includes(condition.protected_value);
  }

  return false;
}

export function applyRevisionToConditions(
  conditions: ValidityCondition[] | undefined,
  currentTextInRange: string,
): ValidityCondition[] {
  if (!conditions) return [];
  return conditions.map((c) => {
    if (needsReReview(c, currentTextInRange)) {
      return { ...c, status: "needs_re_review" as const };
    }
    return c;
  });
}

export function hasNeedsReReview(conditions: ValidityCondition[] | undefined): boolean {
  return (conditions ?? []).some((c) => c.status === "needs_re_review");
}
