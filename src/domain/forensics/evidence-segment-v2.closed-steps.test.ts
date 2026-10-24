import { describe, expect, it } from "vitest";

import {
  EDIT_STEP_FORMAT_V1,
  MAX_EDIT_STEP_BYTES,
} from "@/domain/document/edit-step";

import {
  MAX_EVIDENCE_SEGMENT_BYTES,
  verifyCanonicalEvidencePayloadV2,
} from "./evidence-chain-v2";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_EDITOR_MODELS_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  isEvidenceSegmentV2,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * A segment carries only steps of the closed format `EDIT_STEP_FORMAT_V1`
 * (B-8, plan on #155). A step with anything else is refused, never cleaned:
 * the hash is over the received bytes, so a cleaned copy is not what was sent.
 */

const A = "a".repeat(64);
const B = "b".repeat(64);
const NODE_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

type Json = { [key: string]: JcsJsonValue };

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
              content: [{ type: "text", text: "A", marks: [{ type: "bold" }] }],
            },
          },
        ],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: EDIT_STEP_FORMAT_V1,
    },
    evidenceProfileId: "standard-v1",
  };
}

function step(segment: EvidenceSegmentV2): Json {
  return segment.events[0].steps[0] as Json;
}

function slice(segment: EvidenceSegmentV2): Json {
  return step(segment).slice as Json;
}

function textNode(segment: EvidenceSegmentV2): Json {
  return (slice(segment).content as Json[])[0];
}

/** The context as untrusted input: its fields are typed as the closed values. */
function context(segment: EvidenceSegmentV2): Json {
  return segment.captureContext as unknown as Json;
}

/** Canonical bytes built without the validator, as a crafted client would. */
function craftedBytes(segment: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJcs(segment as JcsJsonValue));
}

