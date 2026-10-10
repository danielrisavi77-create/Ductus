import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

export const EVIDENCE_SEGMENT_SCHEMA_V2 = "ductus-evidence-segment-v2" as const;
export const EVIDENCE_CANONICALIZATION_V2 = "RFC8785-JCS" as const;
export const EVIDENCE_HASH_ALGORITHM_V2 = "sha256" as const;

export const EVIDENCE_SOURCES_V2 = [
  "editor",
  "paste",
  "cut",
  "drop",
  "composition",
  "system-replacement",
] as const;

export type EvidenceSourceV2 = (typeof EVIDENCE_SOURCES_V2)[number];

export type EvidenceStepV2 = { [key: string]: JcsJsonValue };

/**
 * An event has no time of its own (D-24, D-56): events are ordered by
 * `sequence` alone, and the segment carries two whole minutes.
 */
export type EvidenceEventV2 = {
  sequence: number;
  source: EvidenceSourceV2;
  steps: EvidenceStepV2[];
  touchedNodeIds?: string[];
  beforeDocumentHash: string;
  afterDocumentHash: string;
};

export type EvidenceCaptureContextV2 = {
  editorModel: string;
  transactionFormat: string;
};

export type EvidenceSegmentV2 = {
  evidenceSchema: typeof EVIDENCE_SEGMENT_SCHEMA_V2;
  canonicalization: typeof EVIDENCE_CANONICALIZATION_V2;
  hashAlgorithm: typeof EVIDENCE_HASH_ALGORITHM_V2;
  documentId: string;
  sessionId: string;
  segmentId: string;
  sequenceFrom: number;
  sequenceTo: number;
  observedStartedAt: string;
  observedEndedAt: string;
  initialDocumentHash: string;
  finalDocumentHash: string;
  predecessorSegmentHash: string | null;
  events: EvidenceEventV2[];
  captureContext: EvidenceCaptureContextV2;
  evidenceProfileId: string;
};

export type EvidenceSegmentDigestV2 = {
  canonical: string;
  byteLength: number;
  sha256: string;
};

/**
 * Longest evidence profile id, in UTF-16 code units. One limit for the
 * segment, its descriptor and the receipt: with separate limits a segment
 * could be valid while no valid receipt can be issued for it.
 */
