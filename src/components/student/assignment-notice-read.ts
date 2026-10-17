import type { WithActor } from "@/server/db/with-actor";

import { AI_PURPOSES, type AiPurpose, type WorkType } from "@/components/teacher/assignment-create";

// F-7 (#336): the S3 notice is read on the server under the session
// principal. RLS (assignment_read, assignment_version_read and the own-row
// notice_acknowledgment_read) decides what a student may see; nothing here
// writes, and the identity never comes from the browser.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NoticeView {
  assignmentId: string;
  versionNo: number;
  title: string;
  instructions: string;
  workType: WorkType;
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
  role: string | null;
  version_no: number;
  title: string;
  instructions: string;
  work_type: WorkType;
  opens_at: Date;
  due_at: Date;
  ai_policy: string;
  ai_purposes: string[];
  acknowledged_at: Date | null;
}

const QUERY = `SELECT institution.actor_assignment_role(a.id) AS role, v.version_no, v.title, v.instructions,
  v.work_type, v.opens_at, v.due_at, v.ai_policy, v.ai_purposes,
  (SELECT n.acknowledged_at FROM institution.notice_acknowledgment n
    WHERE n.assignment_id = a.id AND n.version_no = a.current_version) AS acknowledged_at
FROM institution.assignment a
JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version
WHERE a.id = $1`;

export async function readNotice(token: string | undefined, assignmentId: string, withActor: WithActor): Promise<NoticeRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  if (!UUID.test(assignmentId)) return { kind: "notFound" };
  try {
    const row = await withActor(token, async (tx) => (await tx.query<Row>(QUERY, [assignmentId])).rows[0]);
    // Only a student of the course acknowledges; anyone else sees no notice.
    if (!row || row.role !== "student") return { kind: "notFound" };
    return {
      kind: "available",
      view: {
        assignmentId,
        versionNo: row.version_no,
        title: row.title,
        instructions: row.instructions,
        workType: row.work_type,
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
