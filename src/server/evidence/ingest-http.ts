import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { sessionPrincipal } from "@/server/auth/principal";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * What both evidence routes do before and while reading a body (BACKEND 4.13
 * t. 1): every check from the headers comes before a single body byte is
 * read, and every answer is JSON with no echo of the input and no caching.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;

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
 * then the body as raw bytes under a byte and a time limit. With
 * `liveSession`, the session is asked of the database before the first body
 * byte (F-098): a large body is never held for a cookie that only has the
 * right form. A closed, expired or unknown session is 401, a database that
 * cannot answer is 503 `context`.
 */
export async function readGuardedBody(
  request: Request,
  expectedOrigin: string | null,
  sessionToken: string | undefined,
  limits: { maxBytes: number; timeoutMs: number; liveSession?: WithActor },
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
  // A declared length that readBodyWithLimit refuses unread needs no database either.
  const declared = request.headers.get("content-length");
  const refusedUnread = declared !== null && !(DECIMAL.test(declared) && Number(declared) <= limits.maxBytes);
  if (limits.liveSession !== undefined && !refusedUnread) {
    const principal = await sessionPrincipal(sessionToken, limits.liveSession);
    if (principal.kind === "signed-out") return refuse(reply(401, { status: "unauthenticated" }));
    if (principal.kind !== "signed-in") return refuse(unavailable("context"));
  }
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
