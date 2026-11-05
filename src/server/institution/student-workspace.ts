import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-309 (M2.3-P01, contract on #1091, comment 6569706023): the student's
 * workspace ("Moji radovi"). One read of app.student_workspace() under the
 * session's RLS. Who asks comes only from the session token bound into
 * withActor; the database decides which assignments, and beside each only the
 * caller's own work and submission. The DTO names no other person and carries
 * no text. Any row that is not what the function returns (a malformed value,
 * a second row for one assignment, a submitted revision past the server's)
 * makes the whole read unavailable, never a partial or invented list.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACADEMIC_YEAR = /^[0-9]{4}\/[0-9]{4}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
/** int8 travels as text: only a safe non-negative integer is a revision. */
const DIGITS = /^(0|[1-9][0-9]{0,15})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export type StudentWorkspaceItem = {
  assignmentId: string;
  courseId: string;
  courseName: string;
  academicYear: string;
  title: string;
  opensAt: string;
  dueAt: string;
  currentVersion: number;
  /** The notice of the current version is acknowledged. */
  acknowledged: boolean;
  /** The caller's own work on the assignment; null before it is started. */
  documentId: string | null;
  serverRevision: number | null;
  submittedRevision: number | null;
  submittedAt: string | null;
  afterDeadline: boolean | null;
};

export type StudentWorkspaceRead =
  | { kind: "ok"; items: StudentWorkspaceItem[] }
  | { kind: "unauthorized" | "unavailable" };

type Row = Record<string, unknown>;

const QUERY = `SELECT assignment_id::text, course_id::text, course_name, academic_year, title, opens_at, due_at,
  current_version, acknowledged, document_id, server_revision::text, submitted_revision::text, submitted_at,
  after_deadline
  FROM app.student_workspace()`;

function instant(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function revision(value: unknown): number | null {
  const n = typeof value === "string" && DIGITS.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

function documentIdOf(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 256
    || value !== value.trim() || CONTROL.test(value)) return undefined;
  return value;
}

/** One row as an item, or null when it is not what the function returns. */
function itemOf(row: Row): StudentWorkspaceItem | null {
  const { assignment_id: assignmentId, course_id: courseId, course_name: courseName,
    academic_year: academicYear, title, current_version: currentVersion, acknowledged } = row;
  const opensAt = instant(row.opens_at);
  const dueAt = instant(row.due_at);
  if (typeof assignmentId !== "string" || !UUID.test(assignmentId)
    || typeof courseId !== "string" || !UUID.test(courseId)
    || !isText(courseName) || typeof academicYear !== "string" || !ACADEMIC_YEAR.test(academicYear)
    || !isText(title) || opensAt === null || dueAt === null
    || !Number.isSafeInteger(currentVersion) || (currentVersion as number) < 1
    || typeof acknowledged !== "boolean") return null;

  const documentId = documentIdOf(row.document_id);
  if (documentId === undefined) return null;
  const serverRevision = documentId === null ? null : revision(row.server_revision);
  if (documentId === null ? row.server_revision !== null : serverRevision === null) return null;

  const base = { assignmentId, courseId, courseName, academicYear, title, opensAt, dueAt,
    currentVersion: currentVersion as number, acknowledged, documentId, serverRevision };
  if (row.submitted_revision === null && row.submitted_at === null && row.after_deadline === null) {
    return { ...base, submittedRevision: null, submittedAt: null, afterDeadline: null };
  }
  // A submission is of the caller's own work, at a revision the server holds.
  const submittedRevision = revision(row.submitted_revision);
  const submittedAt = instant(row.submitted_at);
  if (submittedRevision === null || submittedAt === null || typeof row.after_deadline !== "boolean"
    || serverRevision === null || submittedRevision > serverRevision) return null;
  return { ...base, submittedRevision, submittedAt, afterDeadline: row.after_deadline };
}

/** The rows as items, or null when any row is malformed or an assignment repeats. */
export function itemsOf(rows: readonly Row[]): StudentWorkspaceItem[] | null {
  const items = new Map<string, StudentWorkspaceItem>();
  const courses = new Map<string, string>();
  for (const row of rows) {
    const item = itemOf(row);
    if (item === null || items.has(item.assignmentId)) return null;
    const course = JSON.stringify([item.courseName, item.academicYear]);
    if ((courses.get(item.courseId) ?? course) !== course) return null;
    courses.set(item.courseId, course);
    items.set(item.assignmentId, item);
  }
  // By due time, then course and title (Croatian collation); the id breaks any
  // tie, so the order never wavers.
  const collator = new Intl.Collator("hr");
  return [...items.values()].sort((a, b) =>
    Date.parse(a.dueAt) - Date.parse(b.dueAt) || collator.compare(a.courseName, b.courseName)
    || collator.compare(a.title, b.title) || (a.assignmentId < b.assignmentId ? -1 : 1));
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

export async function readStudentWorkspace(
  sessionToken: string | undefined,
  withActor: WithActor,
): Promise<StudentWorkspaceRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  let rows: Row[];
  try {
    rows = await withActor(sessionToken, async (tx) => (await tx.query<Row>(QUERY)).rows);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    console.error("student workspace read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const items = itemsOf(rows);
  if (items === null) {
    console.error("student workspace read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", items };
}
