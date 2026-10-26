import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { verifyCanonicalEvidencePayloadV2, verifyEvidenceChainV2 } from "./evidence-chain-v2";
import {
  digestEvidenceReceiptPayloadV2,
  isEvidenceReceiptPayloadV1,
  isEvidenceReceiptPayloadV2,
  type EvidenceReceiptPayloadV2,
} from "./evidence-receipt";
import {
  assertEvidenceSegment,
  canonicalEvidenceSegment,
  canonicalEvidenceSegmentV2,
  digestEvidenceSegment,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V3,
  EVIDENCE_SOURCES_V2,
  EVIDENCE_SOURCES_V3,
  evidenceSchemaForEvents,
  isEvidenceSegment,
  isEvidenceSegmentSchema,
  isEvidenceSegmentV2,
  type EvidenceSegment,
} from "./evidence-segment-v2";

// DAN-343 (contract on #896): format v3 is v2 with the source citation-form.

type Vector = { name: string; note: string; segment: unknown; canonical: string; byteLength: number; segmentHash: string };
type VectorsV3 = {
  vectorSchema: string;
  accepted: Vector[];
  rejected: Vector[];
  receiptV2: {
    payload: EvidenceReceiptPayloadV2;
    canonical: string;
    payloadDigestSha256: string;
    rejectedSchemas: string[];
  };
};

/** The file bytes through JSON.parse, never a module import (see load.ts). */
function loadVectorsV3(): VectorsV3 {
  const bytes = readFileSync(new URL("./golden-vectors/evidence-v3.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) {
    throw new Error("golden vectors v3: the file must be ASCII with LF line ends");
  }
  const parsed = JSON.parse(bytes.toString("latin1")) as VectorsV3;
  if (parsed.vectorSchema !== "ductus-golden-vectors-v1") throw new Error("golden vectors v3: unknown vectorSchema");
  return parsed;
}

const VECTORS = loadVectorsV3();
const H = (letter: string) => letter.repeat(64);

function segment(schema: string, sources: string[], from = 1, predecessor: string | null = null): EvidenceSegment {
  return {
    evidenceSchema: schema,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "dokument-izmisljeni",
    sessionId: "sesija-izmisljena",
    segmentId: `odsjecak-${from}`,
    sequenceFrom: from,
    sequenceTo: from + sources.length - 1,
    observedStartedAt: "2026-10-27T09:00:00.000Z",
    observedEndedAt: "2026-10-27T09:00:00.000Z",
    initialDocumentHash: H("0"),
    finalDocumentHash: H(String(sources.length)),
    predecessorSegmentHash: predecessor,
    events: sources.map((source, index) => ({
      sequence: from + index,
      source,
      steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "x" }] } }],
      beforeDocumentHash: H(String(index)),
      afterDocumentHash: H(String(index + 1)),
    })),
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  } as EvidenceSegment;
}

describe("evidence segment v3: the format", () => {
  it("is v2's closed set of sources and citation-form, written out", () => {
    expect(EVIDENCE_SEGMENT_SCHEMA_V3).toBe("ductus-evidence-segment-v3");
    expect(EVIDENCE_SOURCES_V3).toEqual([
      "editor",
      "paste",
      "cut",
      "drop",
      "composition",
      "system-replacement",
      "keyless-input",
      "unattributed",
      "citation-form",
    ]);
    expect(EVIDENCE_SOURCES_V2).toHaveLength(8);
    expect(EVIDENCE_SOURCES_V2).not.toContain("citation-form");
  });

  it("takes every v3 source in v3 and citation-form in v3 only", () => {
    for (const source of EVIDENCE_SOURCES_V3) {
      expect(isEvidenceSegment(segment(EVIDENCE_SEGMENT_SCHEMA_V3, [source])), source).toBe(true);
    }
    for (const source of EVIDENCE_SOURCES_V2) {
      expect(isEvidenceSegment(segment(EVIDENCE_SEGMENT_SCHEMA_V2, [source])), source).toBe(true);
    }
    const v2Citation = segment(EVIDENCE_SEGMENT_SCHEMA_V2, ["editor", "citation-form"]);
    expect(isEvidenceSegment(v2Citation)).toBe(false);
    expect(isEvidenceSegmentV2(v2Citation)).toBe(false);
    for (const source of ["citation", "Citation-form", "citation-form ", "citation_form", "form", ""]) {
      expect(isEvidenceSegment(segment(EVIDENCE_SEGMENT_SCHEMA_V3, [source])), source).toBe(false);
    }
  });

  it("keeps the v2-only check v2-only", () => {
    expect(isEvidenceSegmentV2(segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["editor"]))).toBe(false);
    expect(isEvidenceSegmentV2(segment(EVIDENCE_SEGMENT_SCHEMA_V2, ["editor"]))).toBe(true);
    expect(() => canonicalEvidenceSegmentV2(segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["editor"]) as never)).toThrow();
  });

  it("refuses every other schema", () => {
    for (const schema of [
      "ductus-evidence-segment-v1",
      "ductus-evidence-segment-v4",
      "ductus-evidence-segment-V3",
      "ductus-evidence-segment-v3 ",
      "",
      null,
      3,
    ]) {
      expect(isEvidenceSegment(segment(schema as string, ["editor"])), String(schema)).toBe(false);
      expect(isEvidenceSegmentSchema(schema)).toBe(false);
    }
    const missing = segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["editor"]) as Partial<EvidenceSegment>;
    delete missing.evidenceSchema;
    expect(isEvidenceSegment(missing)).toBe(false);
  });

  it("holds the other v2 rules for v3", () => {
    const extra = { ...segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["citation-form"]), futureMeaning: 1 };
    expect(isEvidenceSegment(extra)).toBe(false);
    const broken = segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["editor", "citation-form"]);
    broken.events[1]!.beforeDocumentHash = H("9");
    expect(isEvidenceSegment(broken)).toBe(false);
    const wrongCount = segment(EVIDENCE_SEGMENT_SCHEMA_V3, ["citation-form"]);
    wrongCount.sequenceTo = 2;
    expect(isEvidenceSegment(wrongCount)).toBe(false);
    expect(() => assertEvidenceSegment(extra)).toThrow();
  });

  it("is written as v3 only for a segment with a citation-form event", () => {
    expect(evidenceSchemaForEvents([{ source: "editor" }, { source: "paste" }])).toBe(EVIDENCE_SEGMENT_SCHEMA_V2);
    expect(evidenceSchemaForEvents([{ source: "editor" }, { source: "citation-form" }])).toBe(
      EVIDENCE_SEGMENT_SCHEMA_V3,
    );
    expect(evidenceSchemaForEvents([])).toBe(EVIDENCE_SEGMENT_SCHEMA_V2);
  });
});

