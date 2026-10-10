import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { sha256WebCrypto } from "./crypto";
import {
  decideEvidenceRetry,
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
  type EvidenceChainHeadV2,
  type EvidenceRetryDecision,
} from "./evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SOURCES_V2,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";
import { canonicalizeJcs } from "./jcs";

/**
 * Property tests for the B-8 acceptance criteria that need no database:
 * changing, removing or reordering a segment breaks verification, unknown
 * fields are rejected, and a retry never becomes a second acceptance.
 * All content is generated; nothing here is a real student text.
 */

type EventSpec = { text: string; source: (typeof EVIDENCE_SOURCES_V2)[number] };
type ChainSpec = EventSpec[][];
type BuiltChain = { payloads: string[]; head: EvidenceChainHeadV2 };

const eventSpec = fc.record({
  text: fc.string({ unit: "binary", maxLength: 12 }),
  source: fc.constantFrom(...EVIDENCE_SOURCES_V2),
});
const chainSpec = (minLength: number): fc.Arbitrary<ChainSpec> =>
  fc.array(fc.array(eventSpec, { minLength: 1, maxLength: 3 }), {
    minLength,
    maxLength: 5,
  });

const documentHash = (n: number) => n.toString(16).padStart(64, "0");

type ChainOptions = {
  /** Segment index before which events and document revisions go missing. */
  gapBefore?: number;
  /** Segment index that names another document while linking correctly. */
  foreignDocumentAt?: number;
};

async function buildChain(spec: ChainSpec, options: ChainOptions = {}): Promise<BuiltChain> {
  const payloads: string[] = [];
  let predecessor: string | null = null;
  let sequence = 1;
  let revision = 0;

  for (const [index, events] of spec.entries()) {
    if (index === options.gapBefore) {
      sequence += 7;
      revision += 7;
    }
    const segment: EvidenceSegmentV2 = {
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId: index === options.foreignDocumentAt ? "doc-other" : "doc-fixture",
      sessionId: "session-fixture",
      segmentId: `segment-${index + 1}`,
      sequenceFrom: sequence,
      sequenceTo: sequence + events.length - 1,
      observedStartedAt: "2026-10-02T20:00:00.000Z",
      observedEndedAt: "2026-10-02T20:00:30.000Z",
      initialDocumentHash: documentHash(revision),
      finalDocumentHash: documentHash(revision + events.length),
      predecessorSegmentHash: predecessor,
      events: events.map((event, offset) => ({
        sequence: sequence + offset,
        occurredAt: "2026-10-02T20:00:10.000Z",
        elapsedMs: offset,
        source: event.source,
        steps: [{ stepType: "replace", from: 1, to: 1, text: event.text }],
        beforeDocumentHash: documentHash(revision + offset),
        afterDocumentHash: documentHash(revision + offset + 1),
      })),
      captureContext: {
        editorModel: "prosemirror",
        transactionFormat: "prosemirror-step-json-v1",
      },
      evidenceProfileId: "standard-v1",
    };
    const canonical = canonicalEvidenceSegmentV2(segment);
    payloads.push(canonical);
    predecessor = await sha256WebCrypto(canonical);
    sequence += events.length;
    revision += events.length;
  }

  if (predecessor === null) throw new Error("fixture: empty chain");
  return { payloads, head: { segmentHash: predecessor, segmentCount: payloads.length } };
}

/** Re-canonicalizes a payload after an edit, as a careful forger would. */
function rewrite(payload: string, edit: (segment: EvidenceSegmentV2) => void): string {
  const segment = JSON.parse(payload) as EvidenceSegmentV2;
  edit(segment);
  return canonicalizeJcs(segment);
}

