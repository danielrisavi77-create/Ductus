import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

export const EVIDENCE_SEGMENT_SCHEMA_V2 = "pisac-evidence-segment-v2" as const;
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

export type EvidenceEventV2 = {
  sequence: number;
  occurredAt: string;
  elapsedMs: number;
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

const SHA256_HEX = /^[0-9a-f]{64}$/;
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
  "occurredAt",
  "elapsedMs",
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

function nonEmptyBounded(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStep(value: unknown): value is EvidenceStepV2 {
  if (!isPlainObject(value)) return false;
  try {
    canonicalizeJcs(value);
    return true;
  } catch {
    return false;
  }
}

function isSortedUniqueStrings(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  let previous: string | null = null;
  for (const item of value) {
    if (!nonEmptyBounded(item)) return false;
    if (previous !== null && item <= previous) return false;
    previous = item;
  }
  return true;
}

function isEvent(
  value: unknown,
  expectedSequence: number,
  start: number,
  end: number,
  previousElapsed: number,
): value is EvidenceEventV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, EVENT_KEYS)) return false;
  if (
    value.sequence !== expectedSequence ||
    !isCanonicalIsoInstant(value.occurredAt) ||
    Date.parse(value.occurredAt) < start ||
    Date.parse(value.occurredAt) > end ||
    typeof value.elapsedMs !== "number" ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    value.elapsedMs < previousElapsed ||
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
    !nonEmptyBounded(value.documentId) ||
    !nonEmptyBounded(value.sessionId) ||
    !nonEmptyBounded(value.segmentId) ||
    !nonEmptyBounded(value.evidenceProfileId) ||
    !Number.isSafeInteger(value.sequenceFrom) ||
    Number(value.sequenceFrom) < 1 ||
    !Number.isSafeInteger(value.sequenceTo) ||
    !isCanonicalIsoInstant(value.observedStartedAt) ||
    !isCanonicalIsoInstant(value.observedEndedAt) ||
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

  const start = Date.parse(value.observedStartedAt);
  const end = Date.parse(value.observedEndedAt);
  let previousElapsed = 0;
  let previousAfter = value.initialDocumentHash;

  for (let index = 0; index < value.events.length; index++) {
    const event = value.events[index];
    if (
      !isEvent(event, sequenceFrom + index, start, end, previousElapsed) ||
      event.beforeDocumentHash !== previousAfter
    ) {
      return false;
    }
    previousElapsed = event.elapsedMs;
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
