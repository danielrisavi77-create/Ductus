import type { WorkDocumentPlan } from "./work-document-plan";

// #732 item 7 (contract 6396547184 §2, 6404284308): which view of `/rad` is
// open and where the "Kako vidi nastavnik" switch leads. Pure, and the only
// place that decides it. Only the student's own assignment work has a
// teacher's view; in every other plan `prikaz` changes nothing and the
// switch stays a disabled button, so no read of the live text ever starts.

/** The value of `prikaz` that opens the teacher's view, matched exactly. */
export const TEACHER_VIEW_PARAM = "nastavnik";

export type TeacherViewMode = {
  mode: "writing" | "teacher-view";
  /** Undefined unless the plan is the student's own assignment work. */
  teacherViewHref: string | undefined;
};

export function teacherViewMode(
  plan: WorkDocumentPlan,
  rawPrikaz: string | string[] | undefined,
): TeacherViewMode {
  if (plan.kind !== "assignment") return { mode: "writing", teacherViewHref: undefined };
  return {
    mode: rawPrikaz === TEACHER_VIEW_PARAM ? "teacher-view" : "writing",
    teacherViewHref: `/rad?zadatak=${encodeURIComponent(plan.assignmentId)}&prikaz=${TEACHER_VIEW_PARAM}`,
  };
}
