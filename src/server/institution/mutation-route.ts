import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * The shared front of the institution mutation routes (DAN-292). The order is
 * fixed and the same for every route: method, Origin and Sec-Fetch-Site, the
 * session token's shape, the path identifiers, the content type, the body
 * bytes under a hard limit and time, then strict UTF-8 JSON. Who may do what
 * is never decided here: the SECURITY DEFINER RPC behind each route does that.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BODY_TIMEOUT_MS = 5000;

export interface MutationRequestDeps {
  expectedOrigin: string;
  sessionToken?: string;
}

export type MutationInput =
  | { ok: true; sessionToken: string; value: unknown }
  | { ok: false; response: Response };

/**
 * Every body these routes may send, closed: a refusal names only its code,
 * and each route adds its one success shape here, so a wrong field or type
 * fails the type check.
 */
export type InstitutionReply =
  | { error: string }
  | { code: string }
  | { revoked: boolean }
  | { removed: boolean }
  | { allowed: boolean };

export function respond(status: number, body: InstitutionReply): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** The origin of the configured OIDC callback, or undefined when it is missing or opaque. */
export function applicationOrigin(): string | undefined {
  try {
    const callback = process.env.OIDC_REDIRECT_URI;
    if (!callback) return undefined;
    const origin = new URL(callback).origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

/**
 * Runs the guards up to a parsed JSON value. The decoder is fatal and keeps a
 * leading byte order mark, so a body that starts with one is not JSON (400);
 * different bytes never decode to the same accepted text.
 */
export async function readJsonMutation(
  request: Request, ids: readonly unknown[], deps: MutationRequestDeps, maxBytes: number,
): Promise<MutationInput> {
  const refuse = (status: number, error: string): MutationInput => ({ ok: false, response: respond(status, { error }) });
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin);
  } catch {
    return refuse(503, "unavailable");
  }
  if (!allowed.ok) return refuse(allowed.status, allowed.reason);
  const sessionToken = deps.sessionToken;
  if (!sessionToken || !TOKEN.test(sessionToken)) return refuse(401, "unauthorized");
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) return refuse(422, "invalid_input");
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refuse(415, "unsupported_media_type");
  }
  const body = await readBodyWithLimit(request, maxBytes, BODY_TIMEOUT_MS);
  if (!body.ok) return refuse(body.status, body.reason);
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body.bytes);
    return { ok: true, sessionToken, value: JSON.parse(text) };
  } catch {
    return refuse(400, "invalid_json");
  }
}

/** As readJsonMutation, for a route whose body carries nothing and must be exactly {}. */
export async function readEmptyMutation(
  request: Request, ids: readonly unknown[], deps: MutationRequestDeps, maxBytes: number,
): Promise<MutationInput> {
  const input = await readJsonMutation(request, ids, deps, maxBytes);
  if (!input.ok) return input;
  const { value } = input;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    return { ok: false, response: respond(422, { error: "invalid_input" }) };
  }
  return input;
}

/** ZD401 and ZD403 by name; ZD422 only for a route whose RPC judges input; everything else 503. */
export function rpcErrorResponse(error: unknown, invalidInput = false): Response {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ZD401") return respond(401, { error: "unauthorized" });
  if (code === "ZD403") return respond(403, { error: "forbidden" });
  if (invalidInput && code === "ZD422") return respond(422, { error: "invalid_input" });
  return respond(503, { error: "unavailable" });
}
