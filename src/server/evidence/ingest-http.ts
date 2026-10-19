import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * What both evidence routes do before and while reading a body (BACKEND 4.13
 * t. 1): every check from the headers comes before a single body byte is
 * read, and every answer is JSON with no echo of the input and no caching.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type Log = (message: string, ...codes: string[]) => void;

export const consoleLog: Log = (message, ...codes) => console.error(message, ...codes);

export function reply(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...headers, "cache-control": "no-store" } });
}

export function unavailable(stage: string): Response {
  return reply(503, { status: "unavailable", stage }, { "retry-after": "5" });
}

export type GuardedRequest = { ok: true; token: string; bytes: Uint8Array } | { ok: false; response: Response };

/**
 * Method, origin, protocol, media type and session cookie from the headers,
 * then the body as raw bytes under a byte and a time limit.
 */
export async function readGuardedBody(
  request: Request,
  expectedOrigin: string | null,
  sessionToken: string | undefined,
  limits: { maxBytes: number; timeoutMs: number },
): Promise<GuardedRequest> {
  const refuse = (response: Response) => ({ ok: false, response }) as const;
  if (expectedOrigin === null) return refuse(unavailable("context"));
  let allowed;
  try {
    allowed = checkMutationRequest(request, expectedOrigin);
  } catch {
    return refuse(unavailable("context"));
  }
  if (!allowed.ok) {
    return refuse(reply(allowed.status, { status: allowed.status === 405 ? "method_not_allowed" : "forbidden" }));
  }
  if (request.headers.get("ductus-protocol") !== DUCTUS_PROTOCOL_VERSION) {
    return refuse(reply(426, { status: "upgrade_required" }));
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refuse(reply(415, { status: "unsupported_media_type" }));
  }
  if (sessionToken === undefined || !TOKEN.test(sessionToken)) return refuse(reply(401, { status: "unauthenticated" }));
  const body = await readBodyWithLimit(request, limits.maxBytes, limits.timeoutMs);
  if (!body.ok) {
    const status = body.status === 413 ? "too_large" : body.status === 408 ? "timeout" : "bad_request";
    return refuse(reply(body.status, { status }));
  }
  return { ok: true, token: sessionToken, bytes: body.bytes };
}

/**
 * A JSON object with exactly the given keys, from strict UTF-8: a byte order
 * mark stays a character and fails the parse. Anything else is null.
 */
export function parseClosedObject(bytes: Uint8Array, keys: readonly string[]): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => own.includes(key))) return null;
  return value as Record<string, unknown>;
}
