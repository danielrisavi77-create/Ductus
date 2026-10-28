import type { WithActor } from "@/server/db/with-actor";

/**
 * #711 step B1 (owner decision B, 25 Oct): the document `/rad?zadatak=<id>`
 * writes into is the student's own work for that assignment, not a fixed id.
 * This read answers which document that is for the session, when the session
 * may write into it now. It runs one SELECT under the web role's RLS (own
 * projects, documents and packages; the assignment and its acknowledgment as
 * readWorkContext reads them) and writes nothing: only `POST /api/evidence/open`
 * (`app.open_student_work`, idempotent) creates the work.
 *
 * The conditions are those of `app.open_student_work`: an active student of
 * the assignment (`actor_assignment_role`, active membership), the current
 * version acknowledged, the assignment open, and the work's first document
 * with a package, in the same order. Identity is never an argument. Anyone
 * who is not an active student, an unknown or another institution's
 * assignment, and a failed read all get the same "none".
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type WorkDocumentRead =
  /** The session's own work for the assignment, the id the evidence path uses. */
  | { kind: "document"; documentId: string }
  /** The session may write, but its work does not exist yet: open it through POST /api/evidence/open. */
  | { kind: "notOpened" }
  /** An active student, but the current version is not acknowledged or not open yet. */
  | { kind: "notAccepting" }
  | { kind: "none" };

interface Row {
  user_id: string | null;
  role: string | null;
  version_no: number | null;
  open: boolean | null;
  acknowledged: boolean | null;
  document_id: string | null;
}

export const WORK_DOCUMENT_SQL = `WITH me AS (
  SELECT app.current_user_id() AS user_id, app.current_institution_id() AS institution_id)
SELECT me.user_id, institution.actor_assignment_role(a.id) AS role, v.version_no,
  v.opens_at <= pg_catalog.clock_timestamp() AS open,
  EXISTS (SELECT 1 FROM institution.notice_acknowledgment n
           WHERE n.assignment_id = a.id AND n.version_no = a.current_version
             AND n.student_id = me.user_id AND n.institution_id = me.institution_id) AS acknowledged,
  (SELECT d.id FROM evidence.project p
     JOIN evidence.document d
       ON d.project_id = p.id AND d.institution_id = p.institution_id AND d.principal_id = p.principal_id
     JOIN evidence.package k
       ON k.document_id = d.id AND k.institution_id = d.institution_id AND k.principal_id = d.principal_id
    WHERE p.assignment_id = a.id AND p.institution_id = me.institution_id AND p.principal_id = me.user_id
    ORDER BY d.created_at, d.id, k.created_at, k.id
    LIMIT 1) AS document_id
FROM me
LEFT JOIN institution.assignment a ON a.id = $1 AND a.institution_id = me.institution_id
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

const NONE: WorkDocumentRead = { kind: "none" };

export async function readWorkDocument(
  token: string | undefined,
  assignmentId: string | null,
  withActor: WithActor,
): Promise<WorkDocumentRead> {
  if (!token || !TOKEN.test(token) || assignmentId === null || !UUID.test(assignmentId)) return NONE;
  try {
    const row = await withActor(token, async (tx) =>
      (await tx.query<Row>(WORK_DOCUMENT_SQL, [assignmentId])).rows[0]);
    if (!row?.user_id || row.role !== "student" || row.version_no === null) return NONE;
    if (row.acknowledged !== true || row.open !== true) return { kind: "notAccepting" };
    if (typeof row.document_id === "string" && row.document_id !== "") {
      return { kind: "document", documentId: row.document_id };
    }
    return { kind: "notOpened" };
  } catch {
    return NONE;
  }
}
