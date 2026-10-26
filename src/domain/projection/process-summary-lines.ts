import type { ProcessSummaryV1 } from "./process-summary";

/**
 * The two lines of the fast path in the demo (#757, owner decisions O2 and O3
 * of 25. 10. 2026.; D-80 point 2), derived from the same summary the student
 * is shown (PRODUCT §5 rule 5). One function for the teacher and the student,
 * so the lines cannot differ between them.
 */
export type ProcessSummaryLines = {
  /** `to` of the last session, a whole minute in UTC; null with no session. */
  lastChangeAt: string | null;
  /** Every paste, listed or not: none has an observed source (D-137). */
  pastesWithoutSource: number;
};

export function processSummaryLines(summary: ProcessSummaryV1): ProcessSummaryLines {
  return {
    lastChangeAt: summary.sessions.items.at(-1)?.to ?? null,
    pastesWithoutSource: summary.pastes.listed.length + summary.pastes.smallerCount,
  };
}
