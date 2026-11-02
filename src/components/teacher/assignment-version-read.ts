import type { WithActor } from "@/server/db/with-actor";

import { AI_PURPOSES } from "./assignment-create";
import type { CurrentVersion } from "./assignment-version";

// DAN-310 (M2.4-P02): the current version of one assignment, read on the
// server under the session principal for the new version form. RLS decides
// what the row may show; only a teacher of the assignment sees it, and a
// mentorship's assignment has no form here (publish_assignment_version
// refuses it). Someone else's, a missing and a malformed id read alike. The
// query always returns one row, so a closed session is told apart.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VersionRead =
  | { kind: "available"; current: CurrentVersion }
  | { kind: "signedOut" | "notFound" | "unavailable" };

interface Row {
  user_id: string | null;
  role: string | null;
  mentorship: boolean | null;
  version_no: number | null;
  title: string;
  instructions: string;
  work_type: string;
  evidence_profile: "basic" | "extended";
  import_allowed: boolean;
  opens_at: Date;
  due_at: Date;
  ai_policy: string;
  ai_purposes: string[];
  word_min: number | null;
  word_max: number | null;
}

const QUERY = `WITH me AS (SELECT app.current_user_id() AS user_id)
SELECT me.user_id, institution.actor_assignment_role(a.id) AS role, a.mentorship_id IS NOT NULL AS mentorship,
  v.version_no, v.title, v.instructions, v.work_type, v.evidence_profile, v.import_allowed,
  v.opens_at, v.due_at, v.ai_policy, v.ai_purposes, v.word_min, v.word_max
FROM me
LEFT JOIN institution.assignment a ON a.id = $1
LEFT JOIN institution.assignment_version v ON v.assignment_id = a.id AND v.version_no = a.current_version`;

export async function readCurrentVersion(
  token: string | undefined, assignmentId: string, withActor: WithActor,
): Promise<VersionRead> {
  if (!token || !TOKEN.test(token)) return { kind: "signedOut" };
  if (!UUID.test(assignmentId)) return { kind: "notFound" };
  try {
    const row = await withActor(token, async (tx) => (await tx.query<Row>(QUERY, [assignmentId])).rows[0]);
    if (!row?.user_id) return { kind: "signedOut" };
    if (row.role !== "teacher" || row.mentorship !== false || row.version_no === null) return { kind: "notFound" };
    const aiPurposes = AI_PURPOSES.filter((p) => row.ai_purposes.includes(p));
    // A purpose outside the closed list cannot be carried into a new version unchanged.
    if (aiPurposes.length !== row.ai_purposes.length) return { kind: "unavailable" };
    return {
      kind: "available",
      current: {
        assignmentId: assignmentId.toLowerCase(),
        versionNo: row.version_no,
        title: row.title,
        instructions: row.instructions,
        workType: row.work_type,
        evidenceProfile: row.evidence_profile,
        importAllowed: row.import_allowed,
        opensAt: row.opens_at.toISOString(),
        dueAt: row.due_at.toISOString(),
        aiPolicy: row.ai_policy,
        aiPurposes,
        wordMin: row.word_min,
        wordMax: row.word_max,
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
}
