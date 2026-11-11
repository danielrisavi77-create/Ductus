/**
 * Import manifest `ductus-import-manifest-v1` (DAN-436, contract
 * docs/contracts/import-v1.md §2; shape fixed in
 * docs/contracts/evidence-segment-v4.md; attack plan #1911 M1 to M16).
 *
 * The server builds the manifest from the bytes it received and stores
 * `manifestSha256` beside it, never in it. An import event of segment v4
 * carries that hash as `importManifestSha256`. The manifest has no author,
 * date, revision id, e-mail or file name (D-198 t. 5, D-292).
 */
import { decodeStrictUtf8, sameBytes } from "@/domain/forensics/evidence-chain-v2";
import { canonicalizeJcs, jcsUtf8Bytes } from "@/domain/forensics/jcs";

import { isImportRawByteLength } from "./limits";

export const IMPORT_MANIFEST_SCHEMA_V1 = "ductus-import-manifest-v1";
export const IMPORT_KINDS_V1 = Object.freeze(["file-upload", "cloud-version"] as const);
export const IMPORT_FILE_FORMATS_V1 = Object.freeze(["docx", "pdf"] as const);
/** Trace kinds in the one order a manifest lists them (code unit order). */
export const IMPORT_TRACE_KINDS_V1 = Object.freeze(["comment", "deletion", "insertion"] as const);

export type ImportKindV1 = (typeof IMPORT_KINDS_V1)[number];
export type ImportFileFormatV1 = (typeof IMPORT_FILE_FORMATS_V1)[number];
export type ImportTraceKindV1 = (typeof IMPORT_TRACE_KINDS_V1)[number];
export type ImportTraceV1 = Readonly<{ traceKind: ImportTraceKindV1; count: number }>;

export type ImportManifestV1 = Readonly<{
  manifestSchema: typeof IMPORT_MANIFEST_SCHEMA_V1;
  importId: string;
  documentId: string;
  importKind: ImportKindV1;
  fileFormat: ImportFileFormatV1;
  rawSha256: string;
  rawByteLength: number;
  contentSha256: string;
  /** Present with `docx` (possibly empty), absent with `pdf`. */
  traces?: readonly ImportTraceV1[];
  /** Only with `cloud-version`: a whole UTC minute (D-24). */
  savedAt?: string;
}>;

/** What the server recomputed from the received file and content (B3). */
export type ImportRecomputedV1 = Readonly<{
  rawSha256: string;
  rawByteLength: number;
  contentSha256: string;
  traces?: readonly ImportTraceV1[];
}>;

/** Codes only: a rejection never carries input content (D-198 t. 5). */
export type ImportManifestRejectCode =
  | "MANIFEST_INVALID"
  | "MANIFEST_NOT_CANONICAL"
  | "RAW_SHA256_MISMATCH"
  | "RAW_BYTE_LENGTH_MISMATCH"
  | "CONTENT_SHA256_MISMATCH"
  | "TRACES_MISMATCH";

export type ImportManifestResult =
  | { ok: true; manifest: ImportManifestV1 }
  | { ok: false; code: ImportManifestRejectCode };

