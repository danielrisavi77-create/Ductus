import type { WithActor } from "@/server/db/with-actor";

import { AI_PURPOSES, type AiPurpose } from "@/components/teacher/assignment-create";

// F-7 (#336): the S3 notice is read on the server under the session
// principal. RLS (assignment_read, assignment_version_read and the own-row
// notice_acknowledgment_read) decides what a student may see; nothing here
// writes, and the identity never comes from the browser. The query always
// returns one row, so a closed or expired session (no current user) is told
// apart from a student without access to the assignment.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NoticeView {
  assignmentId: string;
  versionNo: number;
  title: string;
  instructions: string;
  /** Any work type the server accepts, not only those the teacher form offers. */
  workType: string;
  /** D-05: "extended" adds version comparisons to what the teacher sees. */
  evidenceProfile: "basic" | "extended";
  opensAt: string;
  dueAt: string;
  aiPurposes: AiPurpose[];
  /** Server time of the student's acknowledgment of this version, or null. */
  acknowledgedAt: string | null;
}

export type NoticeRead =
  | { kind: "available"; view: NoticeView }
  | { kind: "signedOut" | "notFound" | "unavailable" };

interface Row {
  user_id: string | null;
  role: string | null;
  version_no: number;
  title: string;
  instructions: string;
  work_type: string;
  evidence_profile: "basic" | "extended";
  opens_at: Date;
  due_at: Date;
  ai_policy: string;
  ai_purposes: string[];
  acknowledged_at: Date | null;
}

const QUERY = `WITH me AS (SELECT app.current_user_id() AS user_id)
SELECT me.user_id, institution.actor_assignment_role(a.id) AS role, v.version_no, v.title, v.instructions,
  v.work_type, v.evidence_profile, v.opens_at, v.due_at, v.ai_policy, v.ai_purposes,
  (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
    WHERE n.assignment_id = a.id AND n.version_no = a.current_version AND n.student_id = me.user_id) AS acknowledged_at
FROM me
LEFT JOIN institution.assignment a ON a.id = $1
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

export async function readNotice(token: string | undefined, assignmentId: string, withActor: WithActor): Promise<NoticeRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  if (!UUID.test(assignmentId)) return { kind: "notFound" };
  try {
    const row = await withActor(token, async (tx) => (await tx.query<Row>(QUERY, [assignmentId])).rows[0]);
    if (!row?.user_id) return { kind: "signedOut" };
    // Only a student of the course acknowledges; anyone else sees no notice.
    if (row.role !== "student") return { kind: "notFound" };
    return {
      kind: "available",
      view: {
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
        acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