describe("evidence segment chain v2", () => {
  test.prop([chainSpec(1)])("an untouched chain verifies to its head", async (spec) => {
    const { payloads, head } = await buildChain(spec);
    expect(await verifyEvidenceChainV2(payloads, head)).toEqual({
      ok: true,
      head,
      discontinuities: [],
    });
  });

  test.prop([chainSpec(2), fc.nat()])(
    "a linked chain with missing events verifies but reports the discontinuity",
    async (spec, pick) => {
      const gapBefore = 1 + (pick % (spec.length - 1));
      const { payloads, head } = await buildChain(spec, { gapBefore });
      const previousSequenceTo = spec.slice(0, gapBefore).flat().length;
      expect(await verifyEvidenceChainV2(payloads, head)).toEqual({
        ok: true,
        head,
        discontinuities: [
          {
            index: gapBefore,
            previousSequenceTo,
            sequenceFrom: previousSequenceTo + 8,
            sequenceBreak: true,
            documentHashBreak: true,
          },
        ],
      });
    },
  );

  test.prop([chainSpec(2), fc.nat()])(
    "a correctly linked segment of another document breaks verification",
    async (spec, pick) => {
      const foreignDocumentAt = 1 + (pick % (spec.length - 1));
      const { payloads, head } = await buildChain(spec, { foreignDocumentAt });
      expect(await verifyEvidenceChainV2(payloads, head)).toEqual({
        ok: false,
        reason: "document_mismatch",
        index: foreignDocumentAt,
      });
    },
  );

  test.prop([chainSpec(1), fc.integer({ min: -3, max: 3 })])(
    "the right head hash with the wrong segment count breaks verification",
    async (spec, offset) => {
      fc.pre(offset !== 0);
      const { payloads, head } = await buildChain(spec);
      const wrongCount = { ...head, segmentCount: head.segmentCount + offset };
      expect(await verifyEvidenceChainV2(payloads, wrongCount)).toEqual({
        ok: false,
        reason: "head_mismatch",
        index: null,
      });
    },
  );

  test.prop([chainSpec(1), fc.nat(), fc.string({ minLength: 1, maxLength: 4 })])(
    "changing one segment breaks verification, even when it stays well-formed",
    async (spec, pick, suffix) => {
      const { payloads, head } = await buildChain(spec);
      const index = pick % payloads.length;
      const changed = [...payloads];
      changed[index] = rewrite(payloads[index], (segment) => {
        segment.events[0].steps[0].text += suffix;
      });
      fc.pre(changed[index] !== payloads[index]);

      const single = await verifyCanonicalEvidencePayloadV2(changed[index]);
      expect(single.ok).toBe(true);
      const result = await verifyEvidenceChainV2(changed, head);
      expect(result).toEqual({
        ok: false,
        reason: index === payloads.length - 1 ? "head_mismatch" : "predecessor_mismatch",
        index: index === payloads.length - 1 ? null : index + 1,
      });
    },
  );

  test.prop([chainSpec(1), fc.nat(), fc.string({ minLength: 1, maxLength: 4 })])(
    "re-linking every later segment after a change still misses the recorded head",
    async (spec, pick, suffix) => {
      const { head } = await buildChain(spec);
      const index = pick % spec.length;
      const forgedSpec = spec.map((events, i) =>
        i === index ? [{ ...events[0], text: events[0].text + suffix }, ...events.slice(1)] : events,
      );
      const forged = await buildChain(forgedSpec);
      expect(await verifyEvidenceChainV2(forged.payloads, head)).toEqual({
        ok: false,
        reason: "head_mismatch",
        index: null,
      });
    },
  );

  test.prop([chainSpec(1), fc.nat(), fc.nat(), fc.constantFrom("0", "x", " ")])(
    "changing a single character of the stored bytes breaks verification",
    async (spec, pick, position, replacement) => {
      const { payloads, head } = await buildChain(spec);
      const index = pick % payloads.length;
      const original = payloads[index];
      const at = position % original.length;
      fc.pre(original[at] !== replacement);
      const changed = [...payloads];
      changed[index] = original.slice(0, at) + replacement + original.slice(at + 1);
      expect((await verifyEvidenceChainV2(changed, head)).ok).toBe(false);
    },
  );

  test.prop([chainSpec(1), fc.nat()])("removing a segment breaks verification", async (spec, pick) => {
    const { payloads, head } = await buildChain(spec);
    const index = pick % payloads.length;
    const remaining = payloads.filter((_, i) => i !== index);
    expect((await verifyEvidenceChainV2(remaining, head)).ok).toBe(false);
  });

  test.prop([chainSpec(2), fc.nat(), fc.nat()])(
    "reordering segments breaks verification",
    async (spec, first, second) => {
      const { payloads, head } = await buildChain(spec);
      const i = first % payloads.length;
      const j = second % payloads.length;
      fc.pre(i !== j);
      const reordered = [...payloads];
      [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
      expect((await verifyEvidenceChainV2(reordered, head)).ok).toBe(false);
    },
  );

  test.prop([chainSpec(1), fc.nat()])("a repeated segment breaks verification", async (spec, pick) => {
    const { payloads, head } = await buildChain(spec);
    const index = pick % payloads.length;
    const repeated = [...payloads.slice(0, index + 1), ...payloads.slice(index)];
    expect((await verifyEvidenceChainV2(repeated, head)).ok).toBe(false);
  });

  test.prop([
    chainSpec(1),
    fc.constantFrom("segment", "event", "captureContext"),
    fc.string({ minLength: 1, maxLength: 8 }).map((name) => `x-${name}`),
    fc.jsonValue({ maxDepth: 1 }),
  ])("an unknown field at any validated level is rejected", async (spec, level, name, value) => {
    const { payloads, head } = await buildChain(spec);
    const last = payloads.length - 1;
    const changed = [...payloads];
    changed[last] = rewrite(payloads[last], (segment) => {
      const target =
        level === "segment" ? segment : level === "event" ? segment.events[0] : segment.captureContext;
      (target as Record<string, unknown>)[name] = value;
    });

    expect(await verifyCanonicalEvidencePayloadV2(changed[last])).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyEvidenceChainV2(changed, head)).toEqual({
      ok: false,
      reason: "invalid_segment",
      index: last,
    });
  });

  test.prop([chainSpec(1)])("bytes that are valid JSON but not canonical are rejected", async (spec) => {
    const { payloads } = await buildChain(spec);
    const pretty = JSON.stringify(JSON.parse(payloads[0]), null, 1);
    expect(await verifyCanonicalEvidencePayloadV2(pretty)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("evidence retry decision", () => {
  const hash = fc.stringMatching(/^[0-9a-f]{64}$/);
  const submissions = fc.array(
    fc.record({ id: fc.constantFrom("req-1", "req-2", "req-3"), content: fc.constantFrom("a", "b", "c") }),
    { maxLength: 20 },
  );

  test.prop([hash, hash])("same content is a duplicate, different content is a mismatch", (accepted, other) => {
    expect(decideEvidenceRetry(null, accepted)).toBe("new");
    expect(decideEvidenceRetry(accepted, accepted)).toBe("duplicate");
    fc.pre(other !== accepted);
    expect(decideEvidenceRetry(accepted, other)).toBe("content_mismatch");
  });

  test.prop([submissions])(
    "resending never adds or replaces an acceptance",
    async (sequence) => {
      const accepted = new Map<string, string>();
      for (const { id, content } of sequence) {
        const submitted = await sha256WebCrypto(content);
        const before = accepted.get(id) ?? null;
        const decision: EvidenceRetryDecision = decideEvidenceRetry(before, submitted);
        if (decision === "new") accepted.set(id, submitted);

        expect(decision === "new").toBe(before === null);
        if (before !== null) expect(accepted.get(id)).toBe(before);
      }
      expect(accepted.size).toBe(new Set(sequence.map((s) => s.id)).size);
    },
  );
});
