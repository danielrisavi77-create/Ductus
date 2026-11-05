import type { TeacherCourse, TeacherCoursesRead } from "@/server/institution/teacher-courses";

/**
 * DAN-310 (M2.4-P01): a further assignment in a course the teacher already
 * has. Only the fields the form needs; the course comes from the same RLS read
 * as /nastavnik, so the database decides whose it is.
 */
export type ExistingCourse = Pick<TeacherCourse, "id" | "name" | "academicYear" | "aiPolicy">;

/**
 * What `?kolegij=` selects. "new" is the screen without the parameter (course
 * and assignment together). A malformed id, a course of someone else and a
 * course that does not exist are all "missing", so the screen never tells
 * them apart. "unavailable" is a failed read, never said as "missing".
 */
export type CourseChoice =
  | { kind: "new" }
  | { kind: "found"; course: ExistingCourse }
  | { kind: "missing" | "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link from /nastavnik to the form for a further assignment in `courseId`. */
export function newAssignmentHref(courseId: string): string {
  return `/nastavnik/zadatak/novi?kolegij=${encodeURIComponent(courseId)}`;
}

/** Where a sign-in from this screen returns: the same course when the id is well formed, else the plain form. */
export function newAssignmentReturnTo(param: string | string[] | undefined): string {
  return typeof param === "string" && UUID.test(param) ? newAssignmentHref(param) : "/nastavnik/zadatak/novi";
}

export function chooseCourse(param: string | string[] | undefined, read: TeacherCoursesRead | null): CourseChoice {
  if (param === undefined) return { kind: "new" };
  if (typeof param !== "string" || !UUID.test(param)) return { kind: "missing" };
  if (read === null || read.kind !== "ok") return { kind: read?.kind === "unavailable" ? "unavailable" : "missing" };
  const id = param.toLowerCase();
  const course = read.courses.find((c) => c.id.toLowerCase() === id);
  if (!course) return { kind: "missing" };
  return { kind: "found", course: { id: course.id, name: course.name, academicYear: course.academicYear, aiPolicy: course.aiPolicy } };
}
