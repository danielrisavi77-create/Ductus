import {
  evidenceObjectKey,
  evidenceStorageRef,
  isStorageDomainLabel,
} from "@/application/ports/evidence-object-key";
import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import {
  assertS3SigningConfig,
  type S3Credentials,
  sha256Hex,
  signS3Request,
} from "./s3-signature";

/** Upper bound for one `putImmutable` call, every request and read included. */
export const MAX_S3_REQUEST_TIMEOUT_MS = 60_000;

export type S3EvidencePayloadStoreConfig = {
  /** Path-style endpoint, e.g. `https://s3.example.eu`; http only for loopback. */
  endpoint: string;
  region: string;
  bucket: string;
  /**
   * Operator label of this storage domain, kept in `storageRef` in place of
   * the endpoint and bucket (e.g. `fpzg-eu-1`). Operational only: it is not
   * part of the object key and never enters a signature.
   */
  storageDomain: string;
  credentials: S3Credentials;
  /**
   * Deadline for one `putImmutable` call as a whole (the PUT, a read-back and
   * reading the answers). No default on purpose (BACKEND 6 t. 10): a missing
   * value stops startup.
   */
  requestTimeoutMs: number;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Receives ids and hashes only, never the payload (BACKEND 4.9). */
  warn?: (message: string, fields: Record<string, string>) => void;
};

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/**
 * The object an operator writes into each bucket when it is provisioned:
 * `{"institutionId":"<uuid>","region":"<region>"}`. Read only, never written
 * by the application (BACKEND 4.1, P3).
 */
export const STORAGE_IDENTITY_KEY = "ductus-storage-identity.json";
const MAX_IDENTITY_BYTES = 1_024;
/** Enough for the `<Code>` of an S3 error document; the rest is never read. */
const MAX_ERROR_BODY_BYTES = 4_096;
/**
 * S3 error codes that name a cause the operator has to fix. Only these fixed
 * reasons leave the adapter; the error document itself is never passed on.
 */
const ERROR_REASONS: Readonly<Record<string, string>> = {
  RequestTimeTooSkewed: "storage_clock_skew",
  SignatureDoesNotMatch: "storage_signature_rejected",
  AuthorizationHeaderMalformed: "storage_signature_rejected",
  InvalidAccessKeyId: "storage_signature_rejected",
};

type Fetched =
  | { ok: true; status: number; body: Uint8Array | null }
  | { ok: false; reason: string };

/**
 * Evidence payload store on an S3 API (BACKEND 4.1, D-08 still PRIJEDLOG).
 *
 * One conditional PUT per object (`If-None-Match: *`) with a SHA-256 checksum:
 * no multipart upload, no overwrite, no delete. When the key already exists
 * the object is read back and compared byte for byte, never by ETag. Every
 * doubtful answer is `unavailable`; retrying is the client's job, so the store
 * itself never retries and never follows a redirect. Requests go only to the
 * configured endpoint; the signer builds every URL from validated parts.
 */
export class S3EvidencePayloadStore implements EvidencePayloadStore {
  private readonly endpoint: URL;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly warn: (
    message: string,
    fields: Record<string, string>,
  ) => void;

