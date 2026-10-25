import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

export const MAX_REVOCATION_BODY_BYTES = 64;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface EnrollmentCodeRevocationDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

function respond(status: number, body: { error: string } | { revoked: boolean }): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// The body carries nothing and must be exactly {}; the JSON content type makes
// a cross-origin caller send a preflight first. The session is the only
// principal: who may revoke, and for which course, is decided by the existing
// SECURITY DEFINER RPC, which answers ZD403 for a course of another
// institution exactly as for one that does not exist.
export async function handleEnrollmentCodeRevocationRequest(
  request: Request, courseId: unknown, deps: EnrollmentCodeRevocationDeps,
): Promise<Response> {
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503, { error: "unavailable" });
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  if (!deps.sessionToken || !TOKEN.test(deps.sessionToken)) return respond(401, { error: "unauthorized" });
  if (typeof courseId !== "string" || !UUID.test(courseId)) return respond(422, { error: "invalid_input" });
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return respond(415, { error: "unsupported_media_type" });
  }
  const body = await readBodyWithLimit(request, MAX_REVOCATION_BODY_BYTES, 5000);
  if (!body.ok) return respond(body.status, { error: body.reason });
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    return respond(422, { error: "invalid_input" });
  }
  try {
    const revoked = await deps.withActor(deps.sessionToken, async (tx) => {
      const result = await tx.query<{ revoked: unknown }>(
        "SELECT institution.revoke_enrollment_code($1) AS revoked", [courseId],
      );
      const outcome = result.rows[0]?.revoked;
      if (result.rows.length !== 1 || typeof outcome !== "boolean") {
        throw new Error("invalid enrollment code revocation result");
      }
      return outcome;
    });
    return respond(200, { revoked });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    return respond(503, { error: "unavailable" });
  }
}
