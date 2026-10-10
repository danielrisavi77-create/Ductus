import { describe, expect, it } from "vitest";

import { sha256WebCrypto } from "./crypto";
import {
  decideEvidenceRetry,
  exceedsEvidenceSegmentLimit,
  MAX_EVIDENCE_SEGMENT_BYTES,
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
} from "./evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "./evidence-segment-v2";
import { MAX_JCS_DEPTH } from "./jcs";

const A = "a".repeat(64);
const B = "b".repeat(64);

/** Canonical text of a one-event segment whose step carries `text`. */
function canonicalFixture(text: string): string {
  return canonicalEvidenceSegmentV2({
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-fixture",
    sessionId: "session-fixture",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-02T20:00:00.000Z",
    observedEndedAt: "2026-10-02T20:00:30.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        occurredAt: "2026-10-02T20:00:10.000Z",
        elapsedMs: 0,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1, text }],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId: "standard-v1",
  });
}

const encode = (text: string) => new TextEncoder().encode(text);

describe("received bytes", () => {
  it("hashes exactly the bytes it was given", async () => {
    const canonical = canonicalFixture("\u010d\u0107");
    const bytes = encode(canonical);
    const fromBytes = await verifyCanonicalEvidencePayloadV2(bytes);
    expect(fromBytes).toMatchObject({
      ok: true,
      byteLength: bytes.byteLength,
      sha256: await sha256WebCrypto(canonical),
    });
    expect(await verifyCanonicalEvidencePayloadV2(canonical)).toEqual(fromBytes);
  });

  it("rejects a byte order mark instead of dropping it", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(canonicalFixture("a"))]);
    expect(await verifyCanonicalEvidencePayloadV2(withBom)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects invalid UTF-8 instead of reading it as U+FFFD", async () => {
    const legitimate = encode(canonicalFixture("\uFFFD"));
    expect((await verifyCanonicalEvidencePayloadV2(legitimate)).ok).toBe(true);

    // Same body with the three bytes of U+FFFD replaced by one invalid byte:
    // a lenient decoder would turn it back into the legitimate text and hash.
    const at = legitimate.findIndex(
      (byte, i) => byte === 0xef && legitimate[i + 1] === 0xbf && legitimate[i + 2] === 0xbd,
    );
    const forged = new Uint8Array([...legitimate.slice(0, at), 0xff, ...legitimate.slice(at + 3)]);
    expect(new TextDecoder().decode(forged)).toBe(new TextDecoder().decode(legitimate));
    expect(await verifyCanonicalEvidencePayloadV2(forged)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses oversized bytes before decoding them", async () => {
    const oversized = new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1).fill(0x78);
    expect(await verifyCanonicalEvidencePayloadV2(oversized)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("evidence retry decision inputs", () => {
  it("throws on a hash that is not lowercase SHA-256 hex", () => {
    for (const bad of ["", A.toUpperCase(), `${A} `, undefined]) {
      expect(() =>
        decideEvidenceRetry({
          acceptedSegmentHash: bad as string,
          descriptorMatches: true,
          receivedPayloadSha256: A,
        }),
      ).toThrow("evidence-v2");
      expect(() =>
        decideEvidenceRetry({
          acceptedSegmentHash: A,
          descriptorMatches: true,
          receivedPayloadSha256: bad as string,
        }),
      ).toThrow("evidence-v2");
    }
  });
});

describe("evidence segment size limit", () => {
  it("allows exactly the limit and nothing above it", () => {
    expect(exceedsEvidenceSegmentLimit(MAX_EVIDENCE_SEGMENT_BYTES)).toBe(false);
    expect(exceedsEvidenceSegmentLimit(MAX_EVIDENCE_SEGMENT_BYTES + 1)).toBe(true);
    expect(exceedsEvidenceSegmentLimit(Number.NaN)).toBe(true);
  });

  it("refuses an oversized body before parsing it", async () => {
    const oversized = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES + 1);
    expect(await verifyCanonicalEvidencePayloadV2(oversized)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(await verifyEvidenceChainV2([oversized], null)).toEqual({
      ok: false,
      reason: "too_large",
      index: 0,
    });
  });

  it("counts UTF-8 bytes, not characters", async () => {
    // Two bytes per character: under the limit in characters, over it in bytes.
    const multibyte = "č".repeat(MAX_EVIDENCE_SEGMENT_BYTES / 2 + 1);
    expect(await verifyCanonicalEvidencePayloadV2(multibyte)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("evidence payload and chain edge cases", () => {
  it("rejects bodies that are not a non-empty string", async () => {
    for (const body of ["", null, undefined, 1, {}, "not json"]) {
      expect(await verifyCanonicalEvidencePayloadV2(body)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("verifies an empty package only against an empty head", async () => {
    expect(await verifyEvidenceChainV2([], null)).toEqual({
      ok: true,
      head: null,
      discontinuities: [],
    });
    expect(
      await verifyEvidenceChainV2([], { segmentHash: "a".repeat(64), segmentCount: 1 }),
    ).toEqual({ ok: false, reason: "head_mismatch", index: null });
  });

  it("answers head_mismatch for a well-typed head with a count no package can have", async () => {
    const hash = "a".repeat(64);
    for (const segmentCount of [0, -1]) {
      expect(
        await verifyEvidenceChainV2([], { segmentHash: hash, segmentCount }),
      ).toEqual({ ok: false, reason: "head_mismatch", index: null });
    }
  });

  it("throws on a head that is not a hash with an integer count, instead of reading it as empty", async () => {
    const hash = "a".repeat(64);
    for (const head of [
      {},
      { segmentHash: undefined, segmentCount: undefined },
      { segmentHash: hash },
      { segmentCount: 1 },
      { segmentHash: hash.toUpperCase(), segmentCount: 1 },
      { segmentHash: hash, segmentCount: Number.NaN },
      { segmentHash: hash, segmentCount: 1.5 },
      { segmentHash: hash, segmentCount: "1" },
      undefined,
      "head",
    ]) {
      await expect(
        verifyEvidenceChainV2([], head as never),
      ).rejects.toThrow("expectedHead is not a chain head");
    }
  });

  it("answers invalid, never a stack overflow, for a step nested past the JCS limit", async () => {
    // The step value sits five levels down: segment, events, event, steps, step.
    const deepest = MAX_JCS_DEPTH - 5;
    const withNesting = (depth: number) =>
      canonicalFixture("x").replace(
        '"text":"x"',
        `"text":${"[".repeat(depth)}${"]".repeat(depth)}`,
      );

    expect(await verifyCanonicalEvidencePayloadV2(withNesting(deepest))).toMatchObject({
      ok: true,
    });
    for (const depth of [deepest + 1, 5_000, 100_000]) {
      expect(await verifyCanonicalEvidencePayloadV2(withNesting(depth))).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
});
