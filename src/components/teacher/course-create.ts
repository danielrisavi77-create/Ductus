// F-6b / DAN-35: the browser sends only the three course fields supported
// by the F-6a server. Identity, institution and role are never form inputs.
export type CoursePolicy = "prohibited" | "partially_allowed" | "encouraged";

export interface CourseDraft {
  name: string;
  academicYear: string;
  aiPolicy: CoursePolicy;
}

export type CourseCreation =
  | { kind: "available"; id: string }
  | { kind: "invalid" | "unauthorized" | "forbidden" | "conflict" | "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICIES: ReadonlySet<string> = new Set(["prohibited", "partially_allowed", "encouraged"]);

function validDraft(draft: CourseDraft): boolean {
  if (!draft || typeof draft.name !== "string" || typeof draft.academicYear !== "string" ||
    typeof draft.aiPolicy !== "string") return false;
  if (!draft.name || draft.name !== draft.name.trim() || draft.name.length > 160) return false;
  const years = /^([0-9]{4})\/([0-9]{4})$/.exec(draft.academicYear);
  return Boolean(years && Number(years[2]) === Number(years[1]) + 1 && POLICIES.has(draft.aiPolicy));
}

/**
 * No success is declared unless the real server returns HTTP 200 with a
 * valid course UUID. All error text is local; server error bodies are ignored.
 */
export async function createCourse(draft: CourseDraft, send: typeof fetch = fetch): Promise<CourseCreation> {
  if (!validDraft(draft)) return { kind: "invalid" };
  try {
    const response = await send("/api/institution/courses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({
        name: draft.name,
        academicYear: draft.academicYear,
        aiPolicy: draft.aiPolicy,
      }),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 409) return { kind: "conflict" };
    if ([400, 413, 415, 422].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
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
