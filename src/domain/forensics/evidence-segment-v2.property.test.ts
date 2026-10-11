import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { verifyCanonicalEvidencePayloadV2 } from "./evidence-chain-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * Owner decision of 10 October 2026 (D-24, D-56): whatever a client sends in
 * the fields of the format, a segment that is accepted carries no time per
 * event and no time finer than a minute. Step text is generated without
 * digits, because the text of the work is content and not a field of the
 * format. All content is generated.
 */

type Loose = Record<string, JcsJsonValue>;

const A = "a".repeat(64);
const B = "b".repeat(64);

const instant = fc
  .date({ min: new Date("2026-01-01T00:00:00.000Z"), max: new Date("2026-12-31T23:59:59.999Z"), noInvalidDate: true })
  .map((date) => date.toISOString());
const wholeMinute = instant.map((value) => `${value.slice(0, 17)}00.000Z`);
const observedTime = fc.oneof(
  { weight: 4, arbitrary: wholeMinute },
  { weight: 2, arbitrary: instant },
  { weight: 1, arbitrary: wholeMinute.map((value) => value.replace(".000Z", "Z")) },
  { weight: 1, arbitrary: wholeMinute.map((value) => value.replace("Z", "+00:00")) },
);
/** The end is the start, the minute after it, or unrelated to it. */
const observedTimes = observedTime.chain((start) =>
  fc
    .oneof(
      fc.constant(start),
      fc.constant(new Date(Date.parse(start) + 60_000).toISOString()),
      observedTime,
    )
    .map((end) => ({ start, end })),
);

/** Where a client could try to put a time besides the two segment times. */
const PLACES: Record<string, (segment: Loose, event: Loose, time: string) => void> = {
  none: () => undefined,
  "event.occurredAt": (_segment, event, time) => (event.occurredAt = time),
  "event.elapsedMs": (_segment, event, time) => (event.elapsedMs = Date.parse(time) % 60_000),
  "captureContext.capturedAt": (segment, _event, time) => ((segment.captureContext as Loose).capturedAt = time),
  "touchedNodeIds[0].at": (_segment, event, time) => (event.touchedNodeIds = [{ at: time, id: "p1" }]),
  "segment.recordedAt": (segment, _event, time) => (segment.recordedAt = time),
};
const place = fc.oneof(
  { weight: 3, arbitrary: fc.constant("none") },
  { weight: 2, arbitrary: fc.constantFrom(...Object.keys(PLACES)) },
);

const WHOLE_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;
const ANY_TIME = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

describe("evidence segment v2: time", () => {
  test.prop([observedTimes, place, fc.oneof(instant, wholeMinute), fc.stringMatching(/^[a-z ]{0,12}$/)], {
    numRuns: 300,
  })(
    "a segment is accepted exactly when its times are two whole minutes and it has no other time field",
    async ({ start, end }, where, time, text) => {
      const event: Loose = {
        sequence: 1,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1, text }],
        touchedNodeIds: ["p1"],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      };
      const segment: Loose = {
        evidenceSchema: "ductus-evidence-segment-v2",
        canonicalization: "RFC8785-JCS",
        hashAlgorithm: "sha256",
        documentId: "doc-fixture",
        sessionId: "session-fixture",
        segmentId: "segment-1",
        sequenceFrom: 1,
        sequenceTo: 1,
        observedStartedAt: start,
        observedEndedAt: end,
        initialDocumentHash: A,
        finalDocumentHash: B,
        predecessorSegmentHash: null,
        events: [event],
        captureContext: { editorModel: "prosemirror", transactionFormat: "prosemirror-step-json-v1" },
        evidenceProfileId: "standard-v1",
      };
      PLACES[where](segment, event, time);

      const canonical = canonicalizeJcs(segment);
      const result = await verifyCanonicalEvidencePayloadV2(canonical);
      const clean =
        WHOLE_MINUTE.test(start) &&
        WHOLE_MINUTE.test(end) &&
        Date.parse(end) >= Date.parse(start) &&
        where === "none";
      expect(result.ok).toBe(clean);

      if (result.ok) {
        // The only times in the accepted bytes are the two whole minutes.
        expect(canonical.match(ANY_TIME)).toEqual([end.slice(11), start.slice(11)]);
        expect(end.slice(11)).toMatch(/^\d{2}:\d{2}:00\.000Z$/);
        expect(start.slice(11)).toMatch(/^\d{2}:\d{2}:00\.000Z$/);
        expect(canonical).not.toMatch(/"(?:occurredAt|elapsedMs)":/);
      }
    },
  );
});
