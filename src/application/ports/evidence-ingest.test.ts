import { describe, expect, it } from "vitest";

import {
  validateEvidenceIngestCommandV2,
  type EvidenceIngestCommandV2,
} from "./evidence-ingest";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
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
});
