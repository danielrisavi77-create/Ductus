import { parseWorkLanguage, type WorkLanguage } from "@/domain/assignment/work-language";
import { isDocumentId } from "@/domain/collaboration";
import type { WithActor } from "@/server/db/with-actor";

// DAN-386 (M2.10-P02d, contract on #1836 c.6858305983): what the page for
// one work's language shows a teacher, keyed by the assignment and the
// work's document id. After the session check, one statement reads the
// work's student, its language, the assignment's and the exception, so they
// come from one snapshot. institution.work_language() answers null
// for anyone but the student and a teacher of the work; that and a missing
// or someone else's assignment read alike. The POST route and its RPC
// decide again who may change it. A row the three values do not explain is
// unavailable, never a guess.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkLanguageExceptionRead =
  | {
    kind: "available";
    assignmentId: string;
    documentId: string;
    title: string;
    assignmentLanguage: WorkLanguage;
    /** The work's own language, or null when it follows the assignment. */
    exception: WorkLanguage | null;
  }
  | { kind: "signedOut" | "notFound" | "unavailable" };

interface Me {
  user_id: string | null;
}

interface Row {
  student_id: unknown;
  language: unknown;
  assignment_language: unknown;
  exception: unknown;
  title: unknown;
}

const ME = "SELECT app.current_user_id() AS user_id";

// app.assignment_works() gives a teacher of the assignment the student of each
// work; the student id is checked here and never leaves the server.
const QUERY = `WITH w AS (SELECT x.student_id FROM app.assignment_works($1::uuid) x WHERE x.document_id = $2)
SELECT w.student_id::text AS student_id, institution.work_language($1::uuid, w.student_id) AS language,
  v.work_language AS assignment_language, v.title,
  (SELECT o.work_language FROM institution.work_language_override o
    WHERE o.assignment_id = a.id AND o.student_id = w.student_id) AS exception
FROM w
LEFT JOIN institution.assignment a ON a.id = $1::uuid
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

export async function readWorkLanguageException(
  token: string | undefined, assignmentId: string, documentId: string, withActor: WithActor,
): Promise<WorkLanguageExceptionRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  if (!UUID.test(assignmentId) || !isDocumentId(documentId)) return { kind: "notFound" };
  const a = assignmentId.toLowerCase();
  let read: { me: Me | undefined; rows: Row[] };
  try {
    read = await withActor(token, async (tx) => {
      const me = (await tx.query<Me>(ME)).rows[0];
      // Without a live session assignment_works() refuses; ask it nothing.
      if (!me?.user_id) return { me, rows: [] };
      return { me, rows: (await tx.query<Row>(QUERY, [a, documentId])).rows };
    });
  } catch {
    console.error("work language exception read failed");
    return { kind: "unavailable" };
  }
  if (!read.me?.user_id) return { kind: "signedOut" };
  // A document id names one work; anything else is not explained by the read.
  if (read.rows.length > 1) return { kind: "unavailable" };
  const row = read.rows[0];
  if (row === undefined || row.language === null) return { kind: "notFound" };
  const studentId = typeof row.student_id === "string" ? row.student_id.toLowerCase() : "";
  const language = parseWorkLanguage(row.language);
  const assignmentLanguage = parseWorkLanguage(row.assignment_language);
  const exception = row.exception === null ? null : parseWorkLanguage(row.exception);
  if (!UUID.test(studentId) || language === null || assignmentLanguage === null || (row.exception !== null && exception === null)
    || (exception ?? assignmentLanguage) !== language || typeof row.title !== "string") {
    return { kind: "unavailable" };
  }
  return { kind: "available", assignmentId: a, documentId, title: row.title, assignmentLanguage, exception };
}
