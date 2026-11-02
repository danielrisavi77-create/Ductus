import { EDIT_STEP_FORMAT_V1, parseEditSteps } from "../document/edit-step";
import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

export const EVIDENCE_SEGMENT_SCHEMA_V2 = "ductus-evidence-segment-v2" as const;
export const EVIDENCE_CANONICALIZATION_V2 = "RFC8785-JCS" as const;
export const EVIDENCE_HASH_ALGORITHM_V2 = "sha256" as const;

/**
 * What a change of the document is attributed to. The set is closed: a value
 * outside it is refused, and a new one needs a new format version.
 *
 * Attribution is positive or absent (D-54, owner decisions of 10 October 2026).
 * `editor` is written only for a change the capture layer positively
 * attributed to typing in the editor, never for want of a better value.
 * `composition` is written only when the capture layer has positive proof
 * that the character was composed with physical keys. In every other case,
 * also when there is no proof or the proof is ambiguous, `keyless-input` is
 * written. `keyless-input` is text entered without key events (dictation, an
 * on-screen keyboard, an input method with no such proof); its size is the
 * size of its steps. Every change with no positive attribution is
 * `unattributed`, and so is a paste or a drop whose event cannot be relied on.
 * The server cannot observe attribution: it keeps the set closed, and the
 * capture layer keeps these rules. The ninth value, `citation-form`, came with
 * a new format version, v3 (below).
 */
export const EVIDENCE_SOURCES_V2 = [
  "editor",
  "paste",
  "cut",
  "drop",
  "composition",
  "system-replacement",
  "keyless-input",
  "unattributed",
] as const;

export type EvidenceSourceV2 = (typeof EVIDENCE_SOURCES_V2)[number];

/**
 * Format v3 (owner decision on #87, "Idemo v3"; contract on #896) is v2 with
 * one more source: `citation-form`, text the Literatura form inserted, and
 * only that. Every other rule of v2 holds for v3 unchanged. A segment is
 * written as v3 only when one of its events is `citation-form`
 * (`evidenceSchemaForEvents`), so every other segment keeps its v2 bytes; a v2
 * segment never carries `citation-form`. A package may hold v2 and v3
 * segments in any order, since a tab opened before v3 keeps writing v2.
 */
export const EVIDENCE_SEGMENT_SCHEMA_V3 = "ductus-evidence-segment-v3" as const;

export const EVIDENCE_SOURCES_V3 = [...EVIDENCE_SOURCES_V2, "citation-form"] as const;

export type EvidenceSourceV3 = (typeof EVIDENCE_SOURCES_V3)[number];

/** Any source a segment of any accepted version may carry. */
export type EvidenceSource = EvidenceSourceV3;

/**
 * The editor models a segment may name. The list is closed, like the step
 * format: a free text here could carry anything, a time included (B-8, #155).
 */
export const EVIDENCE_EDITOR_MODELS_V2 = ["prosemirror"] as const;

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
  editorModel: (typeof EVIDENCE_EDITOR_MODELS_V2)[number];
  transactionFormat: typeof EDIT_STEP_FORMAT_V1;
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

export type EvidenceEventV3 = Omit<EvidenceEventV2, "source"> & { source: EvidenceSourceV3 };

export type EvidenceSegmentV3 = Omit<EvidenceSegmentV2, "evidenceSchema" | "events"> & {
  evidenceSchema: typeof EVIDENCE_SEGMENT_SCHEMA_V3;
  events: EvidenceEventV3[];
};

/** A segment of any accepted version. */
export type EvidenceSegment = EvidenceSegmentV2 | EvidenceSegmentV3;

export type EvidenceSegmentSchema = EvidenceSegment["evidenceSchema"];

/** The schema a segment with these events is written in (contract #896, P1). */
export function evidenceSchemaForEvents(
  events: readonly { source: EvidenceSource }[],
): EvidenceSegmentSchema {
  return events.some((event) => event.source === "citation-form")
    ? EVIDENCE_SEGMENT_SCHEMA_V3
    : EVIDENCE_SEGMENT_SCHEMA_V2;
}

export function isEvidenceSegmentSchema(value: unknown): value is EvidenceSegmentSchema {
  return value === EVIDENCE_SEGMENT_SCHEMA_V2 || value === EVIDENCE_SEGMENT_SCHEMA_V3;
}

/**
 * Reserved once, together, before the first real evidence (D-34 and D-132;
 * DAN-453 PR 0, contract on #1091, attack plan #1258 G1 and G2). Nothing
 * here is accepted by any version: a segment that carries one of these
 * values is refused like any unknown value, and lifting a reservation needs
 * a new format version with its own vectors, so v2 and v3 keep their bytes.
 *
 * - `applied-suggestion` (D-34): text the student applied from a teacher's
 *   suggestion, carried with `suggestionId`, the id of the suggestion the
 *   server stored under the teacher's session.
 * - `own-variant` (D-132): a switch to the student's own variant of a
 *   paragraph, one event carried with `variantId`; the variant itself is a
 *   record of its own kind, `ductus-evidence-variant-v1`, never a segment.
 */
export const RESERVED_EVIDENCE_SOURCES = ["applied-suggestion", "own-variant"] as const;

/** Event fields reserved with the sources above, in the same order. */
export const RESERVED_EVIDENCE_EVENT_FIELDS = ["suggestionId", "variantId"] as const;

/** Record kinds reserved for D-132, never a segment schema. */
export const RESERVED_EVIDENCE_RECORD_SCHEMAS = ["ductus-evidence-variant-v1"] as const;

