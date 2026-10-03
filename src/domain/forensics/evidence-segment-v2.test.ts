import { describe, expect, it } from "vitest";

import {
  canonicalEvidenceSegmentV2,
  digestEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  isEvidenceSegmentV2,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";

const A = "a".repeat(64);
const B = "b".repeat(64);

function fixture(): EvidenceSegmentV2 {
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-1",
    sessionId: "session-1",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-02T20:00:00.000Z",
    observedEndedAt: "2026-10-02T20:00:01.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        occurredAt: "2026-10-02T20:00:00.500Z",
        elapsedMs: 500,
        source: "editor",
        steps: [
          {
            stepType: "replace",
            from: 1,
            to: 1,
            slice: {
              content: [{ type: "text", text: "A" }],
            },
          },
        ],
        touchedNodeIds: ["p1"],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId: "standard-v1",
  };
}

describe("EvidenceSegmentV2", () => {
  it("has a stable independent canonical/hash vector", async () => {
    const segment = fixture();
    const canonical =
      '{"canonicalization":"RFC8785-JCS","captureContext":{"editorModel":"prosemirror","transactionFormat":"prosemirror-step-json-v1"},"documentId":"doc-1","events":[{"afterDocumentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","beforeDocumentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","elapsedMs":500,"occurredAt":"2026-10-02T20:00:00.500Z","sequence":1,"source":"editor","steps":[{"from":1,"slice":{"content":[{"text":"A","type":"text"}]},"stepType":"replace","to":1}],"touchedNodeIds":["p1"]}],"evidenceProfileId":"standard-v1","evidenceSchema":"pisac-evidence-segment-v2","finalDocumentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","hashAlgorithm":"sha256","initialDocumentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observedEndedAt":"2026-10-02T20:00:01.000Z","observedStartedAt":"2026-10-02T20:00:00.000Z","predecessorSegmentHash":null,"segmentId":"segment-1","sequenceFrom":1,"sequenceTo":1,"sessionId":"session-1"}';

    expect(canonicalEvidenceSegmentV2(segment)).toBe(canonical);
    await expect(digestEvidenceSegmentV2(segment)).resolves.toEqual({
      canonical,
      byteLength: 1028,
      sha256: "23edb335328a73fd448a8e56c61d6a9f8c6d2f471d2c2b89f2e5da5d8470c0c4",
    });
  });

  it("requires contiguous event sequences and a document-hash chain", () => {
    const sequenceGap = fixture();
    sequenceGap.events[0].sequence = 2;
    expect(isEvidenceSegmentV2(sequenceGap)).toBe(false);

    const hashGap = fixture();
    hashGap.events[0].beforeDocumentHash = "c".repeat(64);
    expect(isEvidenceSegmentV2(hashGap)).toBe(false);

    const wrongFinal = fixture();
    wrongFinal.finalDocumentHash = "c".repeat(64);
    expect(isEvidenceSegmentV2(wrongFinal)).toBe(false);
  });

  it("requires canonical timestamps and monotonic elapsed time", () => {
    const nonCanonicalTime = fixture();
    nonCanonicalTime.events[0].occurredAt = "2026-10-02T20:00:00Z";
    expect(isEvidenceSegmentV2(nonCanonicalTime)).toBe(false);

    const two = fixture();
    two.sequenceTo = 2;
    two.events.push({
      ...two.events[0],
      sequence: 2,
      occurredAt: "2026-10-02T20:00:00.600Z",
      elapsedMs: 499,
      beforeDocumentHash: B,
      afterDocumentHash: B,
    });
    expect(isEvidenceSegmentV2(two)).toBe(false);
  });

  it("requires sorted unique touched node ids and known evidence sources", () => {
    const ids = fixture();
    ids.events[0].touchedNodeIds = ["p2", "p1"];
    expect(isEvidenceSegmentV2(ids)).toBe(false);

    const source = fixture();
    source.events[0].source = "keyboard" as never;
    expect(isEvidenceSegmentV2(source)).toBe(false);
  });


  it("rejects unknown envelope fields so future semantics cannot be smuggled into v2", () => {
    const segment = fixture() as EvidenceSegmentV2 & { futureMeaning?: string };
    segment.futureMeaning = "do-not-ignore";
    expect(isEvidenceSegmentV2(segment)).toBe(false);

    const event = fixture();
    (event.events[0] as EvidenceSegmentV2["events"][number] & {
      futureMeaning?: string;
    }).futureMeaning = "do-not-ignore";
    expect(isEvidenceSegmentV2(event)).toBe(false);
  });

  it("rejects schema-marker drift rather than guessing how bytes should be interpreted", () => {
    const segment = fixture() as unknown as Record<string, unknown>;
    segment.canonicalization = "legacy-custom";
    expect(isEvidenceSegmentV2(segment)).toBe(false);
  });
});
