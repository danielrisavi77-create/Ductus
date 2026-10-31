import type { MyAssignmentsRead } from "./my-assignments-read";

/**
 * DAN-344 S03-a (#923 c.6545848868): the course named above the notice on
 * /zadatak/<id>. readNotice does not return it, so it comes from the
 * student's own list (readMyAssignments, the same RLS read as /zadaci): the
 * course whose list holds this assignment. Anything else, a read that is not
 * ready or an assignment on no list, gives null and the page shows nothing.
 */
export type NoticeCourse = { id: string; name: string };

export function noticeCourse(read: MyAssignmentsRead, assignmentId: string): NoticeCourse | null {
  if (read.kind !== "ready") return null;
  const wanted = assignmentId.toLowerCase();
  const course = read.courses.find((c) => c.assignments.some((a) => a.id.toLowerCase() === wanted));
  return course ? { id: course.id, name: course.name } : null;
}
