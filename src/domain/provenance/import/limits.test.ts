import { describe, expect, it } from "vitest";

import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import { DEFAULT_DOCX_LIMITS, DocxRejected, resolveDocxLimits } from "../docx/limits";
import { IMPORT_DOCX_READ_LIMITS, IMPORT_PENDING_LIFETIME_MS, isImportRawByteLength, MAX_IMPORT_RAW_BYTES, resolveImportDocxLimits } from "./limits";
import { parseImportManifestV1 } from "./manifest-v1";

// DAN-436 (contract docs/contracts/import-v1.md §4, attack plan #1911 L1, L3
// and L4). No limit here is new: each is an existing one or a PRIJEDLOG the
// review records (D-291).

describe("import limits", () => {
  it("L1: the raw size limit is the B-8 segment limit", () => {
    expect(MAX_IMPORT_RAW_BYTES).toBe(MAX_EVIDENCE_SEGMENT_BYTES);
    expect(isImportRawByteLength(MAX_IMPORT_RAW_BYTES)).toBe(true);
    expect(isImportRawByteLength(MAX_IMPORT_RAW_BYTES + 1)).toBe(false);
    expect(isImportRawByteLength(1)).toBe(true);
    for (const bad of [0, -1, 0.5, Number.NaN, "1", 1n, null]) expect(isImportRawByteLength(bad)).toBe(false);
  });

  it("the docx read limits are the defaults, with the input bounded by the raw limit", () => {
    expect(IMPORT_DOCX_READ_LIMITS).toEqual({ ...DEFAULT_DOCX_LIMITS, maxInputBytes: MAX_IMPORT_RAW_BYTES });
    expect(IMPORT_DOCX_READ_LIMITS.maxInputBytes).toBeLessThanOrEqual(DEFAULT_DOCX_LIMITS.maxInputBytes);
    expect(Object.isFrozen(IMPORT_DOCX_READ_LIMITS)).toBe(true);
  });

  it("L3: a caller cannot loosen the import read limits, only tighten them", () => {
    expect(resolveImportDocxLimits()).toEqual(IMPORT_DOCX_READ_LIMITS);
    // The generic resolver would allow 64 MiB here; the import one does not.
    expect(resolveDocxLimits({ maxInputBytes: DEFAULT_DOCX_LIMITS.maxInputBytes }).maxInputBytes).toBeGreaterThan(MAX_IMPORT_RAW_BYTES);
    expect(resolveImportDocxLimits({ maxInputBytes: DEFAULT_DOCX_LIMITS.maxInputBytes * 4 }).maxInputBytes).toBe(MAX_IMPORT_RAW_BYTES);
    expect(resolveImportDocxLimits({ maxEntries: 10 ** 9, maxRatio: 10 ** 6 })).toEqual(IMPORT_DOCX_READ_LIMITS);
    expect(resolveImportDocxLimits({ maxInputBytes: 1024, maxXmlDepth: 8 })).toEqual({ ...IMPORT_DOCX_READ_LIMITS, maxInputBytes: 1024, maxXmlDepth: 8 });
    for (const bad of [{ maxInputBytes: 0 }, { maxInputBytes: 1.5 }, { unknown: 1 }]) {
      expect(() => resolveImportDocxLimits(bad as never)).toThrow(DocxRejected);
    }
  });

  it("L4: a size rejection carries a code only, no name and no number", () => {
    const result = parseImportManifestV1({
      manifestSchema: "ductus-import-manifest-v1",
      importId: "0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c",
      documentId: "dokument-izmisljeni-uvoz",
      importKind: "file-upload",
      fileFormat: "pdf",
      rawSha256: "1".repeat(64),
      rawByteLength: MAX_IMPORT_RAW_BYTES + 1,
      contentSha256: "2".repeat(64),
    });
    expect(result).toEqual({ ok: false, code: "MANIFEST_INVALID" });
    expect(Object.keys(result).sort()).toEqual(["code", "ok"]);
  });

  it("a prepared import lives one hour", () => {
    expect(IMPORT_PENDING_LIFETIME_MS).toBe(60 * 60 * 1000);
  });
});
