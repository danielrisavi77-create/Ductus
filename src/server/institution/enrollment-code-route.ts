import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

export const MAX_ENROLLMENT_CODE_BODY_BYTES = 1024;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

export interface EnrollmentCodeDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
}

function respond(status: number, body: { error: string } | { code: string }): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Keep the caller's timestamp intact (including microseconds). Date.parse alone
// normalizes impossible dates such as February 30; reject them before the RPC.
function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [, y, m, d, h, min, s, zh = "0", zm = "0"] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(h) <= 23 && Number(min) <= 59 && Number(s) <= 59
    && Number(zh) <= 15 && Number(zm) <= 59 && Number.isFinite(Date.parse(value));
}

// The session is the only principal. Authorization, DB time, row locking and
// replacement remain the responsibility of the existing SECURITY DEFINER RPC.
export async function handleEnrollmentCodeRequest(
  request: Request, courseId: unknown, deps: EnrollmentCodeDeps,
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
  const body = await readBodyWithLimit(request, MAX_ENROLLMENT_CODE_BODY_BYTES, 5000);
  if (!body.ok) return respond(body.status, { error: body.reason });
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return respond(422, { error: "invalid_input" });
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "validUntil") || !validTimestamp(input.validUntil)) {
    return respond(422, { error: "invalid_input" });
  }
  try {
    const code = await deps.withActor(deps.sessionToken, async (tx) => {
      const result = await tx.query<{ code: unknown }>(
        "SELECT institution.create_enrollment_code($1, $2::timestamptz) AS code", [courseId, input.validUntil],
      );
      const issued = result.rows[0]?.code;
      if (result.rows.length !== 1 || typeof issued !== "string" || !CODE.test(issued)) {
        throw new Error("invalid enrollment code result");
      }
      return issued;
    });
    return respond(200, { code });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    if (code === "ZD422") return respond(422, { error: "invalid_input" });
    return respond(503, { error: "unavailable" });
  }
}
