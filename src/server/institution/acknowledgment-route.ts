import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { withActor } from "@/server/db";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY_BYTES = 1024;

type Deps = { withActor: WithActor; expectedOrigin: string | null; sessionToken?: string };

function respond(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function validInput(value: unknown): value is { versionNo: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 1 && Object.hasOwn(input, "versionNo") &&
    Number.isInteger(input.versionNo) && (input.versionNo as number) >= 1 && (input.versionNo as number) <= 2_147_483_647;
}

/** The RPC derives the student and institution from the cookie-backed actor. */
export async function handleAcknowledgment(request: Request, assignmentId: string, deps: Deps): Promise<Response> {
  if (deps.expectedOrigin === null) return respond(503, { error: "unavailable" });
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return respond(503, { error: "unavailable" });
  }
  if (!allowed.ok) return respond(allowed.status, { error: allowed.reason });
  if (!UUID.test(assignmentId)) return respond(400, { error: "invalid_assignment_id" });
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
    const result = await deps.withActor(deps.sessionToken, (tx) =>
      tx.query<{ acknowledged_at: Date }>(
        "SELECT institution.acknowledge_notice($1::uuid, $2::integer) AS acknowledged_at",
        [assignmentId, input.versionNo],
      ),
    );
    const at = result.rows[0]?.acknowledged_at;
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) return respond(503, { error: "unavailable" });
    return respond(200, { acknowledgedAt: at.toISOString() });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ZD401") return respond(401, { error: "unauthorized" });
    if (code === "ZD403") return respond(403, { error: "forbidden" });
    if (code === "ZD409") return respond(409, { error: "conflict" });
    return respond(503, { error: "unavailable" });
  }
}

export function createAcknowledgmentPostHandler(
  dependencies: { withActor?: WithActor; getRedirectUri?: () => string | undefined } = {},
): (request: NextRequest, context: { params: Promise<{ assignmentId: string }> }) => Promise<Response> {
  const actor = dependencies.withActor ?? withActor;
  const getRedirectUri = dependencies.getRedirectUri ?? (() => process.env.OIDC_REDIRECT_URI);
  return async (request, context) => {
    const callback = getRedirectUri();
    let expectedOrigin: string | null = null;
    try {
      if (callback) {
        const url = new URL(callback);
        if (url.protocol === "http:" || url.protocol === "https:") expectedOrigin = url.origin;
      }
    } catch { /* Misconfiguration fails closed. */ }
    const { assignmentId } = await context.params;
    return handleAcknowledgment(request, assignmentId, {
      withActor: actor,
      expectedOrigin,
      sessionToken: request.cookies.get(SESSION_COOKIE_NAME)?.value,
    });
  };
}
