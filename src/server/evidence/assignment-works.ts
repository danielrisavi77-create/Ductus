import type { WithActor } from "@/server/db/with-actor";

/**
 * F-113 decision B, step B2 (#711, contract c.6390760491): the works of one
 * assignment for its teacher, for the server-rendered teacher pages. Who asks
 * comes only from the session cookie bound into withActor; the database
 * decides who gets rows (app.assignment_works): the teacher of the assignment,
 * and only students with an open membership of its course. Every other caller
 * gets the same empty list. Nothing here writes, and the answer names no text,
 * time or name, only which document is whose.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

export interface AssignmentWork {
  studentId: string;
  documentId: string;
}

export type AssignmentWorksRead =
  | { kind: "ok"; works: AssignmentWork[] }
  | { kind: "unauthorized" | "unavailable" };

type Row = Record<string, unknown>;

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** A document id as `evidence.document` allows it: 1 to 256 characters, trimmed, no control characters. */
function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

/** The rows as works, or null when any row is not what the function returns. */
export function worksOf(rows: readonly Row[]): AssignmentWork[] | null {
  const works: AssignmentWork[] = [];
  for (const row of rows) {
    if (typeof row.student_id !== "string" || !UUID.test(row.student_id) || !isDocumentId(row.document_id)) return null;
    works.push({ studentId: row.student_id, documentId: row.document_id });
  }
  return works;
}

export async function readAssignmentWorks(
  sessionToken: string | undefined,
  assignmentId: string | null,
  withActor: WithActor,
): Promise<AssignmentWorksRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unauthorized" };
  // A malformed id names no assignment: the same empty list as any other.
  if (assignmentId === null || !UUID.test(assignmentId.toLowerCase())) return { kind: "ok", works: [] };
  let rows: Row[];
  try {
    const result = await withActor(sessionToken, (tx) =>
      tx.query<Row>("SELECT student_id::text, document_id FROM app.assignment_works($1::uuid)", [assignmentId]),
    );
    rows = result.rows;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ZD401") return { kind: "unauthorized" };
    console.error("assignment works read failed", code !== undefined && SQLSTATE.test(code) ? code : "unknown");
    return { kind: "unavailable" };
  }
  const works = worksOf(rows);
  if (works === null) {
    console.error("assignment works read failed", "row_malformed");
    return { kind: "unavailable" };
  }
  return { kind: "ok", works };
}