  constructor(private readonly config: S3EvidencePayloadStoreConfig) {
    const endpoint = new URL(config.endpoint);
    if (
      !(
        endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" && LOOPBACK.has(endpoint.hostname))
      ) ||
      endpoint.href !== `${endpoint.origin}/`
    ) {
      throw new TypeError(
        "S3 endpoint must be https (http only on loopback) without a path",
      );
    }
    if (typeof config.bucket !== "string" || !BUCKET.test(config.bucket)) {
      throw new TypeError("S3 bucket is not valid");
    }
    if (!isStorageDomainLabel(config.storageDomain)) {
      throw new TypeError("storage domain label is not valid");
    }
    assertS3SigningConfig(config.region, config.credentials);
    const timeout: unknown = config.requestTimeoutMs;
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1 ||
      timeout > MAX_S3_REQUEST_TIMEOUT_MS
    ) {
      throw new TypeError(
        `S3 request timeout must be a whole number of milliseconds from 1 to ${MAX_S3_REQUEST_TIMEOUT_MS}`,
      );
    }
    this.endpoint = endpoint;
    this.fetch = config.fetch ?? globalThis.fetch;
    this.now = config.now ?? (() => new Date());
    this.warn =
      config.warn ?? ((message, fields) => console.warn(message, fields));
  }

  async putImmutable(input: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    // Defense in depth: the gateway checks the same; nothing invalid is sent.
    const key = evidenceObjectKey(input);
    if (key === null) {
      return { status: "invalid" };
    }
    const bytes = new TextEncoder().encode(input.canonicalPayload);
    if (
      bytes.byteLength > MAX_EVIDENCE_SEGMENT_BYTES ||
      sha256Hex(bytes) !== input.segmentHash
    ) {
      return { status: "invalid" };
    }

    const path = [this.config.bucket, ...key];
    const storageRef = evidenceStorageRef(this.config.storageDomain, key);
    // One deadline for the whole call, so a slow PUT leaves the read-back
    // only what is left of it.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.requestTimeoutMs);
    try {
      return await this.write(input, path, bytes, storageRef, abort.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async write(
    input: {
      institutionId: string;
      evidencePackageId: string;
      segmentHash: string;
    },
    path: string[],
    bytes: Uint8Array<ArrayBuffer>,
    storageRef: string,
    signal: AbortSignal,
  ): Promise<EvidencePayloadPutResult> {
    // The signer adds and signs If-None-Match: * and the SHA-256 checksum.
    const put = await this.send("PUT", path, bytes, signal);
    if (!put.ok) return this.unavailable(put.reason);
    if (put.status === 200) return { status: "stored", storageRef };
    // 412: the key exists. 409: a concurrent conditional write to the same
    // key; it may exist by now. Either way only its bytes decide.
    if (put.status !== 412 && put.status !== 409) {
      return { status: "unavailable", reason: `storage_put_status_${put.status}` };
    }

    const get = await this.send("GET", path, null, signal);
    if (!get.ok) return this.unavailable(get.reason);
    if (get.status !== 200 || get.body === null) {
      // Not found right after "exists" is not a write we can vouch for.
      return {
        status: "unavailable",
        reason: `storage_get_status_${get.status}`,
      };
    }
    if (
      sha256Hex(get.body) === input.segmentHash &&
      sameBytes(get.body, bytes)
    ) {
      return { status: "existing", storageRef };
    }
    this.warn("evidence payload conflict", {
      institutionId: input.institutionId,
      evidencePackageId: input.evidencePackageId,
      segmentHash: input.segmentHash,
    });
    return { status: "conflict" };
  }

  /**
   * Reads the bucket's identity label and compares it with what this domain
   * is configured for. Only GET; a missing, malformed or different label is
   * `mismatch`, a failed read `unavailable`.
   */
  async verifyIdentity(expected: {
    institutionId: string;
  }): Promise<
    | { status: "verified" }
    | { status: "mismatch" }
    | { status: "unavailable"; reason: string }
  > {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.requestTimeoutMs);
    try {
      const got = await this.send(
        "GET",
        [this.config.bucket, STORAGE_IDENTITY_KEY],
        null,
        abort.signal,
      );
      if (!got.ok) return this.unavailable(got.reason);
      if (got.status === 404) return { status: "mismatch" };
      if (got.status !== 200 || got.body === null) {
        return {
          status: "unavailable",
          reason: `storage_get_status_${got.status}`,
        };
      }
      return identityMatches(got.body, {
        institutionId: expected.institutionId,
        region: this.config.region,
      })
        ? { status: "verified" }
        : { status: "mismatch" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Configuration faults are also logged, by fixed reason only. */
  private unavailable(reason: string): {
    status: "unavailable";
    reason: string;
  } {
    if (reason === "storage_clock_skew" || reason === "storage_signature_rejected") {
      this.warn("evidence storage refused the request signature", { reason });
    }
    return { status: "unavailable", reason };
  }

  private async send(
    method: "GET" | "PUT",
    path: string[],
    body: Uint8Array<ArrayBuffer> | null,
    signal: AbortSignal,
  ): Promise<Fetched> {
    try {
      const signed = signS3Request({
        method,
        endpoint: this.endpoint,
        path,
        headers: method === "PUT" ? { "content-type": "application/json" } : {},
        body: body ?? new Uint8Array(),
        region: this.config.region,
        credentials: this.config.credentials,
        now: this.now(),
      });
      const response = await this.fetch(signed.url, {
        method,
        headers: signed.headers,
        body,
        redirect: "error",
        signal,
      });
      if (response.status === 400 || response.status === 403) {
        const reason = await errorReason(response, signal);
        if (reason) return { ok: false, reason };
        return { ok: true, status: response.status, body: null };
      }
      if (method === "PUT" || response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: true, status: response.status, body: null };
      }
      const read = await readLimited(response, MAX_EVIDENCE_SEGMENT_BYTES, signal);
      return read === null
        ? { ok: false, reason: "storage_object_too_large" }
        : { ok: true, status: 200, body: read };
    } catch {
      return {
        ok: false,
        reason: signal.aborted ? "storage_timeout" : "storage_request_failed",
      };
    }
  }
}

/** Exactly the two expected fields with the expected values, nothing else. */
function identityMatches(
  body: Uint8Array,
  expected: { institutionId: string; region: string },
): boolean {
  if (body.byteLength > MAX_IDENTITY_BYTES) return false;
  let label: unknown;
  try {
    label = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return false;
  }
  if (typeof label !== "object" || label === null || Array.isArray(label)) {
    return false;
  }
  const keys = Object.keys(label).sort();
  const fields = label as Record<string, unknown>;
  return (
    keys.length === 2 &&
    keys[0] === "institutionId" &&
    keys[1] === "region" &&
    fields.institutionId === expected.institutionId &&
    fields.region === expected.region
  );
}

/** The fixed reason for a known S3 error code, or null; the body never leaves. */
async function errorReason(
  response: Response,
  signal: AbortSignal,
): Promise<string | null> {
  const body = await readLimited(response, MAX_ERROR_BODY_BYTES, signal);
  if (body === null) return null;
  const code = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(
    new TextDecoder().decode(body),
  )?.[1];
  return code !== undefined && Object.hasOwn(ERROR_REASONS, code)
    ? ERROR_REASONS[code]
    : null;
}

/**
 * Reads the whole body or nothing: over `limit` is null, and an abort rejects
 * even when the body stream itself ignores the signal.
 */
async function readLimited(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  aborted.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((value, i) => value === b[i]);
}