const RESERVED_SOURCES: ReadonlySet<unknown> = new Set(RESERVED_EVIDENCE_SOURCES);

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
const MAX_ID_LENGTH = 256;
const MAX_EVENTS = 5000;
type SourcesBySchema = ReadonlyMap<string, ReadonlySet<string>>;
const SOURCES_V2: ReadonlySet<string> = new Set<string>(EVIDENCE_SOURCES_V2);
const SOURCES_V3: ReadonlySet<string> = new Set<string>(EVIDENCE_SOURCES_V3);
const ONLY_V2: SourcesBySchema = new Map([[EVIDENCE_SEGMENT_SCHEMA_V2, SOURCES_V2]]);
const V2_OR_V3: SourcesBySchema = new Map([
  [EVIDENCE_SEGMENT_SCHEMA_V2, SOURCES_V2],
  [EVIDENCE_SEGMENT_SCHEMA_V3, SOURCES_V3],
]);
const EDITOR_MODELS = new Set<string>(EVIDENCE_EDITOR_MODELS_V2);
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

// A high surrogate not followed by a low one, or a low one not after a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * A profile id a segment v2 takes: not blank, at most 120 UTF-16 units, and
 * well-formed UTF-16, which canonical JSON needs (jcs.ts) (#733).
 */
export function isEvidenceProfileIdV2(value: unknown): value is string {
  return nonEmptyBounded(value, MAX_EVIDENCE_PROFILE_ID_LENGTH) && !LONE_SURROGATE.test(value);
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
 * The form of the two times of a segment: a whole minute in UTC, written
 * `YYYY-MM-DDTHH:mm:00.000Z`. A time with seconds or milliseconds, in another
 * zone or in another spelling is refused, never rounded: the bytes are
 * addressed by their hash, so the server cannot change them.
 */
export function isEvidenceMinuteV2(value: unknown): value is string {
  if (typeof value !== "string" || !WHOLE_MINUTE_UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The steps of one event are read with the closed format, and the answer is
 * yes or no. The parser builds a clean copy; it is never used, since the hash
 * is over the bytes that were sent and a cleaned copy is not what was sent.
 */
function areSteps(value: unknown): value is EvidenceStepV2[] {
  return parseEditSteps(EDIT_STEP_FORMAT_V1, value).ok;
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
  sources: ReadonlySet<string>,
): value is EvidenceEventV3 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, EVENT_KEYS)) return false;
  if (
    value.sequence !== expectedSequence ||
    typeof value.source !== "string" ||
    // Before the closed set, so that a version that took a reserved source
    // into its set by mistake still refuses it (D-34, D-132).
    RESERVED_SOURCES.has(value.source) ||
    !sources.has(value.source) ||
    !areSteps(value.steps) ||
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

/**
 * Never throws: a hostile object (a Proxy or a getter that throws when read)
 * is not a segment, and the answer is false like for any other refusal.
 */
export function isEvidenceSegmentV2(value: unknown): value is EvidenceSegmentV2 {
  try {
    return isSegmentUnguarded(value, ONLY_V2);
  } catch {
    return false;
  }
}

/**
 * A segment of v2 or v3: each version with its own closed set of sources and
 * every other rule shared. Never throws, like `isEvidenceSegmentV2`. This is
 * the one check the client (before it sends) and the server (before it
 * accepts) both use, through `verifyCanonicalEvidencePayloadV2`.
 */
export function isEvidenceSegment(value: unknown): value is EvidenceSegment {
  try {
    return isSegmentUnguarded(value, V2_OR_V3);
  } catch {
    return false;
  }
}

function isSegmentUnguarded(value: unknown, schemas: SourcesBySchema): boolean {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SEGMENT_KEYS)) return false;
  const sources =
    typeof value.evidenceSchema === "string" ? schemas.get(value.evidenceSchema) : undefined;

  if (
    sources === undefined ||
    value.canonicalization !== EVIDENCE_CANONICALIZATION_V2 ||
    value.hashAlgorithm !== EVIDENCE_HASH_ALGORITHM_V2 ||
    !nonEmptyBounded(value.documentId) ||
    !nonEmptyBounded(value.sessionId) ||
    !nonEmptyBounded(value.segmentId) ||
    !isEvidenceProfileIdV2(value.evidenceProfileId) ||
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
    typeof value.captureContext.editorModel !== "string" ||
    !EDITOR_MODELS.has(value.captureContext.editorModel) ||
    value.captureContext.transactionFormat !== EDIT_STEP_FORMAT_V1
  ) {
    return false;
  }

  const sequenceFrom = Number(value.sequenceFrom);
  const sequenceTo = Number(value.sequenceTo);
  // Counted as to - from, which is exact for safe integers: from + count - 1
  // can round in a double and pass a segment with more events than its range.
  // With it every from + index below is at most sequenceTo, so exact too.
  if (sequenceTo - sequenceFrom !== value.events.length - 1) return false;

  let previousAfter = value.initialDocumentHash;

  for (let index = 0; index < value.events.length; index++) {
    const event = value.events[index];
    if (
      !isEvent(event, sequenceFrom + index, sources) ||
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
  return digestOf(canonicalEvidenceSegmentV2(segment));
}

export function assertEvidenceSegment(value: unknown): asserts value is EvidenceSegment {
  if (!isEvidenceSegment(value)) {
    throw new Error("evidence-v2: invalid segment");
  }
}

export function canonicalEvidenceSegment(segment: EvidenceSegment): string {
  assertEvidenceSegment(segment);
  return canonicalizeJcs(segment);
}

export async function digestEvidenceSegment(
  segment: EvidenceSegment,
): Promise<EvidenceSegmentDigestV2> {
  return digestOf(canonicalEvidenceSegment(segment));
}

async function digestOf(canonical: string): Promise<EvidenceSegmentDigestV2> {
  return {
    canonical,
    byteLength: new TextEncoder().encode(canonical).byteLength,
    sha256: await sha256WebCrypto(canonical),
  };
}
