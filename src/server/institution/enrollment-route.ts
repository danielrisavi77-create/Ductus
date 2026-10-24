import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1024;

type Deps = { withActor: WithActor; expectedOrigin: string | null; sessionToken?: string };

function respond(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function validInput(value: unknown): value is { code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && Object.hasOwn(input, "code") &&
    typeof input.code === "string" && input.code.length <= 64;
}

/** Enrollment and attempt counting are one READ COMMITTED RPC transaction. */
export async function handleEnrollment(request: Request, deps: Deps): Promise<Response> {
  if (deps.expectedOrigin === null) return respond(503, { error: "unavailable" });
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503, { error: "unavailable" });
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  if (!deps.sessionToken || !TOKEN.test(deps.sessionToken)) return respond(401, { error: "unauthorized" });
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
    return respond(415, { error: "unsupported_media_type" });
  }

  const body = await readBodyWithLimit(request, MAX_BODY_BYTES, 5_000);
  if (!body.ok) return respond(body.status, { error: body.reason });
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes));
  } catch {
    return respond(400, { error: "invalid_json" });
  }
  if (!validInput(input)) return respond(422, { error: "invalid_input" });

  try {
    // Map the result only after withActor commits. A refused guess still stores
    // its rate-limit attempt, so it must never be turned into an exception.
    const result = await deps.withActor(deps.sessionToken, (tx) =>
      tx.query<{ outcome: string; enrolled_course_id: string | null }>(
        "SELECT outcome, enrolled_course_id FROM institution.enroll_with_code($1::text)",
        [input.code],
      ),
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row) return respond(503, { error: "unavailable" });
    if (row.outcome === "enrolled" && typeof row.enrolled_course_id === "string" && UUID.test(row.enrolled_course_id)) {
      return respond(200, { courseId: row.enrolled_course_id });
    }
    if (row.outcome === "refused" && row.enrolled_course_id === null) return respond(422, { error: "refused" });
    if (row.outcome === "too_many_attempts" && row.enrolled_course_id === null) {
      return respond(429, { error: "too_many_attempts" });
    }
    return respond(503, { error: "unavailable" });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    return respond(503, { error: "unavailable" });
  }
}

export function createEnrollmentPostHandler(
  dependencies: { withActor?: WithActor; getRedirectUri?: () => string | undefined } = {},
): (request: NextRequest) => Promise<Response> {
  const actor = dependencies.withActor ?? withActor;
  const getRedirectUri = dependencies.getRedirectUri ?? (() => process.env.OIDC_REDIRECT_URI);
  return async (request) => {
    const callback = getRedirectUri();
    let expectedOrigin: string | null = null;
    try {
      if (callback) {
        const url = new URL(callback);
        if (url.protocol === "http:" || url.protocol === "https:") expectedOrigin = url.origin;
      }
    } catch { /* Misconfiguration fails closed. */ }
    return handleEnrollment(request, {
      withActor: actor,
      expectedOrigin,
      sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
    });
  };
}
