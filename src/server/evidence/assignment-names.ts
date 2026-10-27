import type { WithActor } from "@/server/db/with-actor";
import { readNamedStudents, type NamedStudentsRead } from "@/server/institution/course-students";

/**
 * DAN-344 R-2 (#923, contract c.6434766713 point 3; D-170 as amended on #87):
 * the students of one assignment with their name pair, for the teacher's
 * assignment page (T04), beside readAssignmentSubmissions. The database
 * decides who gets rows (app.teacher_assignment_names: the assignment's
 * teacher only, the same students as app.assignment_submissions), so the page
 * joins the two by studentId. No text, document or revision, and no work is
 * opened: nothing is written to the access log or the fast path window.
 */

const SQL =
  "SELECT student_id::text AS student_id, given_name, family_name FROM app.teacher_assignment_names($1::uuid)";

export function readAssignmentStudentNames(
  sessionToken: string | undefined,
  withActor: WithActor,
  assignmentId: string,
): Promise<NamedStudentsRead> {
  return readNamedStudents(sessionToken, withActor, assignmentId, SQL, "assignment names read failed");
}
