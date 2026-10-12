/**
 * Guards for a state-changing JSON route (first user: evidence ingest, B-8j2).
 *
 * The order is fixed: method and origin are checked from the headers before a
 * single body byte is read, and the body is read as raw bytes with a hard
 * byte limit before anything parses it. A JSON parser has no early exit for a
 * body with very many keys, so the limit must act before JSON.parse (PR #213).
 * Bytes are never decoded here: strict UTF-8 and canonical-form checks belong
 * to the caller (verifyCanonicalEvidencePayloadV2), and a lenient decode would
 * map different bytes to the same text.
 */

export type MutationRequestRefusal =
  | { ok: false; status: 405; reason: "method_not_allowed" }
  | {
      ok: false;
      status: 403;
      reason: "origin_missing" | "origin_mismatch" | "cross_site";
    };

/**
 * Only POST from a page of this origin. Origin is required: browsers send it
 * on every cross-origin and same-origin POST, so a request without it is not
 * from our page. Sec-Fetch-Site, when present, must also say same-origin; a
 * same-site subdomain is still another origin.
 */
export function checkMutationRequest(
  request: Request,
  expectedOrigin: string,
): { ok: true } | MutationRequestRefusal {
  const expected = canonicalOrigin(expectedOrigin);
  if (request.method !== "POST")
    return { ok: false, status: 405, reason: "method_not_allowed" };
  const origin = request.headers.get("origin");
  if (origin === null || origin === "" || origin === "null")
    return { ok: false, status: 403, reason: "origin_missing" };
  if (origin !== expected)
    return { ok: false, status: 403, reason: "origin_mismatch" };
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin")
    return { ok: false, status: 403, reason: "cross_site" };
  return { ok: true };
}

function canonicalOrigin(value: string): string {
  const origin = new URL(value).origin;
  // A misconfigured expected origin must fail loudly, never match "null".
  if (origin === "null" || origin !== value)
    throw new Error("expected origin must be a bare scheme://host[:port]");
  return origin;
}

export type LimitedBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: 413; reason: "body_too_large" }
  | {
      ok: false;
      status: 400;
      reason:
        | "content_length_invalid"
        | "content_length_mismatch"
        | "body_stream_error";
    };

const DECIMAL = /^(0|[1-9][0-9]{0,15})$/;

/**
 * Reads the body as raw bytes, at most maxBytes. A declared Content-Length
 * over the limit is refused without reading; an undeclared or understated
 * length is cut off at the first byte past the limit, and the rest of the
 * stream is cancelled rather than drained. A declared length that does not
 * match the bytes received is refused too.
 *
 * A body stream that fails mid-read (client gone, connection reset) is
 * returned as body_stream_error, never thrown, and no partial bytes leave
 * this function; the caller stores nothing and has no exception to forget.
 *
 * There is deliberately no time limit here: a slow client can hold the
 * request open while it trickles up to maxBytes. Bounding that is the
 * obligation of the route (B-8j2) or the infrastructure (Node server request
 * timeout or the reverse proxy), not of this reader.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error("maxBytes must be a non-negative safe integer");

  const header = request.headers.get("content-length");
  let declared: number | null = null;
  if (header !== null) {
    if (!DECIMAL.test(header)) {
      await cancelQuietly(request.body);
      return { ok: false, status: 400, reason: "content_length_invalid" };
    }
    declared = Number(header);
    if (declared > maxBytes) {
      await cancelQuietly(request.body);
      return { ok: false, status: 413, reason: "body_too_large" };
    }
  }

  const body = request.body;
  if (body === null) {
    return declared === null || declared === 0
      ? { ok: true, bytes: new Uint8Array(0) }
      : { ok: false, status: 400, reason: "content_length_mismatch" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return { ok: false, status: 400, reason: "body_stream_error" };
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await cancelQuietly(reader);
        return { ok: false, status: 413, reason: "body_too_large" };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (declared !== null && declared !== size)
    return { ok: false, status: 400, reason: "content_length_mismatch" };
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** The refusal is already decided; a failing cancel must not turn it into a throw. */
async function cancelQuietly(
  target: { cancel(): Promise<void> } | null,
): Promise<void> {
  try {
    await target?.cancel();
  } catch {
    // The stream is already errored or closed; nothing left to release.
  }
}
