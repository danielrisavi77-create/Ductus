import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { sha256WebCrypto } from "./crypto";
import { verifyCanonicalEvidencePayloadV2, type VerifiedEvidencePayloadV2 } from "./evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "./evidence-segment-v2";
import {
  canonicalEvidenceTimingV1,
  EVIDENCE_TIMING_FORMAT_V1,
  MAX_EVIDENCE_TIMING_BYTES,
  verifyEvidenceTimingV1,
  type EvidenceTimingV1,
} from "./evidence-timing-v1";
import { canonicalizeJcs } from "./jcs";

// Synthetic only: invented ids and Lorem ipsum; no real work or person.
const step = (text: string) => ({ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text }] } });

/** A verified segment of two events (two steps, then one) over 10:00 to 10:01. */
async function segment(sequenceFrom = 17, ended = "10:01"): Promise<VerifiedEvidencePayloadV2> {
  const canonical = canonicalEvidenceSegmentV2({
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-ana-z1",
    sessionId: "session-ana",
    segmentId: `segment-${sequenceFrom}`,
    sequenceFrom,
    sequenceTo: sequenceFrom + 1,
    observedStartedAt: "2026-10-20T10:00:00.000Z",
    observedEndedAt: `2026-10-20T${ended}:00.000Z`,
    initialDocumentHash: "1".repeat(64),
    finalDocumentHash: "3".repeat(64),
    predecessorSegmentHash: null,
    events: [
      { sequence: sequenceFrom, source: "editor", steps: [step("L"), step("o")], beforeDocumentHash: "1".repeat(64), afterDocumentHash: "2".repeat(64) },
      { sequence: sequenceFrom + 1, source: "paste", steps: [step("rem")], beforeDocumentHash: "2".repeat(64), afterDocumentHash: "3".repeat(64) },
    ],
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  });
  const verified = await verifyCanonicalEvidencePayloadV2(new TextEncoder().encode(canonical));
  if (!verified.ok) throw new Error(verified.reason);
  return verified;
}

const timingOf = (seg: VerifiedEvidencePayloadV2, offsets: number[][] = [[0, 100], [300]]): EvidenceTimingV1 => ({
  timingFormat: EVIDENCE_TIMING_FORMAT_V1,
  segmentHash: seg.sha256,
  events: seg.segment.events.map((event, i) => ({ sequence: event.sequence, stepOffsetsMs: offsets[i] })),
});
const bytes = (text: string) => new TextEncoder().encode(text);
const verifyValue = (value: unknown, seg: VerifiedEvidencePayloadV2) => verifyEvidenceTimingV1(bytes(canonicalizeJcs(value)), seg);

