import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonicalImportManifestV1,
  checkImportManifestV1,
  IMPORT_MANIFEST_SCHEMA_V1,
  importManifestSha256V1,
  parseImportManifestV1,
  parseImportManifestV1Bytes,
  type ImportManifestV1,
  type ImportRecomputedV1,
} from "./manifest-v1";
import { MAX_IMPORT_RAW_BYTES } from "./limits";

// DAN-436 (contract docs/contracts/import-v1.md §2, attack plan #1911): rows
// name the plan items M1 to M16 and L1. All data is invented.

type Accepted = { name: string; manifest: unknown; canonical: string; byteLength: number; manifestSha256: string };
type RejectedBytes = { name: string; text: string; code: string };
type Vectors = { vectorSchema: string; accepted: Accepted[]; rejectedBytes: RejectedBytes[] };

/**
 * The file bytes through JSON.parse, never a module import. The known-answer
 * hashes were computed outside the code under test, in Python:
 * `c = json.dumps(m, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
 * (JCS for this ASCII data) and `hashlib.sha256(c.encode()).hexdigest()`.
 */
function loadVectors(): Vectors {
  const bytes = readFileSync(new URL("./golden-vectors/import-manifest-v1.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) throw new Error("import manifest vectors: the file must be ASCII with LF line ends");
  return JSON.parse(bytes.toString("utf8")) as Vectors;
}

const vectors = loadVectors();
const utf8 = (text: string) => new TextEncoder().encode(text);

function docx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestSchema: IMPORT_MANIFEST_SCHEMA_V1,
    importId: "0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c",
    documentId: "dokument-izmisljeni-uvoz",
    importKind: "file-upload",
    fileFormat: "docx",
    rawSha256: "1".repeat(64),
    rawByteLength: 48213,
    contentSha256: "2".repeat(64),
    traces: [{ traceKind: "comment", count: 2 }],
    ...overrides,
  };
}

function pdf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rest = docx({ fileFormat: "pdf" });
  delete rest.traces;
  return { ...rest, ...overrides };
}

const code = (value: unknown) => {
  const result = parseImportManifestV1(value);
  return result.ok ? "ok" : result.code;
};

describe("import manifest v1: golden vectors (M12, M13)", () => {
  it("has the vector schema and four accepted manifests", () => {
    expect(vectors.vectorSchema).toBe("ductus-golden-vectors-v1");
    expect(vectors.accepted.map((v) => v.name)).toEqual(["docx-upload-with-traces", "docx-upload-no-traces", "pdf-upload", "docx-cloud-version"]);
  });

  for (const vector of vectors.accepted) {
    it(`${vector.name}: parses, has the recorded JCS text, length and manifestSha256`, async () => {
      const parsed = parseImportManifestV1(vector.manifest);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(canonicalImportManifestV1(parsed.manifest)).toBe(vector.canonical);
      expect(utf8(vector.canonical).byteLength).toBe(vector.byteLength);
      expect(await importManifestSha256V1(parsed.manifest)).toBe(vector.manifestSha256);
      expect(parseImportManifestV1Bytes(utf8(vector.canonical))).toEqual(parsed);
    });
  }

  for (const vector of vectors.rejectedBytes) {
    it(`${vector.name}: bytes are refused with ${vector.code}, never rewritten`, () => {
      expect(parseImportManifestV1Bytes(utf8(vector.text))).toEqual({ ok: false, code: vector.code });
    });
  }

  it("refuses bytes that are not strict UTF-8 or not JSON", () => {
    expect(parseImportManifestV1Bytes(new Uint8Array([0x7b, 0xff, 0x7d]))).toEqual({ ok: false, code: "MANIFEST_INVALID" });
    expect(parseImportManifestV1Bytes(utf8("{"))).toEqual({ ok: false, code: "MANIFEST_INVALID" });
    expect(parseImportManifestV1Bytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(vectors.accepted[0].canonical)]))).not.toHaveProperty("ok", true);
  });
});

