import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { compareByName, nameOf, type PersonName } from "./teacher-roles";

/**
 * DAN-313 (M2.11-P03, screen A-03; contract on #1091, comment 6692590206):
 * the courses of an institution in one academic year for its administrator,
 * and the academic years to choose from. Reads only: one call of
 * institution.institution_courses(year) or institution.institution_academic_years().
 * The caller and the institution come only from the session token bound into
 * withActor; only a confirmed, unrevoked administrator gets an answer, anyone
 * else gets notFound. No student's name or id, work or activity time is read.
 * Any row that is not what the function returns makes the whole read
 * unavailable, never a shorter list.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const YEAR = /^([0-9]{4})\/([0-9]{4})$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LABEL_MAX = 200;

export type CoursePerson = { personId: string; name: PersonName };

export type InstitutionGroup = {
  groupId: string;
  name: string;
  /** Open students of the group who are still open students of the course. */
  students: number;
  teachers: CoursePerson[];
};

export type InstitutionCourse = {
  courseId: string;
  name: string;
  students: number;
  holder: CoursePerson | null;
  team: CoursePerson[];
  groups: InstitutionGroup[];
};

export type InstitutionCoursesRead =
  | { kind: "ok"; academicYear: string; courses: InstitutionCourse[] }
  | { kind: "unauthorized" | "notFound" | "invalid" | "unavailable" };

export type AcademicYearsRead =
  | { kind: "ok"; years: string[] }
  | { kind: "unauthorized" | "notFound" | "unavailable" };

type Row = Record<string, unknown>;

const COURSES = `SELECT kind, course_id::text, course_name, group_id::text, group_name, user_id::text,
  given_name, family_name, students
  FROM institution.institution_courses($1)`;
const YEARS = "SELECT academic_year FROM institution.institution_academic_years()";

/** The form and the rule create_course requires: YYYY/YYYY, the second the year after the first. */
export function isAcademicYear(value: unknown): value is string {
  const m = typeof value === "string" ? YEAR.exec(value) : null;
  return m !== null && Number(m[2]) === Number(m[1]) + 1;
}

const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A course or group name as institution.is_plain_label stored it, counted in code points. */
function isLabel(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value) && [...value].length <= LABEL_MAX && !CONTROL.test(value);
}

const collator = new Intl.Collator("hr");
const byLabel = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Draft = Omit<InstitutionCourse, "groups"> & { groups: GroupDraft[]; teamIds: Set<string> };
type GroupDraft = InstitutionGroup & { courseId: string; teacherIds: Set<string> };

const NULLS = (row: Row, keys: readonly string[]) => keys.every((k) => row[k] === null);

