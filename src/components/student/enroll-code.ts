// F-7 (#336): the student joins a course with the code the teacher gives.
// The browser sends only the code; identity and institution come from the
// session. The route is the proposal on #314 (6237117691) and does not exist
// yet, so until Backend adds it every attempt ends as `unavailable`.
export type Enrollment =
  | { kind: "enrolled"; courseId: string }
  | { kind: "malformed" | "refused" | "tooManyAttempts" | "unauthorized" | "forbidden" | "invalid" | "unavailable" };

// An API route that starts an OIDC login: a real navigation, not a Link.
export const SIGN_IN_HREF = `/api/auth/login?returnTo=${encodeURIComponent("/upis")}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The code as `enroll_with_code` compares it: no spaces or hyphens, upper case; null if it can never match. */
export function normalizeCode(input: string): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-Z]{8,32}$/.test(code) ? code : null;
}

/** Success only for HTTP 200 with a course UUID; server error bodies are ignored. */
export async function enrollWithCode(input: string, send: typeof fetch = fetch): Promise<Enrollment> {
  const code = normalizeCode(input);
  // A code that cannot match is not sent, so it never spends an attempt.
  if (!code) return { kind: "malformed" };
  try {
    const response = await send("/api/institution/enrollments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ code }),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 422) return { kind: "refused" };
    if (response.status === 429) return { kind: "tooManyAttempts" };
    if ([400, 413, 415].includes(response.status)) return { kind: "invalid" };
    if (response.status !== 200) return { kind: "unavailable" };
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        !("courseId" in data) || typeof data.courseId !== "string" || !UUID.test(data.courseId)) {
      return { kind: "unavailable" };
    }
    return { kind: "enrolled", courseId: data.courseId };
  } catch {
    return { kind: "unavailable" };
  }
}
