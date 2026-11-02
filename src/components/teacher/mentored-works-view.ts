import { compareHr } from "@/domain/text/compare-hr";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { MentoredWork } from "@/server/institution/mentored-works";

const t = messagesHr.mentoredWorks;
const workTypes: Record<string, string> = messagesHr.teacher.assignment.workTypes;

function byId(a: MentoredWork, b: MentoredWork): number {
  return a.mentorshipId < b.mentorshipId ? -1 : a.mentorshipId > b.mentorshipId ? 1 : 0;
}

/**
 * DAN-492 (N-16), design pregled-radova-v2 "Radovi · abecedno": by family
 * name, then given name, in Croatian order; a student without a name last.
 * The mentorship id only breaks a tie, so the order never depends on when a
 * mentorship began, and nothing is ordered by a number (D-80).
 */
export function byFamilyName(works: readonly MentoredWork[]): MentoredWork[] {
  return [...works].sort((a, b) => {
    if (a.student === null || b.student === null) {
      return a.student === b.student ? byId(a, b) : a.student === null ? 1 : -1;
    }
    return compareHr(a.student.familyName, b.student.familyName)
      || compareHr(a.student.givenName, b.student.givenName)
      || byId(a, b);
  });
}

/** The student's name as the account gives it, or the same words for any work without one (#757 D1). */
export function studentName(work: MentoredWork): string {
  return work.student === null ? t.unnamed : `${work.student.givenName} ${work.student.familyName}`;
}

/** The state of the work, in words only (D-128). */
export function stateText(work: MentoredWork): string {
  return t.state[work.workState];
}

export function workTypeText(work: MentoredWork): string {
  return workTypes[work.workType] ?? "";
}

/** The live view of a started work; none before the student opens it. */
export function liveHref(work: MentoredWork): string | null {
  return work.documentId === null ? null : `/nastavnik/rad/${encodeURIComponent(work.documentId)}`;
}
