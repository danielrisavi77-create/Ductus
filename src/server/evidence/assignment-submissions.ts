import { isDocumentId } from "@/domain/collaboration";
import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-332 (contract on #826, c.6420660650), R1: the submissions of an
 * assignment for its teacher, with the work each row links to. Who asks comes
 * only from the session cookie bound into withActor; the database decides who
 * gets rows (app.assignment_submissions and app.assignment_works, both for the
 * assignment's teacher only, one row per student with an open membership).
 * Every other caller gets the same empty list. Nothing here writes, and the
 * answer names no text, name, exact time, deadline, hash or submission id.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGITS = /^[0-9]{1,16}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const NO_STORE = { "cache-control": "no-store" };

export interface AssignmentSubmission {
  studentId: string;
  /** The student's work, null while there is none. */
  documentId: string | null;
  submitted: boolean;
  /** These three are null exactly when submitted is false. */
  revision: number | null;
  /** ISO UTC, always on a whole minute. */
  requestedMinute: string | null;
  afterDeadline: boolean | null;
}

export type AssignmentSubmissionsByAssignment =
  | { kind: "ok"; submissions: ReadonlyMap<string, AssignmentSubmission[]> }
  | { kind: "unauthorized" | "unavailable" };

type Row = Record<string, unknown>;

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** One row as the contract's submission, or null when it is not what the functions return. */
export function submissionOf(row: Row): AssignmentSubmission | null {
  const { student_id: studentId, document_id: documentId, submitted } = row;
  if (typeof studentId !== "string" || !UUID.test(studentId)) return null;
  if (documentId !== null && !isDocumentId(documentId)) return null;
  if (submitted === false) {
    if (row.revision !== null || row.requested_minute !== null || row.after_deadline !== null) return null;
    return { studentId, documentId, submitted, revision: null, requestedMinute: null, afterDeadline: null };
  }
  if (submitted !== true || typeof row.after_deadline !== "boolean") return null;
  // int8 travels as text: only a safe integer is a revision.
  const revision = typeof row.revision === "string" && DIGITS.test(row.revision) ? Number(row.revision) : NaN;
  const minute = row.requested_minute;
  if (!Number.isSafeInteger(revision) || !(minute instanceof Date) || !Number.isFinite(minute.getTime())
    || minute.getTime() % 60_000 !== 0) return null;
  return {
    studentId, documentId, submitted, revision, requestedMinute: minute.toISOString(), afterDeadline: row.after_deadline,
  };
}

// Both functions decide the teacher on every call; one statement, one snapshot.
const SQL = `SELECT a.id::text AS assignment_id, x.*
  FROM unnest($1::uuid[]) WITH ORDINALITY AS a (id, n)
  CROSS JOIN LATERAL (
    SELECT s.student_id::text AS student_id, w.document_id, s.submitted, s.revision::text AS revision,
           s.requested_minute, s.after_deadline
      FROM app.assignment_submissions(a.id) s
      LEFT JOIN app.assignment_works(a.id) w ON w.student_id = s.student_id
  ) x
 ORDER BY a.n, x.student_id::uuid`;

/**
 * The submissions of many assignments in one transaction and one statement
 * (as F-142), for the teacher's server-rendered pages. Malformed ids are left
 * out and map to no entry. A failure, or any row it cannot vouch for, answers
 * for the whole read: never "not submitted" in place of an unknown.
 */
export async function readAssignmentSubmissionsMany(
  sessionToken: string | undefined,
  assignmentIds: readonly string[],
  withActor: WithActor,
): Promise<AssignmentSubmissionsByAssignment> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  const ids = [...new Set(assignmentIds.map((id) => id.toLowerCase()).filter((id) => UUID.test(id)))];
  const submissions = new Map<string, AssignmentSubmission[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return { kind: "ok", submissions };
  let rows: Row[];
  try {
    rows = (await withActor(sessionToken, (tx) => tx.query<Row>(SQL, [ids]))).rows;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    console.error("assignment submissions read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  for (const row of rows) {
    const list = typeof row.assignment_id === "string" ? submissions.get(row.assignment_id) : undefined;
    const submission = submissionOf(row);
    // A second row for a student would mean a second work: no answer rather than a guess.
    if (list === undefined || submission === null || list.some((s) => s.studentId === submission.studentId)) {
      console.error("assignment submissions read failed", "row_malformed");
      return { kind: "unavailable" };
    }
    list.push(submission);
  }
  return { kind: "ok", submissions };
}

export type AssignmentSubmissionsRead =
  | { kind: "ok"; submissions: AssignmentSubmission[] }
  | { kind: "unauthorized" | "unavailable" };

/** One assignment; a malformed id is the same empty list as any refusal, without asking. */
export async function readAssignmentSubmissions(
  sessionToken: string | undefined,
  assignmentId: string,
  withActor: WithActor,
): Promise<AssignmentSubmissionsRead> {
  const read = await readAssignmentSubmissionsMany(sessionToken, [assignmentId], withActor);
  if (read.kind !== "ok") return read;
  return { kind: "ok", submissions: read.submissions.get(assignmentId.toLowerCase()) ?? [] };
}

export interface AssignmentSubmissionsDeps {
  withActor: WithActor;
  sessionToken?: string;
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

const STATUS = { unauthorized: 401, unavailable: 503 } as const;

/** GET /api/teacher/assignments/[assignmentId]/submissions. Writes nothing, so no mutation guard. */
export async function handleAssignmentSubmissionsRequest(
  request: Request,
  assignmentId: string,
  deps: AssignmentSubmissionsDeps,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return refuse(405, "method_not_allowed");
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return refuse(403, "forbidden");
  const read = await readAssignmentSubmissions(deps.sessionToken, assignmentId, deps.withActor);
  if (read.kind !== "ok") return refuse(STATUS[read.kind], read.kind);
  return Response.json({ submissions: read.submissions }, { status: 200, headers: NO_STORE });
}
