import { describe, expect, it } from "vitest";

import {
  isEvidenceReceiptPayloadV1,
  isSignedEvidenceReceipt,
  type EvidenceReceiptPayloadV1,
  type SignedEvidenceReceipt,
} from "./evidence-receipt";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  isEvidenceSegmentV2,
  MAX_EVIDENCE_PROFILE_ID_LENGTH,
} from "./evidence-segment-v2";

const A = "a".repeat(64);
const B = "b".repeat(64);

// Invented identifiers only.
function payload(): EvidenceReceiptPayloadV1 {
  return {
    receiptSchema: "ductus-evidence-receipt-v1",
    receiptId: "potvrda-izmisljena-1",
    evidencePackageId: "paket-izmisljeni-1",
    documentId: "dokument-izmisljeni-1",
    sessionId: "sesija-izmisljena-1",
    segmentId: "odsjecak-1",
    segmentHash: A,
    predecessorSegmentHash: null,
    previousReceiptId: null,
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    evidenceProfileId: "standard-v1",
    sequenceFrom: 1,
    sequenceTo: 1,
    eventCount: 1,
    payloadBytes: 123,
    acceptedAt: "2026-10-03T06:05:00.000Z",
  };
}

function signed(): SignedEvidenceReceipt {
  return {
    payload: payload(),
    payloadDigestSha256: B,
    signature: {
      algorithm: "Ed25519",
      keyId: "test-kljuc",
      keyVersion: "v1",
      signatureEncoding: "raw",
      signatureBase64Url: "AQID",
    },
  };
}

function segmentWithProfile(evidenceProfileId: string) {
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "dokument-izmisljeni-1",
    sessionId: "sesija-izmisljena-1",
    segmentId: "odsjecak-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-03T06:00:00.000Z",
    observedEndedAt: "2026-10-03T06:00:01.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        occurredAt: "2026-10-03T06:00:00.000Z",
        elapsedMs: 0,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1 }],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId,
  };
}

describe("evidence receipt validators", () => {
  it("accept the receipt the server issues", () => {
    expect(isEvidenceReceiptPayloadV1(payload())).toBe(true);
    expect(isSignedEvidenceReceipt(signed())).toBe(true);
  });

  it.each([
    ["an unknown field", { extra: 1 }],
    ["a principal", { principalId: "student-izmisljeni-2" }],
    ["an author", { author: "nastavnica-izmisljena-1" }],
    ["a field set to undefined", { note: undefined }],
    ["an own __proto__ key", JSON.parse('{"__proto__": {"receiptId": "x"}}')],
  ])("reject a payload that carries %s", (_name, extra) => {
    expect(isEvidenceReceiptPayloadV1({ ...payload(), ...extra })).toBe(false);
    expect(
      isSignedEvidenceReceipt({ ...signed(), payload: { ...payload(), ...extra } }),
    ).toBe(false);
  });

  it("reject a field next to the payload, where no signature covers it", () => {
    expect(isSignedEvidenceReceipt({ ...signed(), extra: 1 })).toBe(false);
    expect(isSignedEvidenceReceipt({ ...signed(), acceptedAt: "2026-10-03T06:05:00.000Z" })).toBe(false);
    expect(
      isSignedEvidenceReceipt({
        ...signed(),
        signature: { ...signed().signature, extra: 1 },
      }),
    ).toBe(false);
  });

  it("reject a payload whose fields are only inherited", () => {
    expect(isEvidenceReceiptPayloadV1(Object.create(payload()))).toBe(false);
    expect(isSignedEvidenceReceipt(Object.create(signed()))).toBe(false);
    expect(isEvidenceReceiptPayloadV1([payload()])).toBe(false);
    expect(isEvidenceReceiptPayloadV1(null)).toBe(false);
  });

  it("still reject a missing or malformed known field", () => {
    const withoutTime: Partial<EvidenceReceiptPayloadV1> = payload();
    delete withoutTime.acceptedAt;
    expect(isEvidenceReceiptPayloadV1(withoutTime)).toBe(false);
    expect(isEvidenceReceiptPayloadV1({ ...payload(), segmentHash: "A".repeat(64) })).toBe(false);
    expect(isEvidenceReceiptPayloadV1({ ...payload(), receiptSchema: "ductus-evidence-receipt-v0" })).toBe(false);
    expect(isSignedEvidenceReceipt({ ...signed(), payloadDigestSha256: "x" })).toBe(false);
  });
});

describe("evidence profile id limit", () => {
  const atLimit = "p".repeat(MAX_EVIDENCE_PROFILE_ID_LENGTH);
  const overLimit = "p".repeat(MAX_EVIDENCE_PROFILE_ID_LENGTH + 1);

  it("is the same for the segment and for the receipt issued for it", () => {
    expect(isEvidenceSegmentV2(segmentWithProfile(atLimit))).toBe(true);
    expect(isEvidenceReceiptPayloadV1({ ...payload(), evidenceProfileId: atLimit })).toBe(true);

    expect(isEvidenceSegmentV2(segmentWithProfile(overLimit))).toBe(false);
    expect(isEvidenceReceiptPayloadV1({ ...payload(), evidenceProfileId: overLimit })).toBe(false);
  });

  it("leaves no profile id a segment may carry and a receipt may not", () => {
    for (const length of [1, 2, 119, 120, 121, 122, 255, 256, 257]) {
      const profile = "p".repeat(length);
      expect(
        isEvidenceReceiptPayloadV1({ ...payload(), evidenceProfileId: profile }),
      ).toBe(isEvidenceSegmentV2(segmentWithProfile(profile)));
    }
  });
});
