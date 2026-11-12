import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalImportManifestV1, IMPORT_TRACE_KINDS_V1, parseImportManifestV1, parseImportManifestV1Bytes } from "./manifest-v1";
import { MAX_IMPORT_RAW_BYTES } from "./limits";

// DAN-436 (contract docs/contracts/import-v1.md §2, attack plan #1911 M8 and
// M12): an accepted manifest has one JCS form, parsing it again is a fixed
// point, and any other byte form of the same value is refused.

const hex64 = fc.stringMatching(/^[0-9a-f]{64}$/);
const traces = fc
  .subarray([...IMPORT_TRACE_KINDS_V1])
  .chain((kinds) => fc.tuple(...kinds.map((kind) => fc.integer({ min: 1, max: 1_000_000 }).map((count) => ({ traceKind: kind, count })))));
const manifest = fc.oneof(
  fc.record({ importKind: fc.constant("file-upload"), fileFormat: fc.constant("docx"), traces }),
  fc.record({ importKind: fc.constant("file-upload"), fileFormat: fc.constant("pdf") }),
  fc.record(
    {
      importKind: fc.constant("cloud-version"),
      fileFormat: fc.constant("docx"),
      traces,
      savedAt: fc.integer({ min: 0, max: 5_000_000 }).map((minute) => new Date(Date.UTC(2026, 0, 1) + minute * 60_000).toISOString()),
    },
    { requiredKeys: ["importKind", "fileFormat", "traces"] },
  ),
).chain((shape) =>
  fc.record({
    manifestSchema: fc.constant("ductus-import-manifest-v1"),
    importId: fc.uuid({ version: 4 }),
    documentId: fc.string({ unit: "grapheme", minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    rawSha256: hex64,
    rawByteLength: fc.integer({ min: 1, max: MAX_IMPORT_RAW_BYTES }),
    contentSha256: hex64,
  }).map((common) => ({ ...common, ...shape })),
);

describe("import manifest v1: properties", () => {
  it("every generated manifest parses, has one JCS form and is a fixed point", () => {
    fc.assert(
      fc.property(manifest, (value) => {
        const parsed = parseImportManifestV1(value);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const text = canonicalImportManifestV1(parsed.manifest);
        const bytes = new TextEncoder().encode(text);
        const again = parseImportManifestV1Bytes(bytes);
        expect(again).toEqual(parsed);
        if (again.ok) expect(canonicalImportManifestV1(again.manifest)).toBe(text);
      }),
    );
  });

  it("any other byte form of the same value is refused", () => {
    fc.assert(
      fc.property(manifest, (value) => {
        const pretty = new TextEncoder().encode(JSON.stringify(value, null, 1));
        expect(parseImportManifestV1Bytes(pretty)).toEqual({ ok: false, code: "MANIFEST_NOT_CANONICAL" });
      }),
    );
  });

  it("an extra key of any name is refused", () => {
    const known = new Set(["manifestSchema", "importId", "documentId", "importKind", "fileFormat", "rawSha256", "rawByteLength", "contentSha256", "traces", "savedAt"]);
    fc.assert(
      fc.property(manifest, fc.string({ minLength: 1, maxLength: 12 }).filter((k) => !known.has(k)), fc.jsonValue(), (value, key, extra) => {
        expect(parseImportManifestV1({ ...value, [key]: extra })).toEqual({ ok: false, code: "MANIFEST_INVALID" });
      }),
    );
  });
});