describe("ductus-evidence-timing-v1 (DAN-344 P1)", () => {
  it("is exactly this JCS text, and the verifier gives back its value, hash and size", async () => {
    const seg = await segment();
    const text = canonicalEvidenceTimingV1(timingOf(seg));
    expect(text).toBe(
      `{"events":[{"sequence":17,"stepOffsetsMs":[0,100]},{"sequence":18,"stepOffsetsMs":[300]}],` +
        `"segmentHash":"${seg.sha256}","timingFormat":"ductus-evidence-timing-v1"}`,
    );
    const result = await verifyEvidenceTimingV1(bytes(text), seg);
    expect(result).toStrictEqual({
      ok: true,
      timing: timingOf(seg),
      sha256: await sha256WebCrypto(text),
      byteLength: bytes(text).byteLength,
    });
  });

  it("accepts equal offsets and the last 100 ms of the segment's minutes", async () => {
    const seg = await segment(17, "10:01");
    // 10:00 to 10:01 carries two minutes: offsets below 120 000.
    expect((await verifyValue(timingOf(seg, [[0, 0], [119_900]]), seg)).ok).toBe(true);
    expect(await verifyValue(timingOf(seg, [[0, 0], [120_000]]), seg)).toStrictEqual({ ok: false, reason: "wrong_offset" });
    const oneMinute = await segment(17, "10:00");
    expect((await verifyValue(timingOf(oneMinute, [[0, 0], [59_900]]), oneMinute)).ok).toBe(true);
    expect(await verifyValue(timingOf(oneMinute, [[0, 0], [60_000]]), oneMinute)).toStrictEqual({ ok: false, reason: "wrong_offset" });
  });

  it("gives no timing to a segment whose minutes are more than one apart (D-24: at most 30 s)", async () => {
    for (const ended of ["10:02", "23:59"]) {
      const seg = await segment(17, ended);
      expect(await verifyValue(timingOf(seg, [[0, 0], [300]]), seg)).toStrictEqual({ ok: false, reason: "long_segment" });
    }
  });

  it("refuses the timing of another segment, or one that does not follow its events and steps", async () => {
    const seg = await segment();
    const other = await segment(30);
    expect(await verifyValue(timingOf(other), seg)).toStrictEqual({ ok: false, reason: "other_segment" });
    const shapes: unknown[] = [
      { ...timingOf(seg), events: timingOf(seg).events.slice(0, 1) },
      { ...timingOf(seg), events: [...timingOf(seg).events].reverse() },
      timingOf(seg, [[0], [300]]),
      timingOf(seg, [[0, 100, 200], [300]]),
      { ...timingOf(seg), events: [{ sequence: 17, stepOffsetsMs: [0, 100] }, { sequence: 19, stepOffsetsMs: [300] }] },
    ];
    for (const value of shapes) expect(await verifyValue(value, seg)).toStrictEqual({ ok: false, reason: "wrong_shape" });
  });

  it("refuses a falling, negative, unrounded or out-of-minutes offset", async () => {
    const seg = await segment();
    for (const offsets of [[[0, 200], [100]], [[100, 0], [300]], [[-100, 0], [300]], [[0, 150], [300]], [[0, 100], [120_000]]]) {
      expect(await verifyValue(timingOf(seg, offsets), seg)).toStrictEqual({ ok: false, reason: "wrong_offset" });
    }
    for (const offsets of [[[0, 100.5], [300]], [[0, Number.MAX_SAFE_INTEGER + 1], [300]]]) {
      expect(await verifyValue(timingOf(seg, offsets), seg)).toStrictEqual({ ok: false, reason: "wrong_shape" });
    }
  });

  it("refuses an unknown field, a person, a document or an absolute time anywhere", async () => {
    const seg = await segment();
    const base = timingOf(seg);
    const extra: unknown[] = [
      { ...base, documentId: "doc-ana-z1" },
      { ...base, author: "Ana" },
      { ...base, timingFormat: "ductus-evidence-timing-v2" },
      { ...base, events: [{ ...base.events[0], at: "2026-10-20T10:00:00.100Z" }, base.events[1]] },
      { ...base, segmentHash: seg.sha256.toUpperCase() },
      [base],
      null,
    ];
    for (const value of extra) expect(await verifyValue(value, seg)).toStrictEqual({ ok: false, reason: "wrong_shape" });
    expect(() => canonicalEvidenceTimingV1({ ...base, author: "Ana" } as EvidenceTimingV1)).toThrow();
  });

  it("refuses bytes that are not exactly the canonical text, or over 1 MiB", async () => {
    const seg = await segment();
    const text = canonicalEvidenceTimingV1(timingOf(seg));
    const pretty = JSON.stringify(JSON.parse(text), null, 1);
    const reordered = JSON.stringify({ timingFormat: EVIDENCE_TIMING_FORMAT_V1, segmentHash: seg.sha256, events: timingOf(seg).events });
    for (const wrong of [pretty, reordered, `${text} `, text.replace('"stepOffsetsMs":[0,', '"stepOffsetsMs":[0.0,')]) {
      expect(await verifyEvidenceTimingV1(bytes(wrong), seg)).toStrictEqual({ ok: false, reason: "not_canonical" });
    }
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(text)]);
    expect(await verifyEvidenceTimingV1(bom, seg)).toStrictEqual({ ok: false, reason: "invalid" });
    expect(await verifyEvidenceTimingV1(new Uint8Array([0x7b, 0xff, 0x7d]), seg)).toStrictEqual({ ok: false, reason: "invalid" });
    expect(await verifyEvidenceTimingV1(new Uint8Array(MAX_EVIDENCE_TIMING_BYTES + 1), seg)).toStrictEqual({ ok: false, reason: "too_large" });
    expect(await verifyEvidenceTimingV1(text as unknown as Uint8Array, seg)).toStrictEqual({ ok: false, reason: "invalid" });
  });

  it("checks the bytes it was given, not a later change to them", async () => {
    const seg = await segment();
    const given = bytes(canonicalEvidenceTimingV1(timingOf(seg)));
    const pending = verifyEvidenceTimingV1(given, seg);
    given.fill(0x20);
    expect((await pending).ok).toBe(true);
  });

  it("carries no field that measures a person or a duration", async () => {
    const seg = await segment();
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { keys.add(key); walk(inner); }
    };
    walk(timingOf(seg));
    expect([...keys].sort()).toStrictEqual(["events", "segmentHash", "sequence", "stepOffsetsMs", "timingFormat"]);
  });
});
