import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { verifyCanonicalEvidencePayloadV2 } from "./evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "./evidence-segment-v2";
import { canonicalEvidenceTimingV1, EVIDENCE_TIMING_FORMAT_V1, verifyEvidenceTimingV1 } from "./evidence-timing-v1";

// DAN-344 P1: every timing a client can send for a segment is accepted
// exactly when its offsets are whole 100 ms steps that never fall and stay
// within the segment's minutes. Synthetic content only.
const MINUTE_MS = 60_000;
const step = { stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "L" }] } };

async function segmentOf(stepCounts: number[], minutes: number) {
  const canonical = canonicalEvidenceSegmentV2({
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-ana-z1",
    sessionId: "session-ana",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: stepCounts.length,
    observedStartedAt: "2026-10-20T10:00:00.000Z",
    observedEndedAt: new Date(Date.parse("2026-10-20T10:00:00.000Z") + minutes * MINUTE_MS).toISOString(),
    initialDocumentHash: "0".repeat(63) + "1",
    finalDocumentHash: (stepCounts.length + 1).toString(16).padStart(64, "0"),
    predecessorSegmentHash: null,
    events: stepCounts.map((count, i) => ({
      sequence: i + 1,
      source: "editor",
      steps: Array.from({ length: count }, () => step),
      beforeDocumentHash: (i + 1).toString(16).padStart(64, "0"),
      afterDocumentHash: (i + 2).toString(16).padStart(64, "0"),
    })),
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  });
  const verified = await verifyCanonicalEvidencePayloadV2(new TextEncoder().encode(canonical));
  if (!verified.ok) throw new Error(verified.reason);
  return verified;
}

const plan = fc
  .record({ stepCounts: fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 5 }), minutes: fc.integer({ min: 0, max: 3 }) })
  .chain(({ stepCounts, minutes }) => {
    const total = stepCounts.reduce((a, b) => a + b, 0);
    const slots = (minutes + 1) * (MINUTE_MS / 100);
    return fc.record({
      stepCounts: fc.constant(stepCounts),
      minutes: fc.constant(minutes),
      // Sorted slot numbers become non-decreasing offsets in whole 100 ms steps.
      slots: fc.array(fc.integer({ min: 0, max: slots - 1 }), { minLength: total, maxLength: total }).map((s) => s.sort((a, b) => a - b)),
      nudge: fc.integer({ min: 1, max: 99 }),
      at: fc.nat(),
    });
  });

function split(stepCounts: number[], flat: number[]): number[][] {
  let at = 0;
  return stepCounts.map((count) => flat.slice(at, (at += count)));
}

describe("ductus-evidence-timing-v1 properties (DAN-344 P1)", () => {
  test.prop([plan], { numRuns: 60 })("accepts every rounded, non-falling offset within the minutes, and no unrounded one", async (p) => {
    const segment = await segmentOf(p.stepCounts, p.minutes);
    const offsets = p.slots.map((slot) => slot * 100);
    const timing = (flat: number[]) =>
      canonicalEvidenceTimingV1({
        timingFormat: EVIDENCE_TIMING_FORMAT_V1,
        segmentHash: segment.sha256,
        events: split(p.stepCounts, flat).map((stepOffsetsMs, i) => ({ sequence: i + 1, stepOffsetsMs })),
      });
    const accepted = await verifyEvidenceTimingV1(new TextEncoder().encode(timing(offsets)), segment);
    expect(accepted.ok).toBe(true);

    const unrounded = [...offsets];
    unrounded[p.at % unrounded.length] += p.nudge;
    const refused = await verifyEvidenceTimingV1(new TextEncoder().encode(timing(unrounded)), segment);
    expect(refused.ok).toBe(false);
  });
});
