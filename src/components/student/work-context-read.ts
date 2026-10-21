import type { WithActor } from "@/server/db/with-actor";
import type { WordRange } from "@/lib/i18n/length-line";

import { AI_PURPOSES } from "@/components/teacher/assignment-create";

import type { NoticeView } from "./assignment-notice-read";

// #476 contract 6280487079 (owner decision of 20 Oct): /rad names the course
// and the assignment only from what the student may read of it, never from
// invented data. Like readNotice (F-7), this reads the current version under
// RLS and only for a student; course_read also guards the course name. One
// SELECT gives the notice, its acknowledgment and the course the SAME statement
// snapshot even at READ COMMITTED; two SELECTs in one transaction would not.
// Publication after that snapshot is seen on the next read, not retroactively
// in an already rendered workspace. Nothing here writes, and the identity
// never comes from the browser. Any other outcome (no id, a malformed id, no
// session, no access, a failed read) shows no course and no assignment.
// PRODUCT §5 rule 6: the notice is the first screen of every assignment, so
// a current version the student has not acknowledged (never, or only an
// earlier version) is "noticeFirst" and /rad sends the student to the notice.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface Row {
  user_id: string | null;
  role: string | null;
  course_name: string | null;
  version_no: number | null;
  title: string;
  instructions: string;
  work_type: string;
  evidence_profile: "basic" | "extended";
  opens_at: Date;
  due_at: Date;
  ai_policy: string;
  ai_purposes: string[];
  word_min: number | null;
  word_max: number | null;
  acknowledged_at: Date | null;
}

// Keep the own-student and current-version predicates of readNotice. The
// existing actor/role functions are STABLE and RLS applies to every join.
const QUERY = `WITH me AS (SELECT app.current_user_id() AS user_id)
SELECT me.user_id, institution.actor_assignment_role(a.id) AS role, c.name AS course_name,
  v.version_no, v.title, v.instructions, v.work_type, v.evidence_profile,
  v.opens_at, v.due_at, v.ai_policy, v.ai_purposes, v.word_min, v.word_max,
  (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
    WHERE n.assignment_id = a.id AND n.version_no = a.current_version AND n.student_id = me.user_id) AS acknowledged_at
FROM me
LEFT JOIN institution.assignment a ON a.id = $1
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
LEFT JOIN institution.course c ON c.id = a.course_id`;

export type WorkContextRead =
  | {
      kind: "ready";
      /** institution.course.name */
      course: string;
      /** The current version of the assignment, as on its notice, acknowledged. */
      notice: NoticeView;
      /** Limits of that same acknowledged current version, if set. */
      wordRange: WordRange | null;
    }
  | { kind: "noticeFirst" }
  | { kind: "none" };

const NONE: WorkContextRead = { kind: "none" };

/** The assignment id of `/rad?zadatak=<id>`: one well-formed UUID, or null. */
export function assignmentParam(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

export async function readWorkContext(
  token: string | undefined,
  assignmentId: string | null,
  withActor: WithActor,
): Promise<WorkContextRead> {
  if (!token || !TOKEN.test(token) || assignmentId === null || !UUID.test(assignmentId)) return NONE;
  try {
    const row = await withActor(token, async (tx) =>
      (await tx.query<Row>(QUERY, [assignmentId])).rows[0]);
    if (!row?.user_id || row.role !== "student" || row.version_no === null) return NONE;
    if (row.acknowledged_at === null) return { kind: "noticeFirst" };
    if (typeof row.course_name !== "string") return NONE;
    return {
      kind: "ready",
      course: row.course_name,
      wordRange: row.word_min === null && row.word_max === null
        ? null : { min: row.word_min, max: row.word_max },
      notice: {
        assignmentId,
        versionNo: row.version_no,
        title: row.title,
        instructions: row.instructions,
        workType: row.work_type,
        evidenceProfile: row.evidence_profile,
        opensAt: row.opens_at.toISOString(),
        dueAt: row.due_at.toISOString(),
        aiPurposes: row.ai_policy === "prohibited"
          ? []
          : AI_PURPOSES.filter((p) => row.ai_purposes.includes(p)),
        acknowledgedAt: row.acknowledged_at.toISOString(),
      },
    };
  } catch {
    return NONE;
  }
}
