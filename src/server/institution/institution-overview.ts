import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-313 (M2.11-P01, contract on #1091, comment 6572435345): the overview of
 * an institution for its administrator (screen A-01). One read of
 * institution.institution_overview(): the caller and the institution come only
 * from the session token bound into withActor. Only a confirmed, unrevoked
 * administrator gets an answer; anyone else gets notFound, the same answer as
 * for an institution that does not exist. Anything but exactly one row of
 * non-negative integer counts makes the read unavailable, never a zero.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_NAME = 200;

export type InstitutionOverview = {
  /** The institution's display name; null when none is set. */
  institutionName: string | null;
  confirmedTeachers: number;
  teacherCandidates: number;
  teachersWithoutAffiliation: number;
  courses: number;
  students: number;
};

export type InstitutionOverviewRead =
  | { kind: "ok"; overview: InstitutionOverview }
  | { kind: "unauthorized" | "notFound" | "unavailable" };

type Row = Record<string, unknown>;

const QUERY = `SELECT institution_name, confirmed_teachers, teacher_candidates, teachers_without_affiliation,
  courses, students
  FROM institution.institution_overview()`;

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function nameOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value === "" || value.length > MAX_NAME
    || value !== value.trim() || CONTROL.test(value)) return undefined;
  return value;
}

/** The single row as an overview, or null when it is not what the function returns. */
export function overviewOf(rows: readonly Row[]): InstitutionOverview | null {
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  const institutionName = nameOf(row.institution_name);
  const { confirmed_teachers: confirmedTeachers, teacher_candidates: teacherCandidates,
    teachers_without_affiliation: teachersWithoutAffiliation, courses, students } = row;
  if (institutionName === undefined || !isCount(confirmedTeachers) || !isCount(teacherCandidates)
    || !isCount(teachersWithoutAffiliation) || !isCount(courses) || !isCount(students)) return null;
  // A teacher without affiliation is a confirmed teacher.
  if (teachersWithoutAffiliation > confirmedTeachers) return null;
  return { institutionName, confirmedTeachers, teacherCandidates, teachersWithoutAffiliation, courses, students };
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

export async function readInstitutionOverview(
  sessionToken: string | undefined,
  withActor: WithActor,
): Promise<InstitutionOverviewRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  let rows: Row[];
  try {
    rows = await withActor(sessionToken, async (tx) => (await tx.query<Row>(QUERY)).rows);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    if (code === "ZD403") return { kind: "notFound" };
    console.error("institution overview read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const overview = overviewOf(rows);
  if (overview === null) {
    console.error("institution overview read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", overview };
}