describe("EvidenceSegmentV2 closed steps (B-8, #155)", () => {
  it("accepts the fixture, so every refusal below is the change it makes", async () => {
    expect(isEvidenceSegmentV2(fixture())).toBe(true);
    await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(fixture()))).resolves.toMatchObject({
      ok: true,
    });
  });

  // Z1: the steps of every event are read with parseEditSteps.
  it.each([
    ["a step type outside the format", (s: EvidenceSegmentV2) => (step(s).stepType = "insert-text")],
    ["a range that runs backwards", (s: EvidenceSegmentV2) => (step(s).to = 0)],
    ["an empty text node", (s: EvidenceSegmentV2) => (textNode(s).text = "")],
    ["a step that is an array", (s: EvidenceSegmentV2) => (s.events[0].steps[0] = [] as unknown as Json)],
  ])("refuses %s in a step, in the validator and in the payload check", async (_, change) => {
    const segment = fixture();
    change(segment);

    expect(isEvidenceSegmentV2(segment)).toBe(false);
    await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(segment))).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reads the steps of every event, not only the first", () => {
    const segment = fixture();
    segment.sequenceTo = 2;
    segment.events.push({
      ...structuredClone(segment.events[0]),
      sequence: 2,
      beforeDocumentHash: B,
      afterDocumentHash: B,
    });
    expect(isEvidenceSegmentV2(segment)).toBe(true);

    (segment.events[1].steps[0] as Json).stepType = "insert-text";
    expect(isEvidenceSegmentV2(segment)).toBe(false);
  });

  // Z2: one transaction format, exactly.
  it.each([
    "prosemirror-step-json-v1",
    "ductus-test-insert-text-v0",
    "ductus-edit-steps-v2",
    "DUCTUS-EDIT-STEPS-V1",
    ` ${EDIT_STEP_FORMAT_V1}`,
  ])("refuses the transaction format %j", (format) => {
    const segment = fixture();
    context(segment).transactionFormat = format;
    expect(isEvidenceSegmentV2(segment)).toBe(false);
  });

  // Z3: the editor model is from a closed list, not free text.
  it("accepts only an editor model from the closed list", () => {
    expect(EVIDENCE_EDITOR_MODELS_V2.length).toBeGreaterThan(0);
    for (const model of EVIDENCE_EDITOR_MODELS_V2) {
      const segment = fixture();
      segment.captureContext.editorModel = model;
      expect(isEvidenceSegmentV2(segment)).toBe(true);
    }
    for (const model of [
      "test-text-nodes",
      "prosemirror 2026-10-02T20:00:00.500Z",
      "Prosemirror",
      "prosemirror ",
    ]) {
      const segment = fixture();
      context(segment).editorModel = model;
      expect(isEvidenceSegmentV2(segment)).toBe(false);
    }
  });

  // Z3: a name the list lookup could find on a prototype, or that differs
  // only in a character not seen, is still not on the list.
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "prosemirror\u200b", "\u200bprosemirror"])(
    "refuses the editor model %j, in the validator and in the payload check",
    async (model) => {
      const segment = fixture();
      context(segment).editorModel = model;

      expect(isEvidenceSegmentV2(segment)).toBe(false);
      await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(segment))).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    },
  );

  // Z4: an unknown field anywhere, time fields included.
  const levels: [string, (s: EvidenceSegmentV2) => Json][] = [
    ["segment", (s) => s as unknown as Json],
    ["event", (s) => s.events[0] as unknown as Json],
    ["captureContext", (s) => s.captureContext as unknown as Json],
    ["step", step],
    ["slice", slice],
    ["text node", textNode],
    ["mark", (s) => (textNode(s).marks as Json[])[0]],
  ];
  const fields: [string, JcsJsonValue][] = [
    ["occurredAt", "2026-10-02T20:00:00.500Z"],
    ["elapsedMs", 0],
    ["note", "x"],
  ];
  it.each(levels.flatMap(([level, at]) => fields.map(([key, value]) => [level, key, at, value] as const)))(
    "refuses an unknown field on the %s (%s)",
    async (_, key, at, value) => {
      const segment = fixture();
      at(segment)[key] = value;

      expect(isEvidenceSegmentV2(segment)).toBe(false);
      await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(segment))).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    },
  );

  // Z5: refused, never cleaned. The parser builds a clean copy; the check
  // must not answer with it.
  it("does not hand back a cleaned segment for one with a surplus step field", async () => {
    const segment = fixture();
    step(segment).occurredAt = "2026-10-02T20:00:00.500Z";
    const bytes = craftedBytes(segment);

    const verified = await verifyCanonicalEvidencePayloadV2(bytes);
    expect(verified.ok).toBe(false);
    expect(verified).not.toHaveProperty("segment");
    expect(verified).not.toHaveProperty("sha256");
  });

  // Z10: an own key named like a prototype property, written into the bytes
  // (JSON.parse makes it an own field), is an unknown field like any other.
  it.each(["__proto__", "constructor"])("refuses an own %j key in a step of the payload", async (key) => {
    const text = canonicalizeJcs(fixture() as unknown as JcsJsonValue);
    const opening = '"steps":[{';
    expect(text.split(opening)).toHaveLength(2);
    // Both keys sort before every key of the step, so the bytes stay canonical.
    const bytes = new TextEncoder().encode(text.replace(opening, `${opening}"${key}":1,`));

    await expect(verifyCanonicalEvidencePayloadV2(bytes)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  // Z11: a hostile object at the segment level answers false, never throws.
  it("answers false for a segment whose fields throw when read", () => {
    const proxy = new Proxy(fixture(), {
      get() {
        throw new Error("read refused");
      },
    });
    expect(isEvidenceSegmentV2(proxy)).toBe(false);

    const getter = fixture();
    Object.defineProperty(getter, "captureContext", {
      enumerable: true,
      get() {
        throw new Error("read refused");
      },
    });
    expect(isEvidenceSegmentV2(getter)).toBe(false);
  });

  // Z8: a node id in a step carries no time.
  it.each([
    ["version 4", NODE_ID, true],
    ["version 1 (time)", "6ba7b810-9dad-11d1-80b4-00c04fd430c8", false],
    ["version 7 (time)", "01890a5d-ac96-774b-bcce-b302099a8057", false],
    ["upper case", NODE_ID.toUpperCase(), false],
    ["free text", "p1", false],
  ])("a step node id in %s form (%s) is valid: %s", (_, id, valid) => {
    const segment = fixture();
    segment.events[0].steps = [{ stepType: "attr", attr: "nodeId", pos: 0, value: id }];
    expect(isEvidenceSegmentV2(segment)).toBe(valid);
  });

  // Z9: the step limit and the segment limit are one limit.
  it("bounds the steps of an event by the segment limit", async () => {
    expect(MAX_EDIT_STEP_BYTES).toBe(MAX_EVIDENCE_SEGMENT_BYTES);

    // Steps that fit the step limit can still not fit a segment: the
    // envelope is on top. The payload check answers too_large first.
    const segment = fixture();
    const envelope = craftedBytes(segment).byteLength;
    textNode(segment).text = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES - envelope + 2);
    await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(segment))).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });

    const fits = fixture();
    textNode(fits).text = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES - envelope + 1);
    expect(craftedBytes(fits).byteLength).toBe(MAX_EVIDENCE_SEGMENT_BYTES);
    await expect(verifyCanonicalEvidencePayloadV2(craftedBytes(fits))).resolves.toMatchObject({
      ok: true,
    });
  });
});
