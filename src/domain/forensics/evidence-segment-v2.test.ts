import { describe, expect, it } from "vitest";

import { sha256WebCrypto } from "./crypto";
import {
  canonicalEvidenceSegmentV2,
  digestEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  isEvidenceMinuteV2,
  isEvidenceSegmentV2,
  isTimeOrderedIdentifierV2,
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
    observedEndedAt: "2026-10-02T20:01:00.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
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
      '{"canonicalization":"RFC8785-JCS","captureContext":{"editorModel":"prosemirror","transactionFormat":"prosemirror-step-json-v1"},"documentId":"doc-1","events":[{"afterDocumentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","beforeDocumentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sequence":1,"source":"editor","steps":[{"from":1,"slice":{"content":[{"text":"A","type":"text"}]},"stepType":"replace","to":1}],"touchedNodeIds":["p1"]}],"evidenceProfileId":"standard-v1","evidenceSchema":"ductus-evidence-segment-v2","finalDocumentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","hashAlgorithm":"sha256","initialDocumentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observedEndedAt":"2026-10-02T20:01:00.000Z","observedStartedAt":"2026-10-02T20:00:00.000Z","predecessorSegmentHash":null,"segmentId":"segment-1","sequenceFrom":1,"sequenceTo":1,"sessionId":"session-1"}';

    expect(canonicalEvidenceSegmentV2(segment)).toBe(canonical);
    await expect(digestEvidenceSegmentV2(segment)).resolves.toEqual({
      canonical,
      byteLength: 973,
      sha256: "c548a1723a1b3ab6782ebf9d4c9083180653dd5b1a768599e0779052a902c957",
    });

    // The vector this test pinned before the decision of 10 October 2026: the
    // same segment with time on its event and seconds in its end. Its bytes
    // are unchanged (same hash as then) and it is refused now.
    const former = canonical
      .replace('"sequence":1,', '"elapsedMs":500,"occurredAt":"2026-10-02T20:00:00.500Z","sequence":1,')
      .replace("T20:01:00.000Z", "T20:00:01.000Z");
    expect(await sha256WebCrypto(former)).toBe(
      "fffbe70abf056ba1d09e8a57310e3982566756bfeccd9a2841983350352e5e88",
    );
    expect(isEvidenceSegmentV2(JSON.parse(former))).toBe(false);
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

  it("orders events by sequence alone and refuses any time on an event", () => {
    const two = fixture();
    two.sequenceTo = 2;
    two.events.push({ ...two.events[0], sequence: 2, beforeDocumentHash: B, afterDocumentHash: B });
    expect(isEvidenceSegmentV2(two)).toBe(true);

    // Refused whatever the value: a whole minute and a zero are time per event too.
    for (const time of [
      { occurredAt: "2026-10-02T20:00:00.000Z" },
      { elapsedMs: 0 },
      { occurredAt: "2026-10-02T20:00:00.500Z", elapsedMs: 500 },
    ]) {
      const segment = fixture();
      Object.assign(segment.events[0], time);
      expect(isEvidenceSegmentV2(segment)).toBe(false);
    }
  });

  it.each([
    ["seconds", "2026-10-02T20:00:02.000Z"],
    ["seconds and milliseconds", "2026-10-02T20:00:02.250Z"],
    ["one millisecond into the minute", "2026-10-02T20:00:00.001Z"],
    ["the last millisecond of the minute", "2026-10-02T20:00:59.999Z"],
    ["another zone", "2026-10-02T22:00:00.000+02:00"],
    ["no milliseconds", "2026-10-02T20:00:00Z"],
    ["no seconds", "2026-10-02T20:00Z"],
    ["more than three fraction digits", "2026-10-02T20:00:00.000000Z"],
    ["a space for the T", "2026-10-02 20:00:00.000Z"],
    ["a day that does not exist", "2026-02-30T20:00:00.000Z"],
    ["hour 24", "2026-10-02T24:00:00.000Z"],
    ["a number of milliseconds", Date.UTC(2026, 9, 2, 20, 0)],
  ])("refuses a segment time with %s", (_name, time) => {
    expect(isEvidenceMinuteV2(time)).toBe(false);
    for (const field of ["observedStartedAt", "observedEndedAt"] as const) {
      expect(isEvidenceSegmentV2({ ...fixture(), [field]: time })).toBe(false);
    }
  });

  it("accepts whole minutes: a segment across a minute boundary and one within a single minute", () => {
    expect(isEvidenceMinuteV2("2026-10-02T20:00:00.000Z")).toBe(true);
    // 20:00:50 to 20:01:10 on the device is 20:00 and 20:01 in the segment.
    expect(isEvidenceSegmentV2(fixture())).toBe(true);
    const sameMinute = { ...fixture(), observedEndedAt: "2026-10-02T20:00:00.000Z" };
    expect(isEvidenceSegmentV2(sameMinute)).toBe(true);
    const backwards = { ...fixture(), observedEndedAt: "2026-10-02T19:59:00.000Z" };
    expect(isEvidenceSegmentV2(backwards)).toBe(false);
  });

  // RFC 9562 appendix A.1, A.5 and A.6, and the example of the ULID specification.
  it.each([
    ["UUID version 1", "C232AB00-9414-11EC-B3C8-9F6BDECED846"],
    ["UUID version 6", "1EC9414C-232A-6B00-B3C8-9F6BDECED846"],
    ["UUID version 7", "017F22E2-79B0-7CC3-98C4-DC0C0C07398F"],
    ["UUID version 7 in lower case", "017f22e2-79b0-7cc3-98c4-dc0c0c07398f"],
    ["ULID", "01ARZ3NDEKTSV4RRFFQ69G5FAV"],
    ["ULID in lower case", "01arz3ndektsv4rrffq69g5fav"],
  ])("refuses an identifier that embeds its time of creation: %s", (_name, id) => {
    expect(isTimeOrderedIdentifierV2(id)).toBe(true);
    for (const field of ["documentId", "sessionId", "segmentId"] as const) {
      expect(isEvidenceSegmentV2({ ...fixture(), [field]: id })).toBe(false);
    }
    const node = fixture();
    node.events[0].touchedNodeIds = [id];
    expect(isEvidenceSegmentV2(node)).toBe(false);
  });

  it("accepts identifiers without such a layout, a random UUID among them", () => {
    // RFC 9562 appendix A.3 (version 4), and a name of 26 characters that is no ULID.
    for (const id of ["919108f7-52d1-4320-9bac-f847db4148a8", "odsjecak-izmisljeni-zv-001"]) {
      expect(isTimeOrderedIdentifierV2(id)).toBe(false);
      const segment = { ...fixture(), documentId: id, sessionId: id, segmentId: id };
      segment.events[0].touchedNodeIds = [id];
      expect(isEvidenceSegmentV2(segment)).toBe(true);
    }
  });

  it.each(["time", "ts", "at", "timestamp", "Timestamp", "TS", "occurredAt", "elapsedMs"])(
    "refuses a step with the key %s, at any depth",
    (key) => {
      const places: ((step: Record<string, unknown>) => void)[] = [
        (step) => (step[key] = 1791792062250),
        (step) => (step.slice = { content: [{ type: "text", text: "A", attrs: { [key]: "x" } }] }),
        (step) => (step.meta = [[{ [key]: null }]]),
      ];
      for (const place of places) {
        const segment = fixture();
        place(segment.events[0].steps[0]);
        expect(isEvidenceSegmentV2(segment)).toBe(false);
      }
    },
  );

  it("does not take a step value or a longer key for a time key", () => {
    const segment = fixture();
    Object.assign(segment.events[0].steps[0], { format: "at", attrs: { state: "ts", path: ["time"] } });
    expect(isEvidenceSegmentV2(segment)).toBe(true);
  });

  it("has no place for a time in captureContext or in the touched node ids", () => {
    const context = fixture();
    Object.assign(context.captureContext, { capturedAt: "2026-10-02T20:00:00.000Z" });
    expect(isEvidenceSegmentV2(context)).toBe(false);

    const touched = fixture();
    touched.events[0].touchedNodeIds = [{ at: "2026-10-02T20:00:00.000Z", id: "p1" } as never];
    expect(isEvidenceSegmentV2(touched)).toBe(false);
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