const SHA256_HEX = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WHOLE_MINUTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Same bound as a segment's `documentId` (evidence-segment-v2.ts). */
const MAX_DOCUMENT_ID_LENGTH = 256;
const REQUIRED_KEYS = ["manifestSchema", "importId", "documentId", "importKind", "fileFormat", "rawSha256", "rawByteLength", "contentSha256"];
const ALLOWED_KEYS: ReadonlySet<string> = new Set([...REQUIRED_KEYS, "traces", "savedAt"]);
const TRACE_KEYS: ReadonlySet<string> = new Set(["traceKind", "count"]);
const INVALID: ImportManifestResult = { ok: false, code: "MANIFEST_INVALID" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOneOf<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

function isWholeMinute(value: unknown): value is string {
  if (typeof value !== "string" || !WHOLE_MINUTE_UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_DOCUMENT_ID_LENGTH && !LONE_SURROGATE.test(value);
}

/** Zero to three traces, each kind once, in {@link IMPORT_TRACE_KINDS_V1} order. */
function isTraces(value: unknown): value is ImportTraceV1[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  let last = -1;
  for (const trace of value) {
    if (!isPlainObject(trace) || Object.keys(trace).length !== 2 || !Object.keys(trace).every((key) => TRACE_KEYS.has(key))) return false;
    const rank = (IMPORT_TRACE_KINDS_V1 as readonly unknown[]).indexOf(trace.traceKind);
    if (rank <= last || !Number.isSafeInteger(trace.count) || (trace.count as number) < 1) return false;
    last = rank;
  }
  return true;
}

/** Reads one parsed value with the closed format and returns a clean copy. */
export function parseImportManifestV1(value: unknown): ImportManifestResult {
  if (!isPlainObject(value)) return INVALID;
  const keys = Object.keys(value);
  if (!keys.every((key) => ALLOWED_KEYS.has(key)) || !REQUIRED_KEYS.every((key) => Object.hasOwn(value, key))) return INVALID;
  const v = value;
  if (
    v.manifestSchema !== IMPORT_MANIFEST_SCHEMA_V1 ||
    typeof v.importId !== "string" || !UUID_V4.test(v.importId) ||
    !isDocumentId(v.documentId) ||
    !isOneOf(IMPORT_KINDS_V1, v.importKind) ||
    !isOneOf(IMPORT_FILE_FORMATS_V1, v.fileFormat) ||
    typeof v.rawSha256 !== "string" || !SHA256_HEX.test(v.rawSha256) ||
    !isImportRawByteLength(v.rawByteLength) ||
    typeof v.contentSha256 !== "string" || !SHA256_HEX.test(v.contentSha256)
  ) return INVALID;
  if (v.importKind === "cloud-version" && v.fileFormat !== "docx") return INVALID;
  // docx: traces required, even when empty; pdf: no traces key at all.
  if (v.fileFormat === "docx" ? !isTraces(v.traces) : Object.hasOwn(v, "traces")) return INVALID;
  if (Object.hasOwn(v, "savedAt") && (v.importKind !== "cloud-version" || !isWholeMinute(v.savedAt))) return INVALID;

  const manifest: Record<string, unknown> = {
    manifestSchema: v.manifestSchema,
    importId: v.importId,
    documentId: v.documentId,
    importKind: v.importKind,
    fileFormat: v.fileFormat,
    rawSha256: v.rawSha256,
    rawByteLength: v.rawByteLength,
    contentSha256: v.contentSha256,
  };
  if (v.fileFormat === "docx") {
    manifest.traces = Object.freeze((v.traces as ImportTraceV1[]).map((t) => Object.freeze({ traceKind: t.traceKind, count: t.count })));
  }
  if (Object.hasOwn(v, "savedAt")) manifest.savedAt = v.savedAt;
  return { ok: true, manifest: Object.freeze(manifest) as ImportManifestV1 };
}

/**
 * Reads manifest bytes: strict UTF-8, valid by {@link parseImportManifestV1},
 * and exactly the JCS bytes of that value. A duplicate key, other key order
 * or other spelling of a number is refused, never rewritten (B-8).
 */
export function parseImportManifestV1Bytes(bytes: Uint8Array): ImportManifestResult {
  const text = decodeStrictUtf8(bytes);
  if (text === null) return INVALID;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return INVALID;
  }
  const parsed = parseImportManifestV1(value);
  if (!parsed.ok) return parsed;
  return sameBytes(jcsUtf8Bytes(parsed.manifest), bytes) ? parsed : { ok: false, code: "MANIFEST_NOT_CANONICAL" };
}

/** The canonical text whose SHA-256 is `manifestSha256`. */
export function canonicalImportManifestV1(manifest: ImportManifestV1): string {
  return canonicalizeJcs(manifest);
}

/** `manifestSha256` = SHA-256(JCS(manifest)), lowercase hex. */
export async function importManifestSha256V1(manifest: ImportManifestV1): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", jcsUtf8Bytes(manifest) as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * B3: the server recomputes the hashes and the length from the bytes it
 * received; any difference rejects the whole import. The first difference,
 * in a fixed order, names the code.
 */
export function checkImportManifestV1(manifest: ImportManifestV1, recomputed: ImportRecomputedV1): ImportManifestResult {
  if (manifest.rawSha256 !== recomputed.rawSha256) return { ok: false, code: "RAW_SHA256_MISMATCH" };
  if (manifest.rawByteLength !== recomputed.rawByteLength) return { ok: false, code: "RAW_BYTE_LENGTH_MISMATCH" };
  if (manifest.contentSha256 !== recomputed.contentSha256) return { ok: false, code: "CONTENT_SHA256_MISMATCH" };
  const declared = manifest.traces === undefined ? null : canonicalizeJcs(manifest.traces);
  const actual = recomputed.traces === undefined ? null : canonicalizeJcs(recomputed.traces);
  if (declared !== actual) return { ok: false, code: "TRACES_MISMATCH" };
  return { ok: true, manifest };
}
