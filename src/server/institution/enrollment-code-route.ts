import type { WithActor } from "@/server/db/with-actor";
import { readJsonMutation, respond, rpcErrorResponse } from "./mutation-route";

export const MAX_ENROLLMENT_CODE_BODY_BYTES = 1024;
const CODE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

export interface EnrollmentCodeDeps {
  withActor: WithActor;
  expectedOrigin: string;
  sessionToken?: string;
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
  const input = await readJsonMutation(request, [courseId], deps, MAX_ENROLLMENT_CODE_BODY_BYTES);
  if (!input.ok) return input.response;
  const { value, sessionToken } = input;
  if (!value || typeof value !== "object" || Array.isArray(value)) return respond(422, { error: "invalid_input" });
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "validUntil") || !validTimestamp(body.validUntil)) {
    return respond(422, { error: "invalid_input" });
  }
  try {
    const code = await deps.withActor(sessionToken, async (tx) => {
      const result = await tx.query<{ code: unknown }>(
        "SELECT institution.create_enrollment_code($1, $2::timestamptz) AS code", [courseId, body.validUntil],
      );
      const issued = result.rows[0]?.code;
      if (result.rows.length !== 1 || typeof issued !== "string" || !CODE.test(issued)) {
        throw new Error("invalid enrollment code result");
      }
      return issued;
    });
    return respond(200, { code });
  } catch (error) {
    return rpcErrorResponse(error, true);
  }
}
