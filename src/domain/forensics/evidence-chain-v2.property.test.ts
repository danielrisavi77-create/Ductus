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
  /** Segment index before which event sequence numbers are skipped. */
  sequenceGapBefore?: number;
  /** Segment index before which document revisions are skipped. */
  documentGapBefore?: number;
  /** Segment index whose events start again from sequence 1. */
  sequenceRestartAt?: number;
  /** Segment index that names another document while linking correctly. */
  foreignDocumentAt?: number;
};

async function buildChain(spec: ChainSpec, options: ChainOptions = {}): Promise<BuiltChain> {
  const payloads: string[] = [];
  let predecessor: string | null = null;
  let sequence = 1;
  let revision = 0;

  for (const [index, events] of spec.entries()) {
    if (index === options.sequenceGapBefore) sequence += 7;
    if (index === options.documentGapBefore) revision += 7;
    if (index === options.sequenceRestartAt) sequence = 1;
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
      observedEndedAt: "2026-10-02T20:01:00.000Z",
      initialDocumentHash: documentHash(revision),
      finalDocumentHash: documentHash(revision + events.length),
      predecessorSegmentHash: predecessor,
      events: events.map((event, offset) => ({
        sequence: sequence + offset,
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

  test.prop([chainSpec(2), fc.nat(), fc.constantFrom("sequence", "document", "both")])(
    "a linked chain with a gap verifies but reports which continuity broke",
    async (spec, pick, kind) => {
      const at = 1 + (pick % (spec.length - 1));
      const { payloads, head } = await buildChain(spec, {
        sequenceGapBefore: kind === "document" ? undefined : at,
        documentGapBefore: kind === "sequence" ? undefined : at,
      });
      const previousSequenceTo = spec.slice(0, at).flat().length;
      expect(await verifyEvidenceChainV2(payloads, head)).toEqual({
        ok: true,
        head,
        discontinuities: [
          {
            index: at,
            previousSequenceTo,
            sequenceFrom: previousSequenceTo + (kind === "document" ? 1 : 8),
            sequence: kind === "document" ? "continuous" : "gap",
            documentHashBreak: kind !== "sequence",
          },
        ],
      });
    },
  );

  test.prop([chainSpec(2), fc.nat()])(
    "a segment whose sequence goes back is reported as a regression, not as a gap",
    async (spec, pick) => {
      const at = 1 + (pick % (spec.length - 1));
      const { payloads, head } = await buildChain(spec, { sequenceRestartAt: at });
      expect(await verifyEvidenceChainV2(payloads, head)).toEqual({
        ok: true,
        head,
        discontinuities: [
          {
            index: at,
            previousSequenceTo: spec.slice(0, at).flat().length,
            sequenceFrom: 1,
            sequence: "regression",
            documentHashBreak: false,
          },
        ],
      });
    },
  );

  test.prop([chainSpec(1)])("received bytes verify to the same head as their text", async (spec) => {
    const { payloads, head } = await buildChain(spec);
    const bytes = payloads.map((payload) => new TextEncoder().encode(payload));
    expect(await verifyEvidenceChainV2(bytes, head)).toEqual({
      ok: true,
      head,
      discontinuities: [],
    });
  });

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
    fc.record({
      id: fc.constantFrom("req-1", "req-2", "req-3"),
      content: fc.constantFrom("a", "b", "c"),
      descriptor: fc.constantFrom("d1", "d2"),
    }),
    { maxLength: 20 },
  );

  test.prop([hash, hash, fc.boolean()])(
    "follows the decided retry contract for every combination",
    (accepted, other, descriptorMatches) => {
      fc.pre(other !== accepted);
      const decide = (acceptedSegmentHash: string | null, matches: boolean, received: string) =>
        decideEvidenceRetry({
          acceptedSegmentHash,
          descriptorMatches: matches,
          receivedPayloadSha256: received,
        });

      expect(decide(null, descriptorMatches, accepted)).toBe("new");
      expect(decide(accepted, true, accepted)).toBe("duplicate");
      expect(decide(accepted, true, other)).toBe("invalid");
      expect(decide(accepted, false, accepted)).toBe("idempotency_conflict");
      expect(decide(accepted, false, other)).toBe("idempotency_conflict");
    },
  );

  test.prop([submissions])("resending never adds or replaces an acceptance", async (sequence) => {
    const accepted = new Map<string, { hash: string; descriptor: string }>();
    for (const { id, content, descriptor } of sequence) {
      const received = await sha256WebCrypto(content);
      const before = accepted.get(id) ?? null;
      const decision: EvidenceRetryDecision = decideEvidenceRetry({
        acceptedSegmentHash: before?.hash ?? null,
        descriptorMatches: before?.descriptor === descriptor,
        receivedPayloadSha256: received,
      });
      if (decision === "new") accepted.set(id, { hash: received, descriptor });

      expect(decision === "new").toBe(before === null);
      if (before !== null) expect(accepted.get(id)).toEqual(before);
    }
    expect(accepted.size).toBe(new Set(sequence.map((s) => s.id)).size);
  });
});
