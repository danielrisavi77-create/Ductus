import type { CanonicalDocument, DocumentNode } from "@/domain/document";
import { messagesHr } from "@/lib/i18n/messages.hr";
import type { AssignmentSubmission } from "@/server/evidence/assignment-submissions";
import type { AssignmentWork } from "@/server/evidence/assignment-works";
import type { TeacherCourse } from "@/server/institution/teacher-courses";

import { courseMotif, type CourseMotif } from "@/components/student/course-motif";
import { zagrebParts } from "@/components/summary/zagreb-time";

import { fullName, type FastPathStudent } from "./fast-path";

/**
 * The header of the teacher's live view (Archivum T05, DAN-344, #923
 * contract 6430008106 §4). `?zadatak=<assignmentId>` on the link from the
 * works list is only an address, never a proof of access: the course and the
 * assignment come from the teacher's own course read, the student from the
 * works read of that assignment, both under the session cookie, and the
 * live route still decides the text. When the assignment is not among the
 * teacher's, or the document not among its works, there is no context and the
 * page stays "Rad uživo", as before.
 */
export type LiveContext = {
  readonly assignmentId: string;
  readonly course: string;
  readonly motif: CourseMotif;
  readonly title: string;
  /** The label of the assignment's work type, or null for a type the catalogue does not name. */
  readonly workType: string | null;
  /** Whose work it is; the name comes from the fast path read in the browser. */
  readonly studentId: string;
  /**
   * T06: the recorded submission of this work from the teacher's submissions
   * read (`requestedMinute` is the minute of the request by the server's
   * clock), or null without one. Only ever shown beside a text the live
   * route sent as submitted.
   */
  readonly submission: { readonly revision: number; readonly requestedMinute: string } | null;
};

const workTypes: Record<string, string> = messagesHr.teacher.assignment.workTypes;

export function liveContext(
  courses: readonly TeacherCourse[],
  works: readonly AssignmentWork[],
  assignmentId: string,
  documentId: string,
  submissions: readonly AssignmentSubmission[] = [],
): LiveContext | null {
  const id = assignmentId.toLowerCase();
  for (const course of courses) {
    const assignment = course.assignments.find((a) => a.id.toLowerCase() === id);
    if (!assignment) continue;
    const work = works.find((w) => w.documentId === documentId);
    if (!work) return null;
    const row = submissions.find((s) => s.documentId === documentId && s.studentId === work.studentId);
    return {
      assignmentId: assignment.id,
      course: course.name,
      motif: courseMotif(course.id),
      title: assignment.title,
      workType: workTypes[assignment.workType] ?? null,
      studentId: work.studentId,
      submission: row?.submitted && row.revision !== null && row.requestedMinute !== null
        ? { revision: row.revision, requestedMinute: row.requestedMinute } : null,
    };
  }
  return null;
}

/**
 * The way back to the works of the assignment. A stub until T04 (Frontend 3)
 * lands its list: the existing works of the assignment are on the fast path.
 */
export function assignmentWorksHref(assignmentId: string): string {
  return `/nastavnik/brz-put?zadatak=${encodeURIComponent(assignmentId)}`;
}

/** The id a heading of the shown text carries, so the outline can link to it. */
export function headingAnchor(nodeId: string): string {
  return `naslov-${nodeId}`;
}

export type OutlineEntry = { readonly nodeId: string; readonly level: 1 | 2 | 3; readonly text: string };

const textOf = (node: DocumentNode) => node.children.map((child) => child.text).join("").trim();

/** "Struktura rada": the headings of the text on screen, in order; empty ones left out. Nothing is read. */
export function liveOutline(document: CanonicalDocument | null): OutlineEntry[] {
  if (!document) return [];
  return document.nodes.flatMap((node) =>
    node.type === "heading" && textOf(node) !== "" ? [{ nodeId: node.id, level: node.level, text: textOf(node) }] : []);
}

/** The heading the passage `nodeId` stands under: the node itself or the nearest heading before it. */
export function sectionHeading(document: CanonicalDocument | null, nodeId: string): string | null {
  if (!document) return null;
  let last: string | null = null;
  for (const node of document.nodes) {
    if (node.type === "heading" && textOf(node) !== "") last = textOf(node);
    if (node.id === nodeId) return last;
  }
  return null;
}

/** The student's name from the fast path read; null without the student or without a name (#757 D1). */
export function studentName(students: readonly FastPathStudent[], studentId: string): string | null {
  const student = students.find((s) => s.id === studentId);
  return student && student.surname !== null && student.givenName !== null ? fullName(student) : null;
}

const t = messagesHr.liveView;

/** T06: "Verzija 12" and "26. listopada 2026. u 16:10" of the recorded submission, or none. */
export function submittedParts(context: LiveContext | null): { version: string; at: string; note: string } | null {
  const submission = context?.submission;
  const parts = submission ? zagrebParts(submission.requestedMinute) : null;
  if (!submission || !parts) return null;
  const n = String(submission.revision);
  return {
    version: t.submittedVersion.replace("{n}", n),
    at: t.submittedAt.replace("{date}", parts.date).replace("{time}", parts.time),
    note: t.submittedTextAt.replace("{n}", n).replace("{date}", parts.date).replace("{time}", parts.time),
  };
}
