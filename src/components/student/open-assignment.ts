import type { WithActor } from "@/server/db/with-actor";

// FE-D4 (#476 row 4, PRODUCT §5 rule 6): after the enrollment the student
// goes straight to the notice of the course's open assignment. The #314
// enrollment route answers only `{courseId}`, so the assignment is read here,
// on the server, under the session principal: RLS (assignment_read,
// assignment_version_read) decides what a student may see, and nothing here
// writes. The query always returns at least one row, so a closed session (no
// current user) is told apart from a course the account is not a student of.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OpenAssignmentRead =
  | { kind: "assignment"; assignmentId: string }
  | { kind: "none" | "signedOut" | "notFound" | "unavailable" };

export interface AssignmentWindow {
  id: string;
  opensAt: Date;
  dueAt: Date;
}

/**
 * The assignment the student is sent to: the one with the nearest due date
 * among those not yet past it, so an assignment that opens later still shows
 * its notice first. Ties go to the earlier opening, then the id, so the choice
 * never depends on row order. Null when every assignment is past its due date.
 */
export function pickOpenAssignment(rows: readonly AssignmentWindow[], now: Date): string | null {
  const open = rows.filter((row) => row.dueAt.getTime() > now.getTime());
  open.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.opensAt.getTime() - b.opensAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return open[0]?.id ?? null;
}

/** Where the enrollment form goes with the course from the enrollment reply. */
export function courseHref(courseId: string): string {
  return `/upis/kolegij/${encodeURIComponent(courseId)}`;
}

interface Row {
  user_id: string | null;
  role: string | null;
  now: Date;
  id: string | null;
  opens_at: Date | null;
  due_at: Date | null;
}

const QUERY = `WITH me AS (SELECT app.current_user_id() AS user_id, now() AS now)
SELECT me.user_id, institution.actor_course_role($1::uuid) AS role, me.now, a.id, v.opens_at, v.due_at
FROM me
LEFT JOIN institution.assignment a ON a.course_id = $1::uuid
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

export async function readOpenAssignment(
  token: string | undefined, courseId: string, withActor: WithActor,
): Promise<OpenAssignmentRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  if (!UUID.test(courseId)) return { kind: "notFound" };
  try {
    const rows = await withActor(token, async (tx) => (await tx.query<Row>(QUERY, [courseId])).rows);
    const first = rows[0];
    if (!first?.user_id) return { kind: "signedOut" };
    // Only a student of the course is sent to a notice; anyone else sees none.
    if (first.role !== "student") return { kind: "notFound" };
    const windows = rows.flatMap((row) =>
      row.id && row.opens_at && row.due_at ? [{ id: row.id, opensAt: row.opens_at, dueAt: row.due_at }] : []);
    const id = pickOpenAssignment(windows, first.now);
    return id ? { kind: "assignment", assignmentId: id } : { kind: "none" };
  } catch {
    return { kind: "unavailable" };
  }
}
