import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

export const MAX_COURSE_BODY_BYTES = 2048;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const POLICIES = new Set(["prohibited", "partially_allowed", "encouraged"]);

interface CreateCourseInput {
  name: string;
  academicYear: string;
  aiPolicy: string;
}

export interface CreateCourseDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

function respond(status: number, error?: string, id?: string): Response {
  return Response.json(id ? { id } : { error: error ?? "unavailable" }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

// Strict API shape: identity, institution and membership are NEVER JSON inputs.
function courseInput(value: unknown): CreateCourseInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 3 || !["name", "academicYear", "aiPolicy"].every((key) => keys.includes(key))) {
    return null;
  }
  if (typeof obj.name !== "string" || typeof obj.academicYear !== "string" || typeof obj.aiPolicy !== "string") {
    return null;
  }
  if (obj.name.trim() !== obj.name || obj.name.length < 1 || obj.name.length > 160) return null;
  const years = /^([0-9]{4})\/([0-9]{4})$/.exec(obj.academicYear);
  if (!years || Number(years[2]) !== Number(years[1]) + 1) return null;
  if (!POLICIES.has(obj.aiPolicy)) return null;
  return { name: obj.name, academicYear: obj.academicYear, aiPolicy: obj.aiPolicy };
}

// F-6a HTTP boundary. The DB SECURITY DEFINER function checks the actual
// teacher role, institution and idempotency inside a withActor transaction.
// No UI is introduced by this step; F-6 remains incomplete.
export async function handleCreateCourse(request: Request, deps: CreateCourseDeps): Promise<Response> {
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    // No dynamically inferred origin, especially not an untrusted Host header.
    return respond(503);
  }
  if (!allowed.ok) return respond(allowed.status, allowed.reason);
  if (!deps.sessionToken || !TOKEN.test(deps.sessionToken)) return respond(401, "unauthorized");
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, "unsupported_media_type");
  }

  const body = await readBodyWithLimit(request, MAX_COURSE_BODY_BYTES);
  if (!body.ok) return respond(body.status, body.reason);

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return respond(400, "invalid_json");
  }
  const input = courseInput(value);
  if (!input) return respond(422, "invalid_input");

  try {
    const result = await deps.withActor(deps.sessionToken, async (tx) => tx.query<{ id: string }>(
      "SELECT institution.create_course($1, $2, $3) AS id",
      [input.name, input.academicYear, input.aiPolicy],
    ));
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !UUID.test(id)) return respond(503);
    return respond(200, undefined, id); // Idempotent duplicate: no false "created" claim.
  } catch (error) {
    // PostgreSQL raises documented ZD codes; never return its message/SQL/params.
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, "unauthorized");
    if (code === "ZD403") return respond(403, "forbidden");
    if (code === "ZD409") return respond(409, "conflict");
    if (code === "ZD422") return respond(422, "invalid_input");
    return respond(503);
  }
}
