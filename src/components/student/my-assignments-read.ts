import type { WithActor } from "@/server/db/with-actor";

// #711 contract 6404612273 ("Moji zadaci"): the student's way back to an
// assignment. One SELECT under the session's RLS lists the courses of the
// student's own open student memberships and, in each, the current version of
// every assignment; the identity comes from app.current_user_id(), never from
// the browser. Nothing here writes or opens a work: each item links to /rad,
// which decides access and sends an unacknowledged notice to /zadatak/<id>
// (PRODUCT §5 rule 6). Any row that is not what the query returns makes the
// whole list unavailable, never a partial or invented one.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface Row {
  user_id: unknown;
  course_id: unknown;
  course_name: unknown;
  assignment_id: unknown;
  title: unknown;
  due_at: unknown;
  acknowledged: unknown;
}

// `me` always gives one row, so a session the database no longer accepts
// (user_id NULL) reads as signed out rather than as "no courses".
const QUERY = `WITH me AS (SELECT app.current_user_id() AS user_id)
SELECT me.user_id, c.id AS course_id, c.name AS course_name, a.id AS assignment_id, v.title, v.due_at,
  EXISTS (SELECT 1 FROM institution.notice_acknowledgment n
    WHERE n.assignment_id = a.id AND n.version_no = a.current_version AND n.student_id = me.user_id) AS acknowledged
FROM me
LEFT JOIN (institution.course_member m JOIN institution.course c ON c.id = m.course_id)
  ON m.user_id = me.user_id AND m.role = 'student' AND m.member_to IS NULL
LEFT JOIN institution.assignment a ON a.course_id = c.id
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

export type MyAssignment = {
  id: string;
  title: string;
  dueAt: string;
  /** The current version's notice is not acknowledged yet; /rad opens it first. */
  noticeFirst: boolean;
};

export type MyCourse = { id: string; name: string; assignments: MyAssignment[] };

export type MyAssignmentsRead =
  | { kind: "ready"; courses: MyCourse[] }
  | { kind: "signedOut" }
  | { kind: "unavailable" };

const UNAVAILABLE: MyAssignmentsRead = { kind: "unavailable" };

const byText = (a: string, b: string) => a.localeCompare(b, "hr");
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The rows as courses, or null when any row is not what the query returns. */
export function coursesOfRows(rows: readonly Row[]): MyCourse[] | null {
  const courses = new Map<string, MyCourse>();
  for (const row of rows) {
    const { course_id: id, course_name: name } = row;
    if (id === null && name === null && row.assignment_id === null) continue; // `me` without a membership
    if (typeof id !== "string" || !UUID.test(id) || typeof name !== "string" || name === "") return null;
    let course = courses.get(id);
    if (course === undefined) {
      course = { id, name, assignments: [] };
      courses.set(id, course);
    } else if (course.name !== name) {
      return null;
    }
    if (row.assignment_id === null) continue;
    const due = row.due_at;
    if (typeof row.assignment_id !== "string" || !UUID.test(row.assignment_id)
      || typeof row.title !== "string" || row.title === ""
      || !(due instanceof Date) || !Number.isFinite(due.getTime())
      || typeof row.acknowledged !== "boolean"
      || course.assignments.some((a) => a.id === row.assignment_id)) return null;
    course.assignments.push({ id: row.assignment_id, title: row.title, dueAt: due.toISOString(), noticeFirst: !row.acknowledged });
  }
  // Course by name, then id; assignment by due time, then id: the order never wavers.
  const list = [...courses.values()].sort((a, b) => byText(a.name, b.name) || byId(a.id, b.id));
  for (const course of list) {
    course.assignments.sort((a, b) => byId(a.dueAt, b.dueAt) || byId(a.id, b.id));
  }
  return list;
}

export async function readMyAssignments(token: string | undefined, withActor: WithActor): Promise<MyAssignmentsRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  try {
    const rows = await withActor(token, async (tx) => (await tx.query<Row>(QUERY)).rows);
    if (rows.length === 0) return UNAVAILABLE;
    if (rows.every((row) => row.user_id === null)) return { kind: "signedOut" };
    if (rows.some((row) => typeof row.user_id !== "string" || row.user_id !== rows[0]!.user_id)) return UNAVAILABLE;
    const courses = coursesOfRows(rows);
    return courses === null ? UNAVAILABLE : { kind: "ready", courses };
  } catch {
    return UNAVAILABLE;
  }
}
