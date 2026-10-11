import { createHash } from "node:crypto";

import {
  isEvidencePackageId,
  isSha256Hex,
} from "@/application/ports/evidence-ingest";
import type {
  EvidencePayloadPutResult,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import { type S3Credentials, sha256Hex, signS3Request } from "./s3-signature";

/** Upper bound for one storage request, the read of a response included. */
export const MAX_S3_REQUEST_TIMEOUT_MS = 60_000;

export type S3EvidencePayloadStoreConfig = {
  /** Path-style endpoint, e.g. `https://s3.example.eu`; http only for loopback. */
  endpoint: string;
  region: string;
  bucket: string;
  credentials: S3Credentials;
  /** No default on purpose (BACKEND 6 t. 10): a missing value stops startup. */
  requestTimeoutMs: number;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Receives ids and hashes only, never the payload (BACKEND 4.9). */
  warn?: (message: string, fields: Record<string, string>) => void;
};

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION = /^[a-z0-9-]{1,32}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const EMPTY_SHA256 = sha256Hex(new Uint8Array());

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
 * itself never retries.
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
      endpoint.pathname !== "/" ||
      endpoint.search !== "" ||
      endpoint.username !== "" ||
      endpoint.password !== ""
    ) {
      throw new TypeError(
        "S3 endpoint must be https (http only on loopback) without a path",
      );
    }
    if (!BUCKET.test(config.bucket) || !REGION.test(config.region)) {
      throw new TypeError("S3 bucket or region is not valid");
    }
    if (
      !config.credentials.accessKeyId ||
      !config.credentials.secretAccessKey
    ) {
      throw new TypeError("S3 credentials are required");
    }
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
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    // Defense in depth: the gateway checks the same; nothing invalid is sent.
    if (
      !isEvidencePackageId(input.evidencePackageId) ||
      !isSha256Hex(input.segmentHash)
    ) {
      return { status: "invalid" };
    }
    const bytes = new TextEncoder().encode(input.canonicalPayload);
    const digest = createHash("sha256").update(bytes).digest();
    if (
      bytes.byteLength > MAX_EVIDENCE_SEGMENT_BYTES ||
      digest.toString("hex") !== input.segmentHash
    ) {
      return { status: "invalid" };
    }

    const key = `v2/${input.evidencePackageId}/${input.segmentHash}.json`;
    const url = new URL(`${this.config.bucket}/${key}`, this.endpoint);
    const storageRef = `s3://${this.config.bucket}/${key}`;

    const put = await this.send("PUT", url, bytes, input.segmentHash, {
      "content-type": "application/json",
      "if-none-match": "*",
      "x-amz-checksum-sha256": digest.toString("base64"),
    });
    if (!put.ok) return { status: "unavailable", reason: put.reason };
    if (put.status === 200) return { status: "stored", storageRef };
    // 412: the key exists. 409: a concurrent conditional write to the same
    // key; it may exist by now. Either way only its bytes decide.
    if (put.status !== 412 && put.status !== 409) {
      return {
        status: "unavailable",
        reason: `storage_put_status_${put.status}`,
      };
    }

    const get = await this.send("GET", url, null, EMPTY_SHA256, {});
    if (!get.ok) return { status: "unavailable", reason: get.reason };
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
      evidencePackageId: input.evidencePackageId,
      segmentHash: input.segmentHash,
    });
    return { status: "conflict" };
  }

  private async send(
    method: "GET" | "PUT",
    url: URL,
    body: Uint8Array<ArrayBuffer> | null,
    payloadSha256Hex: string,
    headers: Record<string, string>,
  ): Promise<Fetched> {
    const signed = signS3Request({
      method,
      url,
      headers,
      payloadSha256Hex,
      region: this.config.region,
      credentials: this.config.credentials,
      now: this.now(),
    });
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.requestTimeoutMs);
    try {
      const response = await this.fetch(url, {
        method,
        headers: signed,
        body,
        redirect: "error",
        signal: abort.signal,
      });
      if (method === "PUT" || response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: true, status: response.status, body: null };
      }
      const read = await readLimited(
        response,
        MAX_EVIDENCE_SEGMENT_BYTES,
        abort.signal,
      );
      return read === null
        ? { ok: false, reason: "storage_object_too_large" }
        : { ok: true, status: 200, body: read };
    } catch {
      return {
        ok: false,
        reason: abort.signal.aborted
          ? "storage_timeout"
          : "storage_request_failed",
      };
    } finally {
      clearTimeout(timer);
    }
  }
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
