import { describe, expect, it } from "vitest";

import {
  exceedsEvidenceSegmentLimit,
  MAX_EVIDENCE_SEGMENT_BYTES,
  verifyCanonicalEvidencePayloadV2,
  verifyEvidenceChainV2,
} from "./evidence-chain-v2";

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
});
