import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_IMPORT_FILE_NAME_LENGTH, normalizeImportFileName } from "./file-name";

// DAN-436 (contract docs/contracts/import-v1.md §3, attack plan #1911 N4, N6
// and N9) over arbitrary strings, lone surrogates included.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const anyText = fc.oneof(fc.string({ unit: "binary", maxLength: 300 }), fc.string({ unit: fc.constantFrom("a", " ", "/", "\\", ".", "\u0301", "\u200B", "\u202E", "\u034F", "\u3164", "\uD800", "\uDC00", "\u{1F600}", "C"), maxLength: 260 }));

describe("import file name: properties", () => {
  it("N9: normalizing twice equals normalizing once", () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const once = normalizeImportFileName(input);
        expect(normalizeImportFileName(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("N4/N6: a result is bounded, NFC, trimmed and free of separators, lone surrogates and invisible characters", () => {
    fc.assert(
      fc.property(anyText, (input) => {
        const name = normalizeImportFileName(input);
        if (name === null) return;
        expect(name.length).toBeGreaterThan(0);
        expect(Array.from(name).length).toBeLessThanOrEqual(MAX_IMPORT_FILE_NAME_LENGTH);
        expect(name).toBe(name.normalize("NFC"));
        expect(name).toBe(name.trim());
        expect(name).not.toMatch(/[\\/]/u);
        expect(name).not.toMatch(LONE_SURROGATE);
        expect(name).not.toMatch(INVISIBLE);
        expect(name).not.toMatch(/\s\s/u);
        expect([".", ".."]).not.toContain(name);
      }),
      { numRuns: 500 },
    );
  });
});
