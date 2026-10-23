import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-230 HTTP boundary: GET /api/teacher/courses, the teacher's courses and
 * their assignments for the Z3 entry (contract on #476, comment 6278724427,
 * 3a). Who asks comes only from the session cookie, bound into withActor; the
 * database decides which courses (institution.list_teacher_courses, under the
 * existing RLS). The answer names no student, no text and no time of the
 * live view: per assignment only the number of students of the course.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACADEMIC_YEAR = /^[0-9]{4}\/[0-9]{4}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NO_STORE = { "cache-control": "no-store" };
const WORK_TYPES = new Set([
  "short_paper",
  "essay",
  "seminar_paper",
  "bachelor_thesis",
  "master_thesis",
  "specialist_thesis",
  "doctoral_thesis",
]);

export interface TeacherCoursesDeps {
  withActor: WithActor;
  sessionToken?: string;
}

export interface TeacherAssignment {
  id: string;
  title: string;
  workType: string;
  opensAt: string;
  dueAt: string;
  currentVersion: number;
  enrolledStudents: number;
}

export interface TeacherCourse {
  id: string;
  name: string;
  academicYear: string;
  assignments: TeacherAssignment[];
}

type Row = Record<string, unknown>;

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

const isCount = (value: unknown, min: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;

function instant(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** The rows as the contract's courses, or null when any row is not what the function returns. */
export function coursesOf(rows: readonly Row[]): TeacherCourse[] | null {
  const courses = new Map<string, TeacherCourse>();
  for (const row of rows) {
    const { course_id: id, course_name: name, academic_year: year } = row;
    if (typeof id !== "string" || !UUID.test(id) || typeof name !== "string" || name === ""
      || typeof year !== "string" || !ACADEMIC_YEAR.test(year)) return null;
    let course = courses.get(id);
    if (course === undefined) {
      course = { id, name, academicYear: year, assignments: [] };
      courses.set(id, course);
    } else if (course.name !== name || course.academicYear !== year) {
      return null;
    }
    if (row.assignment_id === null) continue;
    const opensAt = instant(row.opens_at);
    const dueAt = instant(row.due_at);
    if (typeof row.assignment_id !== "string" || !UUID.test(row.assignment_id)
      || typeof row.title !== "string" || row.title === ""
      || typeof row.work_type !== "string" || !WORK_TYPES.has(row.work_type)
      || opensAt === null || dueAt === null
      || !isCount(row.current_version, 1) || !isCount(row.enrolled_students, 0)) return null;
    course.assignments.push({
      id: row.assignment_id,
      title: row.title,
      workType: row.work_type,
      opensAt,
      dueAt,
      currentVersion: row.current_version,
      enrolledStudents: row.enrolled_students,
    });
  }
  // Academic year descending, then name; assignments by due time, then title
  // (Croatian collation); the id breaks any tie, so the order never wavers.
  const collator = new Intl.Collator("hr");
  const list = [...courses.values()];
  for (const course of list) {
    course.assignments.sort((a, b) =>
      Date.parse(a.dueAt) - Date.parse(b.dueAt) || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : 1));
  }
  return list.sort((a, b) =>
    b.academicYear.localeCompare(a.academicYear) || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

export type TeacherCoursesRead =
  | { kind: "ok"; courses: TeacherCourse[] }
  | { kind: "unauthorized" | "not_found" | "unavailable" };

/**
 * The one read behind both the route and the server-rendered `/nastavnik`
 * (Z3 A): the same function, the same session, the same answer.
 */
export async function readTeacherCourses(sessionToken: string | undefined, withActor: WithActor): Promise<TeacherCoursesRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  let rows: Row[];
  try {
    const result = await withActor(sessionToken, (tx) =>
      tx.query<Row>(
        `SELECT course_id::text, course_name, academic_year, assignment_id::text, title, work_type,
                opens_at, due_at, current_version, enrolled_students
           FROM institution.list_teacher_courses()`,
      ),
    );
    rows = result.rows;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    if (code === "ZD403") return { kind: "not_found" };
    console.error("teacher courses read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const courses = coursesOf(rows);
  if (courses === null) {
    console.error("teacher courses read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", courses };
}

const STATUS = { unauthorized: 401, not_found: 404, unavailable: 503 } as const;

export async function handleTeacherCoursesRequest(request: Request, deps: TeacherCoursesDeps): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return refuse(405, "method_not_allowed");
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return refuse(403, "forbidden");
  const read = await readTeacherCourses(deps.sessionToken, deps.withActor);
  if (read.kind !== "ok") return refuse(STATUS[read.kind], read.kind);
  return Response.json({ courses: read.courses }, { status: 200, headers: NO_STORE });
}
