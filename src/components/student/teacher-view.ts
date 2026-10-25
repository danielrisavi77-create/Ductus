import type { WorkspaceMode } from "@/components/shell/WorkspaceShell";

import type { WorkDocumentPlan } from "./work-document-plan";

// #732 item 7 (contract 6396547184 §2): which view of `/rad` is open. Pure:
// the teacher's view exists only for the student's own work of an assignment
// (plan `assignment`, its document id from the B1 read); every other plan,
// and any `prikaz` other than exactly "nastavnik", is the writing view.

export type TeacherViewChoice = {
  mode: WorkspaceMode;
  /** The switch's address; undefined: a disabled button with its reason. */
  teacherViewHref: string | undefined;
};

/** The one value of `prikaz` that opens the teacher's view. */
export const TEACHER_VIEW_PARAM = "nastavnik";

/** `/rad`, `/rad?zadatak=<id>`, or with `teacherView` its teacher's view. */
export function radPath(assignmentId: string | null, teacherView = false): string {
  if (!assignmentId) return "/rad";
  const base = `/rad?zadatak=${encodeURIComponent(assignmentId)}`;
  return teacherView ? `${base}&prikaz=${TEACHER_VIEW_PARAM}` : base;
}

/** `rawPrikaz`: `searchParams.prikaz` as it came, before any check. */
export function teacherViewMode(plan: WorkDocumentPlan, rawPrikaz: string | string[] | undefined): TeacherViewChoice {
  if (plan.kind !== "assignment") return { mode: "writing", teacherViewHref: undefined };
  return {
    mode: rawPrikaz === TEACHER_VIEW_PARAM ? "teacher-view" : "writing",
    teacherViewHref: radPath(plan.assignmentId, true),
  };
}