describe("evidence segment v3: golden vectors (evidence-v3.json)", () => {
  it.each(VECTORS.accepted.map((vector) => [vector.name, vector] as const))(
    "accepts %s byte for byte",
    async (_name, vector) => {
      expect(isEvidenceSegment(vector.segment)).toBe(true);
      expect(canonicalEvidenceSegment(vector.segment as EvidenceSegment)).toBe(vector.canonical);
      const digest = await digestEvidenceSegment(vector.segment as EvidenceSegment);
      expect(digest).toEqual({ canonical: vector.canonical, byteLength: vector.byteLength, sha256: vector.segmentHash });
      const verified = await verifyCanonicalEvidencePayloadV2(new TextEncoder().encode(vector.canonical));
      expect(verified).toMatchObject({ ok: true, sha256: vector.segmentHash, byteLength: vector.byteLength });
    },
  );

  it.each(VECTORS.rejected.map((vector) => [vector.name, vector] as const))(
    "refuses %s",
    async (_name, vector) => {
      expect(isEvidenceSegment(vector.segment)).toBe(false);
      expect(await verifyCanonicalEvidencePayloadV2(new TextEncoder().encode(vector.canonical))).toEqual({
        ok: false,
        reason: "invalid",
      });
    },
  );

  it("signs a receipt naming v3 over the same digest form", async () => {
    const { payload, canonical, payloadDigestSha256, rejectedSchemas } = VECTORS.receiptV2;
    expect(isEvidenceReceiptPayloadV2(payload)).toBe(true);
    const digest = await digestEvidenceReceiptPayloadV2(payload);
    expect(digest.canonical).toBe(canonical);
    expect(digest.sha256).toBe(payloadDigestSha256);
    for (const evidenceSchema of rejectedSchemas) {
      expect(isEvidenceReceiptPayloadV2({ ...payload, evidenceSchema }), evidenceSchema).toBe(false);
    }
    const v1 = { ...payload, receiptSchema: "ductus-evidence-receipt-v1" } as Record<string, unknown>;
    for (const key of ["revision", "clientTransactionId", "evidenceDomainId", "principalId"]) delete v1[key];
    v1.acceptedAt = "2026-10-27T09:02:13.456Z";
    expect(isEvidenceReceiptPayloadV1(v1)).toBe(true);
    expect(isEvidenceReceiptPayloadV1({ ...v1, evidenceSchema: "ductus-evidence-segment-v4" })).toBe(false);
  });
});

describe("evidence segment v3: a package chain", () => {
  async function chain(schemas: string[]): Promise<{ payloads: string[]; head: { segmentHash: string; segmentCount: number } }> {
    const payloads: string[] = [];
    let predecessor: string | null = null;
    let from = 1;
    for (const schema of schemas) {
      const sources = schema === EVIDENCE_SEGMENT_SCHEMA_V3 ? ["editor", "citation-form"] : ["editor"];
      const digest = await digestEvidenceSegment(segment(schema, sources, from, predecessor));
      payloads.push(digest.canonical);
      predecessor = digest.sha256;
      from += sources.length;
    }
    return { payloads, head: { segmentHash: predecessor!, segmentCount: payloads.length } };
  }

  it("holds v2 and v3 segments in any order (a tab opened before v3 keeps writing v2)", async () => {
    for (const order of [
      [EVIDENCE_SEGMENT_SCHEMA_V2, EVIDENCE_SEGMENT_SCHEMA_V3, EVIDENCE_SEGMENT_SCHEMA_V2],
      [EVIDENCE_SEGMENT_SCHEMA_V3, EVIDENCE_SEGMENT_SCHEMA_V2],
      [EVIDENCE_SEGMENT_SCHEMA_V3, EVIDENCE_SEGMENT_SCHEMA_V3],
    ]) {
      const { payloads, head } = await chain(order);
      expect(await verifyEvidenceChainV2(payloads, head), order.join(",")).toMatchObject({ ok: true });
    }
  });
});
