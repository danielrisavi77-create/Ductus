// F-6 / DAN-35: the browser sends only the nine assignment fields of the
// create_assignment contract (#363). Identity, institution and role are never
// form inputs; the server decides them from the session.
import type { CoursePolicy } from "./course-create";

export const WORK_TYPES = ["seminar_paper", "bachelor_thesis", "master_thesis", "essay"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

// The closed list of FPZG čl. 8 purposes (D-80), the same five keys the
// database accepts. Labels are in the catalogue until the verbatim text of the
// Pravilnik arrives.
export const AI_PURPOSES = ["literature_search", "proofreading", "translation", "formatting", "transcription"] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

export interface AssignmentDraft {
  title: string;
  instructions: string;
  workType: WorkType;
  /** `datetime-local` values: minutes, the teacher's own clock. */
  opensAt: string;
  dueAt: string;
  aiPurposes: AiPurpose[];
}

export interface AssignmentBody {
  title: string;
  instructions: string;
  workType: WorkType;
  opensAt: string;
  dueAt: string;
  aiPolicy: CoursePolicy;
  aiPurposes: AiPurpose[];
  evidenceProfile: "basic";
  importAllowed: false;
}

export type AssignmentCreation =
  | { kind: "available"; id: string }
  | { kind: "invalid" | "unauthorized" | "forbidden" | "conflict" | "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function instant(local: string): string | null {
  if (!LOCAL_MINUTE.test(local)) return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * The request body, or null when the draft cannot pass the server. A list of
 * purposes can only narrow the course (D-52): none checked, or a course that
 * prohibits use, means the assignment prohibits use.
 */
export function assignmentBody(draft: AssignmentDraft, course: CoursePolicy): AssignmentBody | null {
  const title = draft.title.trim();
  const opensAt = instant(draft.opensAt);
  const dueAt = instant(draft.dueAt);
  if (!title || Array.from(title).length > 200 || Array.from(draft.instructions).length > 20_000) return null;
  if (!WORK_TYPES.includes(draft.workType) || !opensAt || !dueAt || dueAt <= opensAt) return null;
  const aiPurposes = course === "prohibited" ? [] : AI_PURPOSES.filter((p) => draft.aiPurposes.includes(p));
  return {
    title,
    instructions: draft.instructions,
    workType: draft.workType,
    opensAt,
    dueAt,
    aiPolicy: aiPurposes.length === 0 ? "prohibited" : "partially_allowed",
    aiPurposes,
    // No form field yet; the narrowest values the contract accepts.
    evidenceProfile: "basic",
    importAllowed: false,
  };
}

/**
 * The retry key belongs to one body: the caller makes a new one whenever the
 * draft changes, so a retry never meets the server's 409 for a changed body.
 * Success only on HTTP 201 with a valid UUID; server error text is ignored.
 */
export async function createAssignment(
  courseId: string,
  body: AssignmentBody,
  requestId: string,
  send: typeof fetch = fetch,
): Promise<AssignmentCreation> {
  if (!UUID.test(courseId) || !UUID.test(requestId)) return { kind: "invalid" };
  try {
    const response = await send(`/api/institution/courses/${courseId}/assignments`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": requestId },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "conflict" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 201) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !("id" in data) || typeof data.id !== "string" || !UUID.test(data.id)) {
      return { kind: "unavailable" };
    }
    return { kind: "available", id: data.id };
  } catch {
    return { kind: "unavailable" };
  }
}