describe("import manifest v1: closed format", () => {
  it("accepts the fixtures", () => {
    expect(code(docx())).toBe("ok");
    expect(code(docx({ traces: [] }))).toBe("ok");
    expect(code(pdf())).toBe("ok");
  });

  it.each(["author", "lastModifiedBy", "w:author", "rsid", "fileName", "email", "manifestSha256"])("M1/M16: refuses the unknown key %s", (key) => {
    const result = parseImportManifestV1(docx({ [key]: "Lorem Autor" }));
    expect(result).toEqual({ ok: false, code: "MANIFEST_INVALID" });
    expect(JSON.stringify(result)).not.toContain("Lorem Autor");
  });

  it.each(["manifestSchema", "importId", "documentId", "importKind", "fileFormat", "rawSha256", "rawByteLength", "contentSha256"])("M2: refuses a manifest without %s", (key) => {
    const value = docx();
    delete value[key];
    expect(code(value)).toBe("MANIFEST_INVALID");
  });

  it.each(["ductus-import-manifest-V1", "ductus-import-manifest-v2", "", null])("M3: refuses manifestSchema %s", (schema) => {
    expect(code(docx({ manifestSchema: schema }))).toBe("MANIFEST_INVALID");
  });

  it.each([
    "0B5C2A7E-3F1D-4C8E-9A6B-1D2E3F4A5B6C",
    "0b5c2a7e-3f1d-1c8e-9a6b-1d2e3f4a5b6c",
    "00000000-0000-0000-0000-000000000000",
    "0b5c2a7e3f1d4c8e9a6b1d2e3f4a5b6c",
    " 0b5c2a7e-3f1d-4c8e-9a6b-1d2e3f4a5b6c",
    "0b5c2a7e-3f1d-4c8e-7a6b-1d2e3f4a5b6c",
  ])("M4: refuses importId %s", (importId) => {
    expect(code(docx({ importId }))).toBe("MANIFEST_INVALID");
  });

  it.each(["A".repeat(64), "1".repeat(63), "1".repeat(65), "g".repeat(64), 1])("M5: refuses hash %s in rawSha256 and contentSha256", (hash) => {
    expect(code(docx({ rawSha256: hash }))).toBe("MANIFEST_INVALID");
    expect(code(docx({ contentSha256: hash }))).toBe("MANIFEST_INVALID");
  });

  it("M6/L1: rawByteLength from 1 to the B-8 limit, nothing else", () => {
    expect(MAX_IMPORT_RAW_BYTES).toBe(2 * 1024 * 1024);
    expect(code(docx({ rawByteLength: 1 }))).toBe("ok");
    expect(code(docx({ rawByteLength: MAX_IMPORT_RAW_BYTES }))).toBe("ok");
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10", 2 ** 53, MAX_IMPORT_RAW_BYTES + 1, null]) {
      expect(code(docx({ rawByteLength: bad }))).toBe("MANIFEST_INVALID");
    }
  });

  it("M7: closed sets for importKind and fileFormat; cloud-version only with docx", () => {
    expect(code(docx({ importKind: "paste" }))).toBe("MANIFEST_INVALID");
    expect(code(docx({ fileFormat: "odt" }))).toBe("MANIFEST_INVALID");
    expect(code(docx({ fileFormat: "DOCX" }))).toBe("MANIFEST_INVALID");
    expect(code(pdf({ importKind: "cloud-version" }))).toBe("MANIFEST_INVALID");
  });

  it("M8: traces with docx are required, unique, positive and in canonical order", () => {
    const value = docx();
    delete value.traces;
    expect(code(value)).toBe("MANIFEST_INVALID");
    const bad: unknown[] = [
      [{ traceKind: "comment", count: 1 }, { traceKind: "comment", count: 1 }],
      [{ traceKind: "comment", count: 0 }],
      [{ traceKind: "comment", count: 1.5 }],
      [{ traceKind: "comment", count: "1" }],
      [{ traceKind: "comment", count: 1 }, { traceKind: "deletion", count: 1 }, { traceKind: "insertion", count: 1 }, { traceKind: "insertion", count: 1 }],
      [{ traceKind: "move", count: 1 }],
      [{ traceKind: "comment", count: 1, author: "Lorem Autor" }],
      [{ traceKind: "comment" }],
      [{ traceKind: "insertion", count: 1 }, { traceKind: "comment", count: 1 }],
      [null],
      { 0: { traceKind: "comment", count: 1 }, length: 1 },
      "comment",
    ];
    for (const traces of bad) expect(code(docx({ traces }))).toBe("MANIFEST_INVALID");
    expect(code(docx({ traces: [{ traceKind: "comment", count: 1 }, { traceKind: "deletion", count: 2 }, { traceKind: "insertion", count: 3 }] }))).toBe("ok");
  });

  it("M9: a pdf manifest has no traces key, not even an empty one", () => {
    expect(code(pdf({ traces: [] }))).toBe("MANIFEST_INVALID");
    expect(code(pdf({ traces: [{ traceKind: "comment", count: 1 }] }))).toBe("MANIFEST_INVALID");
    expect(code(pdf({ traces: undefined }))).toBe("MANIFEST_INVALID");
  });

  it("M10: savedAt only with cloud-version and only in a whole UTC minute", () => {
    expect(code(docx({ savedAt: "2026-11-10T08:15:00.000Z" }))).toBe("MANIFEST_INVALID");
    const cloud = (savedAt: unknown) => code(docx({ importKind: "cloud-version", savedAt }));
    expect(cloud("2026-11-10T08:15:00.000Z")).toBe("ok");
    for (const bad of ["2026-11-10T08:15:30.000Z", "2026-11-10T08:15:00.001Z", "2026-11-10T08:15:00.000", "2026-11-10T08:15:00.000+01:00", "2026-02-30T08:15:00.000Z", "2026-11-10T24:00:00.000Z", 1, null]) {
      expect(cloud(bad)).toBe("MANIFEST_INVALID");
    }
    expect(code(docx({ importKind: "cloud-version" }))).toBe("ok");
  });

  it("M11: only plain objects; no prototype pollution", () => {
    for (const bad of [null, undefined, [], 1, "x", new Date(0), Object.create({ injected: true })]) expect(code(bad)).toBe("MANIFEST_INVALID");
    const polluted = JSON.parse(`{"__proto__":{"polluted":true},${JSON.stringify(docx()).slice(1)}`);
    expect(code(polluted)).toBe("MANIFEST_INVALID");
    expect(code(docx({ constructor: "x" }))).toBe("MANIFEST_INVALID");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(code(Object.assign(Object.create(null), docx()))).toBe("ok");
  });

  it("refuses a blank, overlong or lone-surrogate documentId", () => {
    for (const bad of ["", "   ", "x".repeat(257), "a\uD800b", 1]) expect(code(docx({ documentId: bad }))).toBe("MANIFEST_INVALID");
    expect(code(docx({ documentId: "x".repeat(256) }))).toBe("ok");
  });

  it("returns a frozen clean copy that shares nothing with the input", () => {
    const input = docx();
    const parsed = parseImportManifestV1(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.manifest)).toBe(true);
    expect(Object.isFrozen(parsed.manifest.traces)).toBe(true);
    (input.traces as { count: number }[])[0].count = 99;
    expect(parsed.manifest.traces?.[0].count).toBe(2);
  });

  it("M15: the canonical bytes carry no author, file name or document text", () => {
    const parsed = parseImportManifestV1(docx());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = canonicalImportManifestV1(parsed.manifest);
    for (const probe of ["Lorem Autor", "Seminar o vodi", ".docx", "author", "fileName"]) expect(text).not.toContain(probe);
  });
});

