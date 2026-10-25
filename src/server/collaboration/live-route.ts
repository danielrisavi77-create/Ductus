import { createHash } from "node:crypto";

import { isDocumentId } from "@/domain/collaboration";
import { MAX_DOCUMENT_SNAPSHOT_BYTES, verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { sessionPrincipal } from "@/server/auth/principal";
import type { WithActor } from "@/server/db/with-actor";
import { checkMutationRequest, declaredLengthRefusal, readBodyWithLimit } from "@/server/http/mutation-request";

/**
 * B-LIVE step 3 HTTP boundary (BACKEND 4.12 point 6): the student owner
 * publishes the last state of the work with PUT, and every reader, the
 * student included, reads it with GET through one function, so the owner and
 * the teacher get the same status, bytes and ETag (PRODUCT 5, rule 5).
 *
 * Who asks comes only from the session cookie, bound into withActor; the
 * database decides access. Nothing here adds what the RPCs do not return: no
 * token on a read, no person, institution or time. The work text never
 * reaches a log; a log line carries one closed code.
 */

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const BODY_TIMEOUT_MS = 30_000;
const NO_STORE = { "cache-control": "no-store" };
/**
 * DAN-289 A3 (BACKEND 4.12 t. 3): the mark of a read whose bytes are the
 * submitted revision, not the live state. It carries nothing else: no
 * revision, time or id of the submission.
 */
export const LIVE_STATE_HEADER = "ductus-live-state";
const SUBMITTED = { [LIVE_STATE_HEADER]: "submitted" };

export interface LiveRouteDeps {
  withActor: WithActor;
  /** The application origin; null when it is not configured (503). */
  expectedOrigin: string | null;
  sessionToken?: string;
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

function codeOf(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" ? code : undefined;
}

/** ZD401 and ZD403 as the comment reads answer them; anything else is 503 with a closed code. */
function refusalFor(error: unknown, what: string): Response {
  const code = codeOf(error);
  if (code === "ZD401") return refuse(401, "unauthorized");
  if (code === "ZD403") return refuse(404, "not_found");
  if (code === "ZD422") return refuse(422, "invalid_document");
  console.error(what, code !== undefined && SQLSTATE.test(code) ? code : "unknown");
  return refuse(503, "unavailable");
}

/**
 * Exactly one precondition: `If-None-Match: *` for the first write, or
 * `If-Match: "<token>"` with the last token. Anything else is null (428).
 */
function expectedTokenOf(headers: Headers): { token: string | null } | null {
  const match = headers.get("if-match");
  const none = headers.get("if-none-match");
  if (match !== null && none !== null) return null;
  if (none !== null) return none.trim() === "*" ? { token: null } : null;
  if (match === null) return null;
  const quoted = /^"([^"]*)"$/.exec(match.trim());
  return quoted && UUID.test(quoted[1]) ? { token: quoted[1] } : null;
}

export async function handleLivePublishRequest(
  request: Request,
  documentId: string,
  deps: LiveRouteDeps,
): Promise<Response> {
  if (deps.expectedOrigin === null) return refuse(503, "unavailable");
  let allowed;
  try {
    allowed = checkMutationRequest(request, deps.expectedOrigin, "PUT");
  } catch {
    return refuse(503, "unavailable");
  }
  if (!allowed.ok) return refuse(allowed.status, allowed.status === 405 ? "method_not_allowed" : "forbidden");
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return refuse(415, "unsupported_media_type");
  }
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return refuse(401, "unauthorized");
  const expected = expectedTokenOf(request.headers);
  if (expected === null) return refuse(428, "precondition_required");
  // An id that cannot exist is answered like one that does not, before the database.
  if (!isDocumentId(documentId)) return refuse(404, "not_found");

  // The session before the first body byte (F-098): up to 2 MiB is never held
  // for a cookie that only has the right form. A declared length the reader
  // refuses unread needs no database either.
  if (declaredLengthRefusal(request, MAX_DOCUMENT_SNAPSHOT_BYTES) === null) {
    const principal = await sessionPrincipal(token, deps.withActor);
    if (principal.kind === "signed-out") return refuse(401, "unauthorized");
    if (principal.kind !== "signed-in") return refuse(503, "unavailable");
  }
  const body = await readBodyWithLimit(request, MAX_DOCUMENT_SNAPSHOT_BYTES, BODY_TIMEOUT_MS);
  if (!body.ok) {
    return refuse(body.status, body.status === 413 ? "too_large" : body.status === 408 ? "timeout" : "bad_request");
  }
  // Only the exact JCS bytes of a valid document (BACKEND 4.12 point 6, as 4.10 point 2).
  const snapshot = await verifyDocumentSnapshot(body.bytes);
  if (!snapshot.ok) return refuse(snapshot.reason === "too_large" ? 413 : 422, snapshot.reason === "too_large" ? "too_large" : "invalid_document");

  let rows: { outcome?: unknown; write_token?: unknown }[];
  try {
    const result = await deps.withActor(token, (tx) =>
      tx.query<{ outcome?: unknown; write_token?: unknown }>(
        "SELECT outcome, write_token FROM collaboration.publish_live_state($1, $2, $3)",
        [documentId, expected.token, snapshot.text],
      ),
    );
    rows = result.rows;
  } catch (error) {
    return refusalFor(error, "live state publish failed");
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  const written = typeof row?.write_token === "string" && UUID.test(row.write_token) ? row.write_token : undefined;
  if (row?.outcome === "accepted" || row?.outcome === "unchanged") {
    if (written !== undefined) return Response.json({ outcome: row.outcome, token: written }, { status: 200, headers: NO_STORE });
  } else if (row?.outcome === "conflict") {
    // No row yet answers a token with conflict and no current token.
    if (written !== undefined || row.write_token === null) {
      return Response.json({ outcome: "conflict", token: written ?? null }, { status: 409, headers: NO_STORE });
    }
  }
  console.error("live state publish failed", "row_malformed");
  return refuse(503, "unavailable");
}

