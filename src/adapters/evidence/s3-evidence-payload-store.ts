import { createHash } from "node:crypto";

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
  S3SecretCredentials,
  sha256Hex,
  type SignedS3Request,
  signS3Request,
} from "./s3-signature";

/** Upper bound for one `putImmutable` call, every request and read included. */
export const MAX_S3_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Operator confirmation that this storage passed the contract test (#155):
 * it refuses a second conditional write and echoes the SHA-256 checksum.
 * Neither can be told apart within one request, so a store without it is
 * never used.
 */
export type S3StorageCapability = {
  provider: string;
  /** The configured endpoint, as confirmed. */
  endpoint: string;
  conditionalWrite: "verified";
  checksumEcho: "verified";
  /** Date of the contract test run, YYYY-MM-DD. */
  verifiedOn: string;
  /** Label of the contract test that confirmed both. */
  contractTest: string;
};

export type S3EvidencePayloadStoreConfig = {
  /**
   * Path-style endpoint, e.g. `https://s3.example.eu`; http only for loopback
   * with `allowPlainHttpOnLoopback`.
   */
  endpoint: string;
  region: string;
  bucket: string;
  /**
   * Operator label of this storage domain, kept in `storageRef` in place of
   * the endpoint and bucket (e.g. `fpzg-eu-1`). Operational only: it is not
   * part of the object key and never enters a signature.
   */
  storageDomain: string;
  /**
   * Sealed, so a configuration that is logged or serialized shows no key;
   * plain keys are refused.
   */
  credentials: S3SecretCredentials;
  /**
   * Deadline for one `putImmutable` call as a whole (the PUT, a read-back and
   * reading the answers). No default on purpose (BACKEND 6 t. 10): a missing
   * value stops startup.
   */
  requestTimeoutMs: number;
  /**
   * Set only by local and CI configuration; refused when NODE_ENV is
   * production, so a production endpoint is always https.
   */
  allowPlainHttpOnLoopback?: boolean;
  capability: S3StorageCapability;
  fetch?: typeof fetch;
  now?: () => Date;
  /** Receives ids and hashes only, never the payload (BACKEND 4.9). */
  warn?: (message: string, fields: Record<string, string>) => void;
};

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
/**
 * Names S3 providers refuse although they match BUCKET: IP addresses,
 * adjacent dots or dot-hyphen pairs, and AWS reserved prefixes and suffixes.
 */
const BUCKET_REFUSED =
  /^\d{1,3}(\.\d{1,3}){3}$|\.\.|\.-|-\.|^(xn--|sthree-|amzn-s3-demo-)|(-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3)$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CAPABILITY_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
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

const isSignatureFault = (reason: string) =>
  reason === "storage_clock_skew" || reason === "storage_signature_rejected";

const timedOut = (): EvidencePayloadPutResult => ({
  status: "unavailable",
  reason: "storage_timeout",
});

const unverified = (): EvidencePayloadPutResult => ({
  status: "unavailable",
  reason: "storage_write_unverified",
});

/**
 * State of one `putImmutable` call. `deadline` is on the monotonic clock
 * (`performance.now`), so a late timer or a changed wall clock moves nothing.
 *
 * The deadline rule: a deadline check is the last expression before every
 * fetch and before every return that claims anything about the content
 * (stored, existing, conflict). Time the runtime spends between that
 * expression and the system call itself, or the return reaching the caller,
 * cannot be bounded inside the process and is not part of the guarantee.
 */
type WritePhase = {
  deadline: number;
  /** The last monotonic reading; a later one may not be earlier. */
  read: number;
  /** Set once the PUT echo matches within the deadline, before the read-back. */
  echoConfirmed: boolean;
  /** Set once the deadline has answered the call, by the timer or a check. */
  expired: boolean;
};

const idsOf = (input: {
  institutionId: string;
  evidencePackageId: string;
  segmentHash: string;
}): Record<string, string> => ({
  institutionId: input.institutionId,
  evidencePackageId: input.evidencePackageId,
  segmentHash: input.segmentHash,
});

type Fetched =
  | { ok: true; status: number; body: Uint8Array | null; checksum: string | null }
  | { ok: false; reason: string };

/**
 * Evidence payload store on an S3 API (BACKEND 4.1, D-08 still PRIJEDLOG).
 *
 * One conditional PUT per object (`If-None-Match: *`) with a SHA-256 checksum:
 * no multipart upload, no overwrite, no delete. When the key already exists
 * the object is read back and compared byte for byte, never by ETag. A 200 is
 * `stored` only with both proofs (#155): the echoed checksum equals the one
 * sent, and reading the object back gives the same bytes. The read-back runs
 * after every write and has no switch. Every
 * doubtful answer is `unavailable`; retrying is the client's job, so the store
 * itself never retries and never follows a redirect. Requests go only to the
 * configured endpoint; the signer builds every URL from validated parts.
 */
export class S3EvidencePayloadStore implements EvidencePayloadStore {
  private readonly endpoint: URL;
  private readonly region: string;
  private readonly bucket: string;
  private readonly storageDomain: string;
  private readonly requestTimeoutMs: number;
  /**
   * A native private field: the keys are not reachable by enumeration,
   * `JSON.stringify` or `util.inspect` of the instance, and the copy keeps
   * a later change to the caller's object out of the signer.
   */
  readonly #credentials: Readonly<S3Credentials>;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly warn: (
    message: string,
    fields: Record<string, string>,
  ) => void;

  constructor(config: S3EvidencePayloadStoreConfig) {
    const endpoint = parseEndpoint(config.endpoint);
    const plainHttp =
      config.allowPlainHttpOnLoopback === true &&
      process.env.NODE_ENV !== "production";
    if (
      endpoint === null ||
      !(
        endpoint.protocol === "https:" ||
        (endpoint.protocol === "http:" &&
          plainHttp &&
          LOOPBACK.has(endpoint.hostname))
      ) ||
      endpoint.href !== `${endpoint.origin}/`
    ) {
      throw new TypeError(
        "S3 endpoint must be https (http only on loopback when allowed) without a path",
      );
    }
    if (
      typeof config.bucket !== "string" ||
      !BUCKET.test(config.bucket) ||
      BUCKET_REFUSED.test(config.bucket)
    ) {
      throw new TypeError("S3 bucket is not valid");
    }
    if (!isStorageDomainLabel(config.storageDomain)) {
      throw new TypeError("storage domain label is not valid");
    }
    const credentials = S3SecretCredentials.reveal(config.credentials);
    assertS3SigningConfig(config.region, credentials);
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
    const now = config.now ?? (() => new Date());
    if (!isConfirmed(config.capability, endpoint, now())) {
      throw new TypeError(
        "S3 storage capability must be confirmed by a contract test for this endpoint",
      );
    }
    this.endpoint = endpoint;
    this.region = config.region;
    this.bucket = config.bucket;
    this.storageDomain = config.storageDomain;
    this.requestTimeoutMs = timeout;
    this.#credentials = Object.freeze(credentials);
    this.fetch = config.fetch ?? globalThis.fetch;
    this.now = now;
    this.warn =
      config.warn ?? ((message, fields) => console.warn(message, fields));
  }

  async putImmutable(given: {
    institutionId: string;
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult> {
    // One deadline for the whole call, so checking the input and a slow PUT
    // leave the read-back only what is left of it. The deadline itself is a
    // monotonic instant, checked by `send` right before every request and
    // after every answer and outcome, so a timer that fires late (a busy
    // event loop) cannot let a late answer count. The timer only stops the
    // waiting: its race ends the call even when a fetch ignores the signal.
    // Started after the deadline is read, it never answers before it.
    const phase: WritePhase = {
      deadline: Number.NEGATIVE_INFINITY,
      read: Number.NEGATIVE_INFINITY,
      echoConfirmed: false,
      expired: false,
    };
    // A start that cannot be read leaves the deadline at -Infinity: late.
    const start = readClock(phase);
    if (start !== null) phase.deadline = start + this.requestTimeoutMs;
    // Each field is read exactly once, here, after the deadline starts, so a
    // slow getter spends the call's time, not a fresh one. The check, the key,
    // the comparison and the logged identifiers all use these values, so a
    // caller that changes its object (or a getter) during the call cannot
    // rebind them.
    const input = {
      institutionId: given.institutionId,
      evidencePackageId: given.evidencePackageId,
      segmentHash: given.segmentHash,
      canonicalPayload: given.canonicalPayload,
    };
    const abort = new AbortController();
    // Runs synchronously up to its first fetch, whose deadline check is the
    // last clock reading; the timer gets what is left of the deadline from
    // there, never a fresh interval. No reading at all leaves nothing.
    const run = this.attempt(input, phase, abort.signal);
    const left = phase.deadline - phase.read;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<EvidencePayloadPutResult>((resolve) => {
      timer = setTimeout(
        () => {
          resolve(this.expire(input, phase));
          abort.abort();
        },
        Number.isFinite(left) ? Math.max(0, Math.ceil(left)) : 0,
      );
    });
    try {
      return await Promise.race([run, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async attempt(
    input: {
      institutionId: string;
      evidencePackageId: string;
      segmentHash: string;
      canonicalPayload: string;
    },
    phase: WritePhase,
    signal: AbortSignal,
  ): Promise<EvidencePayloadPutResult> {
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

    const path = [this.bucket, ...key];
    const storageRef = evidenceStorageRef(this.storageDomain, key);
    // The signer adds and signs If-None-Match: * and the SHA-256 checksum.
    const signedPut = this.sign("PUT", path, bytes);
    return this.write(input, path, bytes, signedPut, storageRef, phase, signal);
  }

  private async write(
    input: {
      institutionId: string;
      evidencePackageId: string;
      segmentHash: string;
    },
    path: string[],
    bytes: Uint8Array<ArrayBuffer>,
    signedPut: SignedS3Request | null,
    storageRef: string,
    phase: WritePhase,
    signal: AbortSignal,
  ): Promise<EvidencePayloadPutResult> {
    const put = await this.send("PUT", signedPut, bytes, phase, signal);
    // A late answer, a matching echo included, confirms nothing and starts
    // no further request: the deadline answers storage_timeout.
    if (late(phase)) return this.expire(input, phase);
    if (!put.ok) return this.unavailable(put.reason);
    if (put.status === 200) {
      return this.verify(input, path, bytes, put, storageRef, phase, signal);
    }
    // 412: the key exists. 409: a concurrent conditional write to the same
    // key; it may exist by now. Either way only its bytes decide.
    if (put.status !== 412 && put.status !== 409) {
      return { status: "unavailable", reason: `storage_put_status_${put.status}` };
    }

    const signedGet = this.sign("GET", path, null);
    const get = await this.send("GET", signedGet, null, phase, signal);
    if (late(phase)) return this.expire(input, phase);
    if (!get.ok) return this.unavailable(get.reason);
    if (get.status !== 200 || get.body === null) {
      // Not found right after "exists" is not a write we can vouch for.
      return {
        status: "unavailable",
        reason: `storage_get_status_${get.status}`,
      };
    }
    // Only identical bytes are the same object, as after a 200: the port
    // promises bytes, not a hash.
    const same = sameBytes(get.body, bytes);
    // Checked after comparing, right before the outcome: past the deadline
    // neither existing nor conflict, and no late conflict log.
    if (late(phase)) return this.expire(input, phase);
    if (same) return { status: "existing", storageRef };
    this.log("evidence payload conflict", idsOf(input));
    return { status: "conflict" };
  }

  /**
   * The write proof: the echo must equal the checksum sent, and the object
   * read back must hold the same bytes. Anything less is not `stored`; other
   * bytes under the key are a conflict.
   */
  private async verify(
    input: {
      institutionId: string;
      evidencePackageId: string;
      segmentHash: string;
    },
    path: string[],
    bytes: Uint8Array<ArrayBuffer>,
    put: { checksum: string | null },
    storageRef: string,
    phase: WritePhase,
    signal: AbortSignal,
  ): Promise<EvidencePayloadPutResult> {
    const ids = idsOf(input);
    const sent = createHash("sha256").update(bytes).digest("base64");
    if (put.checksum === sent) {
      phase.echoConfirmed = true;
      const signedGet = this.sign("GET", path, null);
      const get = await this.send("GET", signedGet, null, phase, signal);
      const same =
        get.ok && get.status === 200 && get.body !== null
          ? sameBytes(get.body, bytes)
          : null;
      // Past the deadline, comparing included: an unverified write, logged
      // once by `expire`, never stored.
      if (late(phase)) return this.expire(input, phase);
      if (same === true) return { status: "stored", storageRef };
      if (same === false) {
        this.log("evidence payload conflict", ids);
        return { status: "conflict" };
      }
      // An orphan candidate: the object may or may not be there. A refused
      // signature is logged as the cause; the caller sees the plan's outcome.
      this.log(
        "evidence payload write unverified",
        !get.ok && isSignatureFault(get.reason) ? { ...ids, cause: get.reason } : ids,
      );
      return unverified();
    }
    this.log("evidence payload write unverified", ids);
    return unverified();
  }

  /**
   * The deadline's answer, the same whether the timer or a check reaches it
   * first. Once the PUT echo is confirmed the object may exist, so it is an
   * unverified write, logged exactly once; before that it is a timeout.
   */
  private expire(
    input: { institutionId: string; evidencePackageId: string; segmentHash: string },
    phase: WritePhase,
  ): EvidencePayloadPutResult {
    const first = !phase.expired;
    phase.expired = true;
    if (!phase.echoConfirmed) return timedOut();
    if (first) this.log("evidence payload write unverified", idsOf(input));
    return unverified();
  }

  /** Configuration faults are also logged, by fixed reason only. */
  private unavailable(reason: string): EvidencePayloadPutResult {
    if (isSignatureFault(reason)) {
      this.log("evidence storage refused the request signature", { reason });
    }
    return { status: "unavailable", reason };
  }

  /**
   * Off the path to the outcome: the line is written in a later macrotask
   * (setImmediate; this adapter runs on Node only, it hashes with
   * node:crypto), so the caller awaiting the outcome resumes first and a
   * logger that blocks, throws, hangs or rejects can neither delay nor change
   * it. A microtask would not do: it runs before the caller resumes. Not
   * unref'd: an immediate runs in the same turn of the event loop, so it
   * keeps the process no longer than that, and an unref'd one could be
   * dropped at exit and lose the line. A failing logger neither fails the
   * call nor carries anything out of it.
   */
  private log(message: string, fields: Record<string, string>): void {
    setImmediate(() => {
      try {
        const result: unknown = this.warn(message, fields);
        void Promise.resolve(result).catch(() => undefined);
      } catch {
        // Dropped on purpose: its error may hold whatever the logger had.
      }
    });
  }

  /**
   * Signs one request, or answers null when it cannot be signed. Synchronous
   * and kept apart from `send`, which checks the deadline after the signing,
   * right before the request leaves.
   */
  private sign(
    method: "GET" | "PUT",
    path: string[],
    body: Uint8Array<ArrayBuffer> | null,
  ): SignedS3Request | null {
    try {
      return signS3Request({
        method,
        endpoint: this.endpoint,
        path,
        headers: method === "PUT" ? { "content-type": "application/json" } : {},
        body: body ?? new Uint8Array(),
        region: this.region,
        credentials: this.#credentials,
        now: this.now(),
      });
    } catch {
      return null;
    }
  }

  private async send(
    method: "GET" | "PUT",
    signed: SignedS3Request | null,
    body: Uint8Array<ArrayBuffer> | null,
    phase: WritePhase,
    signal: AbortSignal,
  ): Promise<Fetched> {
    // No request starts after the deadline, even from a late answer: the
    // last step before every fetch, with nothing awaited in between.
    // The timer marks the phase expired before it aborts, so this also
    // covers an aborted signal.
    if (late(phase)) return { ok: false, reason: "storage_timeout" };
    if (signed === null) return { ok: false, reason: "storage_request_failed" };
    try {
      const response = await this.fetch(signed.url, {
        method,
        // Asks for the stored bytes as they are. Unsigned on purpose: an
        // intermediary may rewrite it, and the check below, not the request,
        // is what keeps a decoded body from being compared.
        headers:
          method === "GET"
            ? { ...signed.headers, "accept-encoding": "identity" }
            : signed.headers,
        body,
        redirect: "error",
        signal,
      });
      if (response.status === 400 || response.status === 403) {
        const reason = await errorReason(response, signal);
        if (reason) return { ok: false, reason };
        return { ok: true, status: response.status, body: null, checksum: null };
      }
      if (method === "PUT" || response.status !== 200) {
        // Not awaited: a cancel that never settles must not outlast the deadline.
        void response.body?.cancel().catch(() => undefined);
        return {
          ok: true,
          status: response.status,
          body: null,
          checksum: response.headers.get("x-amz-checksum-sha256"),
        };
      }
      // fetch decodes gzip, deflate and br on its own, so an encoded object
      // would be compared as other bytes than it holds: never compared.
      const encoding = response.headers.get("content-encoding");
      if (encoding !== null && encoding.toLowerCase() !== "identity") {
        void response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: "storage_get_encoded" };
      }
      const read = await readLimited(response, MAX_EVIDENCE_SEGMENT_BYTES, signal);
      return read === null
        ? { ok: false, reason: "storage_object_too_large" }
        : { ok: true, status: 200, body: read, checksum: null };
    } catch {
      return {
        ok: false,
        reason: signal.aborted ? "storage_timeout" : "storage_request_failed",
      };
    }
  }
}

/**
 * Whether the call's deadline has passed, by the monotonic clock. A clock
 * that cannot be read or runs backwards proves no time left. Every caller
 * ends the call on a late answer, so no later reading can undo it.
 */
function late(phase: WritePhase): boolean {
  if (phase.expired) return true;
  const now = readClock(phase);
  return now === null || now >= phase.deadline;
}

/**
 * The one place that reads the monotonic clock. A reading that is not
 * finite or is earlier than the last one is refused (null), and the call
 * is late: fail closed, the outcome follows the echo phase.
 */
function readClock(phase: WritePhase): number | null {
  const now = performance.now();
  if (!Number.isFinite(now) || now < phase.read) return null;
  phase.read = now;
  return now;
}

/**
 * Node's URL error keeps the whole input, credentials included; this answer
 * keeps nothing of it.
 */
function parseEndpoint(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Both capabilities confirmed for exactly this endpoint, on a real past date. */
function isConfirmed(value: unknown, endpoint: URL, now: Date): boolean {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<Record<keyof S3StorageCapability, unknown>>;
  if (
    c.conditionalWrite !== "verified" ||
    c.checksumEcho !== "verified" ||
    typeof c.provider !== "string" ||
    !CAPABILITY_LABEL.test(c.provider) ||
    typeof c.contractTest !== "string" ||
    !CAPABILITY_LABEL.test(c.contractTest) ||
    typeof c.endpoint !== "string" ||
    parseEndpoint(c.endpoint)?.href !== endpoint.href ||
    typeof c.verifiedOn !== "string" ||
    !ISO_DATE.test(c.verifiedOn)
  ) {
    return false;
  }
  const day = new Date(`${c.verifiedOn}T00:00:00Z`);
  return (
    !Number.isNaN(day.getTime()) &&
    day.toISOString().startsWith(c.verifiedOn) &&
    day.getTime() <= now.getTime()
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
        void reader.cancel().catch(() => undefined);
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