describe("import manifest v1: server recomputation (M14, B3)", () => {
  const manifest = (() => {
    const parsed = parseImportManifestV1(docx({ traces: [{ traceKind: "comment", count: 2 }, { traceKind: "insertion", count: 1 }] }));
    if (!parsed.ok) throw new Error("fixture");
    return parsed.manifest;
  })();
  const same = {
    rawSha256: manifest.rawSha256,
    rawByteLength: manifest.rawByteLength,
    contentSha256: manifest.contentSha256,
    traces: [{ traceKind: "comment" as const, count: 2 }, { traceKind: "insertion" as const, count: 1 }],
  };

  it("accepts exactly what the server recomputed", () => {
    expect(checkImportManifestV1(manifest, same)).toEqual({ ok: true, manifest });
  });

  it.each([
    ["rawSha256", { rawSha256: "3".repeat(64) }, "RAW_SHA256_MISMATCH"],
    ["rawByteLength", { rawByteLength: 48214 }, "RAW_BYTE_LENGTH_MISMATCH"],
    ["contentSha256", { contentSha256: "3".repeat(64) }, "CONTENT_SHA256_MISMATCH"],
    ["trace count", { traces: [{ traceKind: "comment", count: 3 }, { traceKind: "insertion", count: 1 }] }, "TRACES_MISMATCH"],
    ["missing trace", { traces: [{ traceKind: "comment", count: 2 }] }, "TRACES_MISMATCH"],
    ["no traces recomputed", { traces: undefined }, "TRACES_MISMATCH"],
  ])("rejects the whole import when %s differs", (_label, change, expected) => {
    const result = checkImportManifestV1(manifest, { ...same, ...change } as typeof same);
    expect(result).toEqual({ ok: false, code: expected });
    expect(JSON.stringify(result)).not.toContain(manifest.rawSha256);
  });

  it("names the first difference in a fixed order", () => {
    expect(checkImportManifestV1(manifest, { ...same, rawSha256: "3".repeat(64), rawByteLength: 1, traces: [] })).toEqual({ ok: false, code: "RAW_SHA256_MISMATCH" });
    expect(checkImportManifestV1(manifest, { ...same, rawByteLength: 1, contentSha256: "3".repeat(64) })).toEqual({ ok: false, code: "RAW_BYTE_LENGTH_MISMATCH" });
  });

  it("a pdf manifest matches only a recomputation without traces", () => {
    const parsed = parseImportManifestV1(pdf());
    if (!parsed.ok) throw new Error("fixture");
    const pdfManifest: ImportManifestV1 = parsed.manifest;
    const noTraces: ImportRecomputedV1 = { rawSha256: same.rawSha256, rawByteLength: same.rawByteLength, contentSha256: same.contentSha256 };
    expect(checkImportManifestV1(pdfManifest, noTraces).ok).toBe(true);
    expect(checkImportManifestV1(pdfManifest, { ...noTraces, traces: [] })).toEqual({ ok: false, code: "TRACES_MISMATCH" });
  });
});