export async function handleLiveReadRequest(
  request: Request,
  documentId: string,
  deps: Omit<LiveRouteDeps, "expectedOrigin">,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return refuse(405, "method_not_allowed");
  // A teacher's read writes the access log (PRODUCT 5, rule 17), so it needs
  // positive proof that a page of this origin sent it (F-107): the protocol
  // header, which only a script can set and which no other origin can send
  // without a preflight this route never answers, and Sec-Fetch-Site, when the
  // browser sends it, saying same-origin.
  if (request.headers.get("ductus-protocol") !== DUCTUS_PROTOCOL_VERSION) return refuse(403, "forbidden");
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return refuse(403, "forbidden");
  const token = deps.sessionToken;
  if (token === undefined || !TOKEN.test(token)) return refuse(401, "unauthorized");
  if (!isDocumentId(documentId)) return refuse(404, "not_found");
  // Only the exact form of an ETag this route sent; anything else reads in full.
  const known = /^"([0-9a-f]{64})"$/.exec(request.headers.get("if-none-match")?.trim() ?? "")?.[1] ?? null;

  let rows: { outcome?: unknown; content_hash?: unknown; body?: unknown }[];
  try {
    const result = await deps.withActor(token, (tx) =>
      tx.query<{ outcome?: unknown; content_hash?: unknown; body?: unknown }>(
        "SELECT outcome, content_hash, body FROM collaboration.read_live_state($1, $2)",
        [documentId, known],
      ),
    );
    rows = result.rows;
  } catch (error) {
    return refusalFor(error, "live state read failed");
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  const hash = typeof row?.content_hash === "string" && HASH.test(row.content_hash) ? row.content_hash : undefined;
  if (row?.outcome === "empty") return new Response(null, { status: 204, headers: NO_STORE });
  if (row?.outcome === "unchanged" && hash !== undefined && hash === known) {
    return new Response(null, { status: 304, headers: { ...NO_STORE, etag: `"${hash}"` } });
  }
  // After the submission the bytes are the submitted revision, never the live state (option (a), #756).
  const submitted = row?.outcome === "submitted";
  if (submitted && row.body === null && hash !== undefined && hash === known) {
    return new Response(null, { status: 304, headers: { ...NO_STORE, ...SUBMITTED, etag: `"${hash}"` } });
  }
  if ((row?.outcome === "state" || submitted) && hash !== undefined && typeof row?.body === "string") {
    const bytes = Buffer.from(row.body, "utf8");
    // The database keeps the hash of these bytes; a row that disagrees is not served.
    if (createHash("sha256").update(bytes).digest("hex") === hash) {
      return new Response(bytes, {
        status: 200,
        headers: {
          ...NO_STORE, ...(submitted ? SUBMITTED : {}), "content-type": "application/json; charset=utf-8", etag: `"${hash}"`,
        },
      });
    }
  }
  if (row?.outcome === "unavailable") {
    // The submitted text cannot be shown; the live state is never served in its place.
    console.error("live state read failed", "submitted_unavailable");
    return refuse(503, "unavailable");
  }
  console.error("live state read failed", "row_malformed");
  return refuse(503, "unavailable");
}
