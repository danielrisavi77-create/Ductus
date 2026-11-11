import { describe, expect, it } from "vitest";

import { MAX_IMPORT_FILE_NAME_LENGTH, normalizeImportFileName } from "./file-name";
import { importManifestSha256V1, parseImportManifestV1 } from "./manifest-v1";

// DAN-436 (contract docs/contracts/import-v1.md §3, attack plan #1911 N1 to
// N8; N9 is in file-name.property.test.ts). All names are invented.

describe("import file name: normalization", () => {
  it("keeps an ordinary name as it is", () => {
    expect(normalizeImportFileName("Seminar o vodi.docx")).toBe("Seminar o vodi.docx");
  });

  it.each([
    ["../../etc/passwd.docx", "passwd.docx"],
    ["C:\\Users\\x\\Rad.docx", "Rad.docx"],
    ["a/b\\c.docx", "c.docx"],
    ["mapa/", null],
  ])("N1: keeps only the last path segment of %s", (input, expected) => {
    expect(normalizeImportFileName(input)).toBe(expected);
  });

  it("N2: removes bidi, zero-width, C0, C1 and DEL characters", () => {
    expect(normalizeImportFileName("Rad\u202Excod.docx")).toBe("Radxcod.docx");
    expect(normalizeImportFileName("\u2066Rad\u2069\u200B\u200D\uFEFF.docx")).toBe("Rad.docx");
    expect(normalizeImportFileName("R\u0000a\u001Fd\u007F\u0085\u009F.docx")).toBe("Rad.docx");
    expect(normalizeImportFileName("Rad\u2028\u2029.docx")).toBe("Rad.docx");
  });

  it("N3: NFD and NFC forms of one name give the same result", () => {
    const nfc = "Čitanje i učenje.docx";
    expect(normalizeImportFileName(nfc.normalize("NFD"))).toBe(nfc);
    expect(normalizeImportFileName(nfc)).toBe(nfc);
    // A format character between a letter and its combining mark.
    expect(normalizeImportFileName("C\u200B\u030Citanje.docx")).toBe("Čitanje.docx");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeImportFileName("  Seminar \t o\u00A0 vodi.docx  ")).toBe("Seminar o vodi.docx");
  });

  it("N4: cuts at the limit on a code point, never inside a surrogate pair", () => {
    expect(MAX_IMPORT_FILE_NAME_LENGTH).toBe(200);
    expect(normalizeImportFileName("a".repeat(250))).toBe("a".repeat(200));
    const emoji = normalizeImportFileName("a".repeat(199) + "\u{1F600}\u{1F600}");
    expect(emoji).toBe("a".repeat(199) + "\u{1F600}");
    expect(Array.from(emoji ?? "")).toHaveLength(200);
    // The cut lands on whitespace: trimmed again.
    expect(normalizeImportFileName("a".repeat(199) + " b")).toBe("a".repeat(199));
  });

  it.each(["", "   ", "\u0000\u200B", ".", "..", " .. ", "a/..", 42, null, undefined, {}])("N5: %s gives no name", (input) => {
    expect(normalizeImportFileName(input)).toBeNull();
  });

  it("N6: removes lone surrogates and keeps pairs", () => {
    expect(normalizeImportFileName("Ra\uD800d\uDC00.docx")).toBe("Rad.docx");
    expect(normalizeImportFileName("Rad\u{1F4C4}.docx")).toBe("Rad\u{1F4C4}.docx");
  });

  it("N7: markup stays text; the contract requires a text-only display", () => {
    expect(normalizeImportFileName("<img src=x onerror=alert(1)>.docx")).toBe("<img src=x onerror=alert(1)>.docx");
  });

  it("N8: the file name is in no manifest and changes no manifestSha256", async () => {
    const parsed = parseImportManifestV1({
      manifestSchema: "ductus-import-manifest-v1",
      importId: "0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c",
      documentId: "dokument-izmisljeni-uvoz",
      importKind: "file-upload",
      fileFormat: "pdf",
      rawSha256: "1".repeat(64),
      rawByteLength: 10,
      contentSha256: "2".repeat(64),
    });
    if (!parsed.ok) throw new Error("fixture");
    const before = await importManifestSha256V1(parsed.manifest);
    expect(normalizeImportFileName("Seminar o vodi.pdf")).toBe("Seminar o vodi.pdf");
    expect(await importManifestSha256V1(parsed.manifest)).toBe(before);
    expect(parseImportManifestV1({ ...parsed.manifest, fileName: "Seminar o vodi.pdf" }).ok).toBe(false);
  });
});
