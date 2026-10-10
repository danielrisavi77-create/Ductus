import type { AuthorizationContext } from "./authorization";
import { hasOnlyKeys, isPlainObject } from "@/domain/json";
import { exceedsEvidenceSegmentLimit } from "@/domain/forensics/evidence-chain-v2";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  MAX_EVIDENCE_PROFILE_ID_LENGTH,
} from "@/domain/forensics/evidence-segment-v2";

export type EvidenceSegmentDescriptorV2 = {
  evidencePackageId: string;
  documentId: string;
  sessionId: string;
  segmentId: string;
  evidenceSchema: typeof EVIDENCE_SEGMENT_SCHEMA_V2;
  canonicalization: typeof EVIDENCE_CANONICALIZATION_V2;
  hashAlgorithm: typeof EVIDENCE_HASH_ALGORITHM_V2;
  evidenceProfileId: string;
  sequenceFrom: number;
  sequenceTo: number;
  eventCount: number;
  observedStartedAt: string;
  observedEndedAt: string;
  segmentHash: string;
  predecessorSegmentHash: string | null;
  payloadBytes: number;
};

export type EvidenceIngestCommandV2 = {
  clientRequestId: string;
  descriptor: EvidenceSegmentDescriptorV2;
  /** Exact RFC 8785 JCS string whose SHA-256 is descriptor.segmentHash. */
  canonicalPayload: string;
};

export type EvidenceIngestRequestV2 = {
  principalId: string;
  command: EvidenceIngestCommandV2;
  authorizationContext?: AuthorizationContext;
};

export type EvidenceIngestOutcome =
  | { status: "accepted"; receipt: SignedEvidenceReceipt }
  | { status: "duplicate"; receipt: SignedEvidenceReceipt }
  | { status: "chain_conflict"; expectedPreviousSegmentHash: string | null }
  | { status: "idempotency_conflict" }
  | { status: "invalid" }
  | { status: "unauthorized" }
  | { status: "too_large" }
  | { status: "not_accepting" }
  | {
      status: "unavailable";
      stage: "authorization" | "context" | "storage" | "repository" | "signing";
      reason: string;
    };

export interface EvidenceIngestPort {
  ingest(request: EvidenceIngestRequestV2): Promise<EvidenceIngestOutcome>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const DESCRIPTOR_KEYS: ReadonlySet<string> = new Set<
  keyof EvidenceSegmentDescriptorV2
>([
  "evidencePackageId",
  "documentId",
  "sessionId",
  "segmentId",
  "evidenceSchema",
  "canonicalization",
  "hashAlgorithm",
  "evidenceProfileId",
  "sequenceFrom",
  "sequenceTo",
  "eventCount",
  "observedStartedAt",
  "observedEndedAt",
  "segmentHash",
  "predecessorSegmentHash",
  "payloadBytes",
]);
// The command is the whole wire envelope. A field next to these three, such as
// a principal or an author, is refused: identity comes from the session.
const COMMAND_KEYS: ReadonlySet<string> = new Set<
  keyof EvidenceIngestCommandV2
>(["clientRequestId", "descriptor", "canonicalPayload"]);
const MAX_ID_LENGTH = 256;
const MAX_CLIENT_REQUEST_ID_LENGTH = 256;

function nonEmptyBounded(value: unknown, max = MAX_ID_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isEvidenceSegmentDescriptorV2(
  descriptor: unknown,
): descriptor is EvidenceSegmentDescriptorV2 {
  if (!isPlainObject(descriptor)) return false;
  // Unknown fields fail closed so nothing unvalidated travels downstream.
  if (!hasOnlyKeys(descriptor, DESCRIPTOR_KEYS)) return false;

  if (
    !nonEmptyBounded(descriptor.evidencePackageId) ||
    !nonEmptyBounded(descriptor.documentId) ||
    !nonEmptyBounded(descriptor.sessionId) ||
    !nonEmptyBounded(descriptor.segmentId) ||
    descriptor.evidenceSchema !== EVIDENCE_SEGMENT_SCHEMA_V2 ||
    descriptor.canonicalization !== EVIDENCE_CANONICALIZATION_V2 ||
    descriptor.hashAlgorithm !== EVIDENCE_HASH_ALGORITHM_V2 ||
    !nonEmptyBounded(
      descriptor.evidenceProfileId,
      MAX_EVIDENCE_PROFILE_ID_LENGTH,
    ) ||
    !Number.isSafeInteger(descriptor.sequenceFrom) ||
    Number(descriptor.sequenceFrom) < 1 ||
    !Number.isSafeInteger(descriptor.sequenceTo) ||
    Number(descriptor.sequenceTo) < Number(descriptor.sequenceFrom) ||
    !Number.isSafeInteger(descriptor.eventCount) ||
    Number(descriptor.eventCount) < 1 ||
    Number(descriptor.sequenceTo) !==
      Number(descriptor.sequenceFrom) + Number(descriptor.eventCount) - 1 ||
    !canonicalInstant(descriptor.observedStartedAt) ||
    !canonicalInstant(descriptor.observedEndedAt) ||
    Date.parse(descriptor.observedEndedAt) <
      Date.parse(descriptor.observedStartedAt) ||
    typeof descriptor.segmentHash !== "string" ||
    !SHA256_HEX.test(descriptor.segmentHash) ||
    !(
      descriptor.predecessorSegmentHash === null ||
      (typeof descriptor.predecessorSegmentHash === "string" &&
        SHA256_HEX.test(descriptor.predecessorSegmentHash))
    ) ||
    !Number.isSafeInteger(descriptor.payloadBytes) ||
    Number(descriptor.payloadBytes) < 1 ||
    exceedsEvidenceSegmentLimit(Number(descriptor.payloadBytes))
  ) {
    return false;
  }

  return true;
}

/**
 * Whether a payload is over the one segment limit (D-96), in UTF-8 bytes. A
 * UTF-16 code unit is at least one byte, so a text that is already too long
 * is never encoded.
 */
export function evidencePayloadExceedsLimit(canonicalPayload: string): boolean {
  return (
    exceedsEvidenceSegmentLimit(canonicalPayload.length) ||
    exceedsEvidenceSegmentLimit(
      new TextEncoder().encode(canonicalPayload).byteLength,
    )
  );
}

export function isEvidenceIngestCommandV2(
  command: unknown,
): command is EvidenceIngestCommandV2 {
  if (!isPlainObject(command) || !hasOnlyKeys(command, COMMAND_KEYS)) {
    return false;
  }
  const descriptor = command.descriptor;
  if (
    !nonEmptyBounded(command.clientRequestId, MAX_CLIENT_REQUEST_ID_LENGTH) ||
    typeof command.canonicalPayload !== "string" ||
    command.canonicalPayload.length === 0 ||
    evidencePayloadExceedsLimit(command.canonicalPayload) ||
    !isEvidenceSegmentDescriptorV2(descriptor)
  ) {
    return false;
  }

  return (
    new TextEncoder().encode(command.canonicalPayload).byteLength ===
    descriptor.payloadBytes
  );
}

export function validateEvidenceIngestCommandV2(
  command: EvidenceIngestCommandV2,
): boolean {
  return isEvidenceIngestCommandV2(command);
}

export type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