/** The rows as courses, or null when any row is not what the function returns. */
export function institutionCoursesOf(rows: readonly Row[]): InstitutionCourse[] | null {
  const courses = new Map<string, Draft>();
  const groups = new Map<string, GroupDraft>();
  const names = new Map<string, PersonName>();
  // Courses and groups first, so the other rows may come in any order.
  for (const row of rows) {
    if (row.kind === "course") {
      const { course_id: id, course_name: name, students } = row;
      if (!isId(id) || courses.has(id) || !isLabel(name) || !isCount(students)
        || !NULLS(row, ["group_id", "group_name", "user_id", "given_name", "family_name"])) return null;
      courses.set(id, { courseId: id, name, students, holder: null, team: [], groups: [], teamIds: new Set() });
    } else if (row.kind === "group") {
      const { course_id: courseId, group_id: id, group_name: name, students } = row;
      if (!isId(courseId) || !isId(id) || groups.has(id) || !isLabel(name) || !isCount(students)
        || !NULLS(row, ["course_name", "user_id", "given_name", "family_name"])) return null;
      groups.set(id, { groupId: id, name, students, teachers: [], courseId, teacherIds: new Set() });
    } else if (!["holder", "team", "group_teacher"].includes(row.kind as string)) {
      return null;
    }
  }
  for (const group of groups.values()) {
    const course = courses.get(group.courseId);
    if (!course) return null;
    course.groups.push(group);
  }
  for (const row of rows) {
    if (row.kind === "course" || row.kind === "group") continue;
    const { course_id: courseId, user_id: personId } = row;
    const course = isId(courseId) ? courses.get(courseId) : undefined;
    const name = nameOf(row.given_name, row.family_name);
    if (!course || !isId(personId) || name === undefined
      || !NULLS(row, ["course_name", "group_name", "students"])) return null;
    // One person, one name pair in the institution.
    if (names.has(personId) && JSON.stringify(names.get(personId)) !== JSON.stringify(name)) return null;
    names.set(personId, name);
    const person = { personId, name };
    if (row.kind === "holder") {
      if (row.group_id !== null || course.holder !== null) return null;
      course.holder = person;
    } else if (row.kind === "team") {
      if (row.group_id !== null || course.teamIds.has(personId)) return null;
      course.teamIds.add(personId);
      course.team.push(person);
    } else {
      const group = isId(row.group_id) ? groups.get(row.group_id) : undefined;
      if (!group || group.courseId !== course.courseId || group.teacherIds.has(personId)) return null;
      group.teacherIds.add(personId);
      group.teachers.push(person);
    }
  }
  const result: InstitutionCourse[] = [];
  for (const course of courses.values()) {
    // A student is in at most one open group of a course.
    if (course.groups.reduce((sum, g) => sum + g.students, 0) > course.students) return null;
    // A group teacher is a team member.
    if (course.groups.some((g) => [...g.teacherIds].some((id) => !course.teamIds.has(id)))) return null;
    result.push({
      courseId: course.courseId, name: course.name, students: course.students, holder: course.holder,
      team: course.team.sort(compareByName),
      groups: course.groups
        .map(({ groupId, name, students, teachers }) => ({ groupId, name, students, teachers: teachers.sort(compareByName) }))
        .sort((a, b) => byLabel({ name: a.name, id: a.groupId }, { name: b.name, id: b.groupId })),
    });
  }
  return result.sort((a, b) => byLabel({ name: a.name, id: a.courseId }, { name: b.name, id: b.courseId }));
}

/** The years, newest first, or null when any row is not a distinct academic year. */
export function academicYearsOf(rows: readonly Row[]): string[] | null {
  const years = rows.map((r) => r.academic_year);
  if (!years.every(isAcademicYear) || new Set(years).size !== years.length) return null;
  return [...years].sort().reverse();
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

async function read<T>(
  /** A constant log message, never built from input. */
  failure: string,
  sessionToken: string,
  withActor: WithActor,
  query: (tx: ActorTransaction) => Promise<Row[]>,
  parse: (rows: Row[]) => T | null,
): Promise<{ kind: "ok"; value: T } | { kind: "unauthorized" | "notFound" | "invalid" | "unavailable" }> {
  let rows: Row[];
  try {
    rows = await withActor(sessionToken, query);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    if (code === "ZD403") return { kind: "notFound" };
    if (code === "ZD422") return { kind: "invalid" };
    console.error(failure, code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const value = parse(rows);
  if (value === null) {
    console.error(failure, "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", value };
}

export async function readInstitutionCourses(
  sessionToken: string | undefined,
  academicYear: unknown,
  withActor: WithActor,
): Promise<InstitutionCoursesRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  if (!isAcademicYear(academicYear)) return { kind: "invalid" };
  const answer = await read("institution courses read failed", sessionToken, withActor,
    async (tx) => (await tx.query<Row>(COURSES, [academicYear])).rows, institutionCoursesOf);
  return answer.kind === "ok" ? { kind: "ok", academicYear, courses: answer.value } : answer;
}

export async function readAcademicYears(sessionToken: string | undefined, withActor: WithActor): Promise<AcademicYearsRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  const answer = await read("academic years read failed", sessionToken, withActor,
    async (tx) => (await tx.query<Row>(YEARS)).rows, academicYearsOf);
  if (answer.kind === "ok") return { kind: "ok", years: answer.value };
  // The years take no input; a ZD422 here is not what the function raises.
  const { kind } = answer;
  if (kind === "invalid") {
    console.error("academic years read failed", "ZD422");
    return { kind: "unavailable" };
  }
  return { kind };
}
