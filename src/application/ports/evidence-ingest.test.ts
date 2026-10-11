import { describe, expect, it } from "vitest";

import {
  evidencePayloadExceedsLimit,
  isEvidenceSegmentDescriptorV2,
  validateEvidenceIngestCommandV2,
  type EvidenceIngestCommandV2,
} from "./evidence-ingest";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  MAX_EVIDENCE_PROFILE_ID_LENGTH,
} from "@/domain/forensics/evidence-segment-v2";

const payload = '{"evidenceSchema":"ductus-evidence-segment-v2"}';

function validCommand(): EvidenceIngestCommandV2 {
  return {
    clientRequestId: "req-1",
    canonicalPayload: payload,
    descriptor: {
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      sessionId: "session-1",
      segmentId: "segment-1",
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      evidenceProfileId: "standard-v1",
      sequenceFrom: 1,
      sequenceTo: 1,
      eventCount: 1,
      observedStartedAt: "2026-10-03T06:00:00.000Z",
      observedEndedAt: "2026-10-03T06:01:00.000Z",
      segmentHash: "a".repeat(64),
      predecessorSegmentHash: null,
      payloadBytes: new TextEncoder().encode(payload).byteLength,
    },
  };
}

describe("evidence ingest v2 boundary", () => {
  it("accepts a structurally coherent v2 envelope", () => {
    expect(validateEvidenceIngestCommandV2(validCommand())).toBe(true);
  });

  it("fails closed on size, chronology, range and hash-shape mismatches", () => {
    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: { ...validCommand().descriptor, payloadBytes: 1 },
      }),
    ).toBe(false);

    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: {
          ...validCommand().descriptor,
          observedStartedAt: "2026-10-03T06:02:00.000Z",
          observedEndedAt: "2026-10-03T06:01:00.000Z",
        },
      }),
    ).toBe(false);

    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: {
          ...validCommand().descriptor,
          sequenceTo: 2,
          eventCount: 1,
        },
      }),
    ).toBe(false);

    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: {
          ...validCommand().descriptor,
          segmentHash: "sha256:not-a-wire-hash",
        },
      }),
    ).toBe(false);
  });

  it("accepts only whole UTC minutes as observed times (D-24)", () => {
    const withTimes = (times: Partial<EvidenceIngestCommandV2["descriptor"]>) =>
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: { ...validCommand().descriptor, ...times },
      });

    // One minute at both ends is a segment within that minute.
    expect(withTimes({ observedEndedAt: "2026-10-03T06:00:00.000Z" })).toBe(true);
    for (const time of [
      "2026-10-03T06:00:30.000Z",
      "2026-10-03T06:00:00.001Z",
      "2026-10-03T06:00:59.999Z",
      "2026-10-03T08:00:00.000+02:00",
      "2026-10-03T06:00:00Z",
    ]) {
      expect(withTimes({ observedStartedAt: time })).toBe(false);
      expect(withTimes({ observedEndedAt: time })).toBe(false);
    }
  });

  it("rejects descriptors with unknown fields", () => {
    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: { ...validCommand().descriptor, authorRole: "teacher" },
      } as unknown as EvidenceIngestCommandV2),
    ).toBe(false);
  });

  it.each([
    ["principalId", "student-izmisljeni-2"],
    ["author", "student-izmisljeni-2"],
    ["actor", { id: "student-izmisljeni-2" }],
    ["authorizationContext", { currentTime: "2026-10-03T06:00:00.000Z" }],
    ["extra", undefined],
  ])("rejects a command that carries %s next to its three fields", (key, value) => {
    expect(
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        [key]: value,
      } as unknown as EvidenceIngestCommandV2),
    ).toBe(false);
  });

  it("uses the one segment limit, in bytes, for the payload and for the declared size", () => {
    expect(evidencePayloadExceedsLimit("a".repeat(MAX_EVIDENCE_SEGMENT_BYTES))).toBe(false);
    expect(evidencePayloadExceedsLimit("a".repeat(MAX_EVIDENCE_SEGMENT_BYTES + 1))).toBe(true);
    // Two bytes per character: half the characters already fill the limit.
    expect(evidencePayloadExceedsLimit("č".repeat(MAX_EVIDENCE_SEGMENT_BYTES / 2))).toBe(false);
    expect(evidencePayloadExceedsLimit("č".repeat(MAX_EVIDENCE_SEGMENT_BYTES / 2) + "a")).toBe(true);

    const atLimit = "a".repeat(MAX_EVIDENCE_SEGMENT_BYTES);
    const sized = (canonicalPayload: string, payloadBytes: number) =>
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        canonicalPayload,
        descriptor: { ...validCommand().descriptor, payloadBytes },
      });
    expect(sized(atLimit, MAX_EVIDENCE_SEGMENT_BYTES)).toBe(true);
    expect(sized(atLimit + "a", MAX_EVIDENCE_SEGMENT_BYTES + 1)).toBe(false);
    // A declared size over the limit is never valid, whatever the payload is.
    expect(sized(payload, MAX_EVIDENCE_SEGMENT_BYTES + 1)).toBe(false);
  });

  it("bounds the declared size in the descriptor on its own, with no payload to compare it to", () => {
    const declaring = (payloadBytes: number) =>
      isEvidenceSegmentDescriptorV2({ ...validCommand().descriptor, payloadBytes });
    expect(declaring(MAX_EVIDENCE_SEGMENT_BYTES)).toBe(true);
    expect(declaring(MAX_EVIDENCE_SEGMENT_BYTES + 1)).toBe(false);
    expect(declaring(Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(declaring(0)).toBe(false);
  });

  it("bounds the evidence profile id like the segment and the receipt do", () => {
    const withProfile = (evidenceProfileId: string) =>
      validateEvidenceIngestCommandV2({
        ...validCommand(),
        descriptor: { ...validCommand().descriptor, evidenceProfileId },
      });
    expect(withProfile("p".repeat(MAX_EVIDENCE_PROFILE_ID_LENGTH))).toBe(true);
    expect(withProfile("p".repeat(MAX_EVIDENCE_PROFILE_ID_LENGTH + 1))).toBe(false);
    // Written out: the descriptor has its own copy of the check.
    expect(withProfile("p".repeat(120))).toBe(true);
    expect(withProfile("p".repeat(121))).toBe(false);
  });
});
