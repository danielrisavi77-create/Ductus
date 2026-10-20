import type { WithActor } from "@/server/db/with-actor";

import { readNotice, type NoticeView } from "./assignment-notice-read";

// #476 contract 6280487079 (owner decision of 20 Oct): /rad names the course
// and the assignment only from what the student may read of it, never from
// invented data. The notice read (F-7) gives the current version under RLS
// and only to a student of the course; the course name follows from the same
// session under the course_read policy. Nothing here writes, and the identity
// never comes from the browser. Any other outcome (no id, a malformed id, no
// session, no access, a failed read) shows no course and no assignment.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COURSE = `SELECT c.name FROM institution.assignment a
JOIN institution.course c ON c.id = a.course_id
WHERE a.id = $1`;

export interface WorkContext {
  /** institution.course.name */
  course: string;
  /** The current version of the assignment, as on its notice. */
  notice: NoticeView;
}

/** The assignment id of `/rad?zadatak=<id>`: one well-formed UUID, or null. */
export function assignmentParam(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

export async function readWorkContext(
  token: string | undefined,
  assignmentId: string | null,
  withActor: WithActor,
): Promise<WorkContext | null> {
  if (assignmentId === null || token === undefined) return null;
  const notice = await readNotice(token, assignmentId, withActor);
  if (notice.kind !== "available") return null;
  try {
    const row = await withActor(token, async (tx) =>
      (await tx.query<{ name: string }>(COURSE, [assignmentId])).rows[0]);
    return row ? { course: row.name, notice: notice.view } : null;
  } catch {
    return null;
  }
}
