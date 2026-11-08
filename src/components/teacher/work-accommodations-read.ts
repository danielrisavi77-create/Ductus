import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-380 (M2.9-P02; contract on #1091, c.6725196643): which works on the
 * teacher's page carry an approved accommodation (D-50). Only through
 * institution.work_accommodation() from #1728, under the session cookie: the
 * database answers true or false for a teacher or mentor of the work and null
 * for anyone else. The mark is a yes or no and nothing else; no reason, kind
 * or note exists to be read, and no log line here carries a value or an id.
 *
 * One statement in one transaction for every pair (F-142). An answer that
 * cannot be vouched for, row by row, answers for the whole read: never "not
 * marked" in place of an unknown.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

export interface WorkPair {
  assignmentId: string;
  studentId: string;
}

/** Per asked assignment id (lower case): the students whose work on it is marked. */
export type WorkAccommodationsRead =
  | { kind: "ok"; marked: Readonly<Record<string, readonly string[]>> }
  | { kind: "unavailable" };

const SQL = `SELECT p.a::text AS assignment_id, p.s::text AS student_id,
       institution.work_accommodation(p.a, p.s) AS marked
  FROM unnest($1::uuid[], $2::uuid[]) AS p (a, s)`;

function fail(reason: string): { kind: "unavailable" } {
  console.error("work accommodations read failed", reason);
  return { kind: "unavailable" };
}

export async function readWorkAccommodationsMany(
  sessionToken: string | undefined,
  pairs: readonly WorkPair[],
  withActor: WithActor,
): Promise<WorkAccommodationsRead> {
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return { kind: "unavailable" };
  const asked = new Map<string, WorkPair>();
  for (const pair of pairs) {
    const assignmentId = pair.assignmentId.toLowerCase();
    const studentId = pair.studentId.toLowerCase();
    if (UUID.test(assignmentId) && UUID.test(studentId)) asked.set(`${assignmentId} ${studentId}`, { assignmentId, studentId });
  }
  if (asked.size === 0) return { kind: "ok", marked: {} };
  const list = [...asked.values()];
  let rows: Record<string, unknown>[];
  try {
    rows = (await withActor(sessionToken, (tx) => tx.query<Record<string, unknown>>(SQL, [
      list.map((pair) => pair.assignmentId), list.map((pair) => pair.studentId),
    ]))).rows;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return fail(typeof code === "string" && SQLSTATE.test(code) ? code : "unknown");
  }
  const marked: Record<string, string[]> = Object.fromEntries(list.map(({ assignmentId }) => [assignmentId, []]));
  const answered = new Set<string>();
  for (const row of rows) {
    const { assignment_id: assignmentId, student_id: studentId, marked: value } = row;
    const key = `${String(assignmentId)} ${String(studentId)}`;
    if (typeof assignmentId !== "string" || typeof studentId !== "string" || !asked.has(key) || answered.has(key)
      || (value !== null && typeof value !== "boolean")) return fail("row_malformed");
    answered.add(key);
    if (value === true) marked[assignmentId].push(studentId);
  }
  // Every pair has its row: a missing one is an unknown, not "not marked".
  if (answered.size !== asked.size) return fail("row_missing");
  return { kind: "ok", marked };
}