export const MAX_EVIDENCE_PROFILE_ID_LENGTH = 120;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const WHOLE_MINUTE_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const UUID_WITH_TIME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[167][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/i;
/** Lower-case names a step key may not have, whatever its letter case. */
const STEP_TIME_KEYS = new Set([
  "time",
  "ts",
  "at",
  "timestamp",
  "occurredat",
  "elapsedms",
]);
const MAX_ID_LENGTH = 256;
const MAX_EVENTS = 5000;
const SOURCES = new Set<string>(EVIDENCE_SOURCES_V2);
const SEGMENT_KEYS = new Set([
  "evidenceSchema",
  "canonicalization",
  "hashAlgorithm",
  "documentId",
  "sessionId",
  "segmentId",
  "sequenceFrom",
  "sequenceTo",
  "observedStartedAt",
  "observedEndedAt",
  "initialDocumentHash",
  "finalDocumentHash",
  "predecessorSegmentHash",
  "events",
  "captureContext",
  "evidenceProfileId",
]);
const EVENT_KEYS = new Set([
  "sequence",
  "source",
  "steps",
  "touchedNodeIds",
  "beforeDocumentHash",
  "afterDocumentHash",
]);
const CAPTURE_CONTEXT_KEYS = new Set(["editorModel", "transactionFormat"]);

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function nonEmptyBounded(
  value: unknown,
  max = MAX_ID_LENGTH,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/**
 * The only time a segment carries: a whole minute in UTC, written
 * `YYYY-MM-DDTHH:mm:00.000Z`. A time with seconds or milliseconds, in another
 * zone or in another spelling is refused, never rounded: the bytes are
 * addressed by their hash, so the server cannot change them.
 */
export function isEvidenceMinuteV2(value: unknown): value is string {
  if (typeof value !== "string" || !WHOLE_MINUTE_UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * True for an identifier whose layout embeds the time it was made: a UUID of
 * version 1, 6 or 7 (RFC 9562) or a ULID, in either letter case. Such an
 * identifier per segment or per node would be a clock finer than a minute.
 * This names known layouts only; it cannot show that another identifier is
 * free of time.
 */
export function isTimeOrderedIdentifierV2(value: string): boolean {
  return UUID_WITH_TIME.test(value) || ULID.test(value);
}

function isIdentifier(value: unknown): value is string {
  return nonEmptyBounded(value) && !isTimeOrderedIdentifierV2(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A key named for a time, at any depth of a step. Call only on a value JCS accepted. */
function hasTimeKey(step: EvidenceStepV2): boolean {
  const pending: JcsJsonValue[] = [step];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    for (const [key, item] of Object.entries(value)) {
      if (STEP_TIME_KEYS.has(key.toLowerCase())) return true;
      pending.push(item);
    }
  }
  return false;
}

function isStep(value: unknown): value is EvidenceStepV2 {
  if (!isPlainObject(value)) return false;
  try {
    canonicalizeJcs(value);
  } catch {
    return false;
  }
  return !hasTimeKey(value as EvidenceStepV2);
}

function isSortedUniqueStrings(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  let previous: string | null = null;
  for (const item of value) {
    if (!isIdentifier(item)) return false;
    if (previous !== null && item <= previous) return false;
    previous = item;
  }
  return true;
}

function isEvent(
  value: unknown,
  expectedSequence: number,
): value is EvidenceEventV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, EVENT_KEYS)) return false;
  if (
    value.sequence !== expectedSequence ||
    typeof value.source !== "string" ||
    !SOURCES.has(value.source) ||
    !Array.isArray(value.steps) ||
    value.steps.length === 0 ||
    !value.steps.every(isStep) ||
    !isSha256(value.beforeDocumentHash) ||
    !isSha256(value.afterDocumentHash)
  ) {
    return false;
  }
  if (
    value.touchedNodeIds !== undefined &&
    !isSortedUniqueStrings(value.touchedNodeIds)
  ) {
    return false;
  }
  return true;
}

export function isEvidenceSegmentV2(value: unknown): value is EvidenceSegmentV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SEGMENT_KEYS)) return false;

  if (
    value.evidenceSchema !== EVIDENCE_SEGMENT_SCHEMA_V2 ||
    value.canonicalization !== EVIDENCE_CANONICALIZATION_V2 ||
    value.hashAlgorithm !== EVIDENCE_HASH_ALGORITHM_V2 ||
    !isIdentifier(value.documentId) ||
    !isIdentifier(value.sessionId) ||
    !isIdentifier(value.segmentId) ||
    !nonEmptyBounded(value.evidenceProfileId, MAX_EVIDENCE_PROFILE_ID_LENGTH) ||
    !Number.isSafeInteger(value.sequenceFrom) ||
    Number(value.sequenceFrom) < 1 ||
    !Number.isSafeInteger(value.sequenceTo) ||
    !isEvidenceMinuteV2(value.observedStartedAt) ||
    !isEvidenceMinuteV2(value.observedEndedAt) ||
    Date.parse(value.observedEndedAt) < Date.parse(value.observedStartedAt) ||
    !isSha256(value.initialDocumentHash) ||
    !isSha256(value.finalDocumentHash) ||
    !(
      value.predecessorSegmentHash === null ||
      isSha256(value.predecessorSegmentHash)
    ) ||
    !Array.isArray(value.events) ||
    value.events.length < 1 ||
    value.events.length > MAX_EVENTS ||
    !isPlainObject(value.captureContext) ||
    !hasOnlyKeys(value.captureContext, CAPTURE_CONTEXT_KEYS) ||
    !nonEmptyBounded(value.captureContext.editorModel) ||
    !nonEmptyBounded(value.captureContext.transactionFormat)
  ) {
    return false;
  }

  const sequenceFrom = Number(value.sequenceFrom);
  const sequenceTo = Number(value.sequenceTo);
  if (sequenceTo !== sequenceFrom + value.events.length - 1) return false;

  let previousAfter = value.initialDocumentHash;

  for (let index = 0; index < value.events.length; index++) {
    const event = value.events[index];
    if (
      !isEvent(event, sequenceFrom + index) ||
      event.beforeDocumentHash !== previousAfter
    ) {
      return false;
    }
    previousAfter = event.afterDocumentHash;
  }

  if (previousAfter !== value.finalDocumentHash) return false;

  try {
    canonicalizeJcs(value);
    return true;
  } catch {
    return false;
  }
}

export function assertEvidenceSegmentV2(
  value: unknown,
): asserts value is EvidenceSegmentV2 {
  if (!isEvidenceSegmentV2(value)) {
    throw new Error("evidence-v2: invalid segment");
  }
}

export function canonicalEvidenceSegmentV2(segment: EvidenceSegmentV2): string {
  assertEvidenceSegmentV2(segment);
  return canonicalizeJcs(segment);
}

export async function digestEvidenceSegmentV2(
  segment: EvidenceSegmentV2,
): Promise<EvidenceSegmentDigestV2> {
  const canonical = canonicalEvidenceSegmentV2(segment);
  return {
    canonical,
    byteLength: new TextEncoder().encode(canonical).byteLength,
    sha256: await sha256WebCrypto(canonical),
  };
}
