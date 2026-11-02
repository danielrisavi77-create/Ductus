import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DOCUMENT_SCHEMA_VERSION, DOCUMENT_SCHEMA_VERSION_V2 } from "@/domain/document/schema";

import { verifyCanonicalEvidencePayloadV2 } from "./evidence-chain-v2";
import {
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V3,
  EVIDENCE_SOURCES_V2,
  EVIDENCE_SOURCES_V3,
  evidenceSchemaForEvents,
  isEvidenceSegment,
  isEvidenceSegmentSchema,
  RESERVED_EVIDENCE_EVENT_FIELDS,
  RESERVED_EVIDENCE_RECORD_SCHEMAS,
  RESERVED_EVIDENCE_SOURCES,
} from "./evidence-segment-v2";

// DAN-453 PR 0 (contract on #1091, attack plan #1258 G1, G2 and G5): the
// format for D-34 and D-132 is reserved before the first real evidence, and
// ingest refuses every reserved value. The vectors were derived outside the
// code under test; this file only reads them.

type Rejected = {
  name: string;
  note: string;
  base: string;
  segment: unknown;
  canonical: string;
  byteLength: number;
  segmentHash: string;
  reason: string;
};
type Vectors = {
  vectorSchema: string;
  reserved: {
    sources: { source: string; eventField: string; decision: string }[];
    recordSchemas: { schema: string; decision: string }[];
    documentSchemaVersions: number[];
  };
  rejectedSegments: Rejected[];
  pinnedFiles: Record<string, string>;
};
type Accepted = { name: string; canonical: string };

function readAscii(name: string): Buffer {
  const bytes = readFileSync(new URL(`./golden-vectors/${name}`, import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) {
    throw new Error(`${name}: the file must be ASCII with LF line ends`);
  }
  return bytes;
}

const VECTORS = JSON.parse(readAscii("format-reservation.json").toString("latin1")) as Vectors;
const ACCEPTED_V3 = (JSON.parse(readAscii("evidence-v3.json").toString("latin1")) as { accepted: Accepted[] }).accepted;
const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("format reservation (D-34, D-132)", () => {
  it("reads a vector file of the known kind with every case in it", () => {
    expect(VECTORS.vectorSchema).toBe("ductus-golden-vectors-v1");
    expect(VECTORS.rejectedSegments).toHaveLength(9);
  });

  it("G1: the code reserves exactly what the vectors reserve, in one place", () => {
    expect(RESERVED_EVIDENCE_SOURCES).toEqual(VECTORS.reserved.sources.map((entry) => entry.source));
    expect(RESERVED_EVIDENCE_EVENT_FIELDS).toEqual(VECTORS.reserved.sources.map((entry) => entry.eventField));
    expect(RESERVED_EVIDENCE_RECORD_SCHEMAS).toEqual(VECTORS.reserved.recordSchemas.map((entry) => entry.schema));
    expect(VECTORS.reserved.documentSchemaVersions).toEqual([DOCUMENT_SCHEMA_VERSION_V2]);
    expect(DOCUMENT_SCHEMA_VERSION).toBe(1);
  });

  it("G1: no reserved value is in any accepted set, and citation-form is not reserved", () => {
    for (const source of RESERVED_EVIDENCE_SOURCES) {
      expect(EVIDENCE_SOURCES_V2 as readonly string[]).not.toContain(source);
      expect(EVIDENCE_SOURCES_V3 as readonly string[]).not.toContain(source);
    }
    expect(RESERVED_EVIDENCE_SOURCES as readonly string[]).not.toContain("citation-form");
    for (const schema of RESERVED_EVIDENCE_RECORD_SCHEMAS) expect(isEvidenceSegmentSchema(schema)).toBe(false);
  });

  it("G2: every base the rejected cases were built from still verifies", async () => {
    const bases = new Set(VECTORS.rejectedSegments.map((entry) => entry.base));
    for (const base of bases) {
      const accepted = ACCEPTED_V3.find((entry) => entry.name === base);
      expect(accepted, base).toBeDefined();
      expect((await verifyCanonicalEvidencePayloadV2(bytesOf(accepted!.canonical))).ok, base).toBe(true);
    }
  });

  describe.each(VECTORS.rejectedSegments.map((entry) => [entry.name, entry] as const))("G2: %s", (_name, entry) => {
    it("is the canonical form of its segment, with the recorded size and hash", () => {
      const bytes = bytesOf(entry.canonical);
      expect(bytes.byteLength).toBe(entry.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.segmentHash);
      expect(JSON.parse(entry.canonical)).toEqual(entry.segment);
    });

    it("is refused by the segment validator and at ingest, as invalid", async () => {
      expect(entry.reason).toBe("invalid");
      expect(isEvidenceSegment(entry.segment)).toBe(false);
      expect(isEvidenceSegment(JSON.parse(entry.canonical))).toBe(false);
      await expect(verifyCanonicalEvidencePayloadV2(bytesOf(entry.canonical))).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
      await expect(verifyCanonicalEvidencePayloadV2(entry.canonical)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });
  });

  it("G5: the bytes of the evidence v2 and v3 vector files never change", () => {
    expect(Object.keys(VECTORS.pinnedFiles).sort()).toEqual(["evidence-v2.json", "evidence-v3.json"]);
    for (const [name, sha256] of Object.entries(VECTORS.pinnedFiles)) {
      expect(createHash("sha256").update(readAscii(name)).digest("hex"), name).toBe(sha256);
    }
  });

  it("G5: the writer keeps choosing v2, and v3 only for citation-form", () => {
    expect(evidenceSchemaForEvents([{ source: "editor" }, { source: "paste" }])).toBe(EVIDENCE_SEGMENT_SCHEMA_V2);
    expect(evidenceSchemaForEvents(EVIDENCE_SOURCES_V2.map((source) => ({ source })))).toBe(EVIDENCE_SEGMENT_SCHEMA_V2);
    expect(evidenceSchemaForEvents([{ source: "editor" }, { source: "citation-form" }])).toBe(
      EVIDENCE_SEGMENT_SCHEMA_V3,
    );
  });
});
