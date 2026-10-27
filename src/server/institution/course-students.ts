import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-344 R-2 (#923, contract c.6434766713 point 2; D-170 as amended on #87):
 * the students of one course with their name pair, for the course's teacher
 * page (T02). Who asks comes only from the session cookie bound into
 * withActor; app.teacher_course_students decides on every call who gets rows
 * (the course's teacher only, one row per open student membership). Every
 * other caller gets the same empty list. Nothing here writes, and nothing of
 * a work is read.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NAME_MAX = 255;

export interface NamedStudent {
  studentId: string;
  /** Both null when the account has no name pair (#757 D1); never a stand-in. */
  givenName: string | null;
  familyName: string | null;
}

export type NamedStudentsRead =
  | { kind: "ok"; students: NamedStudent[] }
  | { kind: "unauthorized" | "unavailable" };

type Row = Record<string, unknown>;

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function isName(value: unknown): value is string {
  // Code points, as length() in the database counts (F-149).
  return typeof value === "string" && value.length >= 1 && [...value].length <= NAME_MAX;
}

/** One row as a named student, or null when it is not what the functions return. */
export function namedStudentOf(row: Row): NamedStudent | null {
  const { student_id: studentId, given_name: givenName, family_name: familyName } = row;
  if (typeof studentId !== "string" || !UUID.test(studentId)) return null;
  if (isName(givenName) && isName(familyName)) return { studentId, givenName, familyName };
  if (givenName === null && familyName === null) return { studentId, givenName: null, familyName: null };
  return null;
}

/**
 * Runs one list function for one id inside withActor and parses every row.
 * A malformed id is the same empty list as any refusal, without asking. A
 * failure, or any row it cannot vouch for, answers for the whole read: never
 * a partial list.
 */
export async function readNamedStudents(
  sessionToken: string | undefined,
  withActor: WithActor,
  id: string,
  sql: string,
  label: string,
): Promise<NamedStudentsRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  const key = id.toLowerCase();
  if (!UUID.test(key)) return { kind: "ok", students: [] };
  let rows: Row[];
  try {
    rows = (await withActor(sessionToken, (tx) => tx.query<Row>(sql, [key]))).rows;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    console.error(`${label} read failed`, code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const students: NamedStudent[] = [];
  for (const row of rows) {
    const student = namedStudentOf(row);
    // A second row for a student would mean a second membership: no answer rather than a guess.
    if (student === null || students.some((s) => s.studentId === student.studentId)) {
      console.error(`${label} read failed`, "row_malformed");
      return { kind: "unavailable" };
    }
    students.push(student);
  }
  return { kind: "ok", students };
}

const SQL =
  "SELECT student_id::text AS student_id, given_name, family_name FROM app.teacher_course_students($1::uuid)";

/** The students of one course for its teacher (T02, tab "Studenti"). */
export function readCourseStudents(
  sessionToken: string | undefined,
  withActor: WithActor,
  courseId: string,
): Promise<NamedStudentsRead> {
  return readNamedStudents(sessionToken, withActor, courseId, SQL, "course students");
}
