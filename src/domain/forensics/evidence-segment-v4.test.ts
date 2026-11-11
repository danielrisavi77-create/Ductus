import { readFileSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";

import { verifyCanonicalEvidencePayloadV2, verifyEvidenceChainV2 } from "./evidence-chain-v2";
import * as segmentModule from "./evidence-segment-v2";
import {
  canonicalEvidenceSegment,
  digestEvidenceSegment,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_PASTE_ORIGIN_KINDS_V4,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V3,
  EVIDENCE_SEGMENT_SCHEMA_V4,
  EVIDENCE_SOURCES_V3,
  EVIDENCE_SOURCES_V4,
  evidenceSchemaForEvents,
  isEvidenceSegment,
  isEvidenceSegmentSchema,
  isEvidenceSegmentV2,
  type EvidenceSegment,
} from "./evidence-segment-v2";

// DAN-411 (contract docs/contracts/evidence-segment-v4.md, attack plan #1659):
// v4 is v3 with the sources import and ai-transfer and an optional pasteOrigin
// on paste. Rows name the input classes K1 to K16 of the attack plan.

type Vector = { name: string; note: string; segment: unknown; canonical: string; byteLength: number; segmentHash: string };
type VectorsV4 = { vectorSchema: string; accepted: Vector[]; rejected: Vector[] };

/** The file bytes through JSON.parse, never a module import (see load.ts). */
function loadVectorsV4(): VectorsV4 {
  const bytes = readFileSync(new URL("./golden-vectors/evidence-v4.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) {
    throw new Error("golden vectors v4: the file must be ASCII with LF line ends");
  }
  const parsed = JSON.parse(bytes.toString("latin1")) as VectorsV4;
  if (parsed.vectorSchema !== "ductus-golden-vectors-v1") throw new Error("golden vectors v4: unknown vectorSchema");
  return parsed;
}

const VECTORS = loadVectorsV4();
const H = (letter: string) => letter.repeat(64);
const V2 = EVIDENCE_SEGMENT_SCHEMA_V2;
const V3 = EVIDENCE_SEGMENT_SCHEMA_V3;
const V4 = EVIDENCE_SEGMENT_SCHEMA_V4;
const UUID = (last: string) => `00000000-0000-4000-8000-0000000000${last}`;

type Spec = string | { source: string; [key: string]: unknown };
type Json = Record<string, unknown>;
const IMPORT = { source: "import", importId: UUID("a1"), importManifestSha256: H("1") };
const TRANSFER = { source: "ai-transfer", aiTransferId: UUID("a2"), aiTransferSha256: H("2") };
const ORIGIN = { kind: "ai-response", refId: UUID("a3"), textSha256: H("3") } as const;
const PASTE_ORIGIN = { source: "paste", pasteOrigin: ORIGIN };

function segment(schema: unknown, specs: Spec[], from = 1, predecessor: string | null = null): Json {
  return {
    evidenceSchema: schema,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "dokument-izmisljeni-v4",
    sessionId: "sesija-izmisljena-v4",
    segmentId: `odsjecak-${from}`,
    sequenceFrom: from,
    sequenceTo: from + specs.length - 1,
    observedStartedAt: "2026-11-10T09:00:00.000Z",
    observedEndedAt: "2026-11-10T09:01:00.000Z",
    initialDocumentHash: H(String((from - 1) % 10)),
    finalDocumentHash: H(String((from - 1 + specs.length) % 10)),
    predecessorSegmentHash: predecessor,
    events: specs.map((spec, index) => ({
      sequence: from + index,
      ...(typeof spec === "string" ? { source: spec } : structuredClone(spec)),
      steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "x" }] } }],
      beforeDocumentHash: H(String((from - 1 + index) % 10)),
      afterDocumentHash: H(String((from + index) % 10)),
    })),
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  };
}

/** The valid segment every v4 mutation starts from: each v4 feature once. */
const base = () => segment(V4, ["editor", IMPORT, TRANSFER, PASTE_ORIGIN, "paste"]);
const events = (value: Json) => value.events as Json[];
const event = (value: Json, index: number) => events(value)[index]!;
const origin = (value: Json) => event(value, 3).pasteOrigin as Json;
function mutated(change: (value: Json) => void): Json {
  const value = base();
  change(value);
  return value;
}

describe("evidence segment v4: the format", () => {
  it("adds exactly one segment format identifier (A4)", () => {
    const schemas = Object.entries(segmentModule)
      .filter(([name]) => name.startsWith("EVIDENCE_SEGMENT_SCHEMA_"))
      .map(([, value]) => value);
    expect(schemas).toEqual([V2, V3, V4]);
    expect(V4).toBe("ductus-evidence-segment-v4");
  });

  it("is v3's closed set of sources with import and ai-transfer, written out", () => {
    expect(EVIDENCE_SOURCES_V4).toEqual([...EVIDENCE_SOURCES_V3, "import", "ai-transfer"]);
    expect(EVIDENCE_SOURCES_V3).not.toContain("import");
    expect(EVIDENCE_PASTE_ORIGIN_KINDS_V4).toEqual(["ai-response", "source-notebook"]);
  });

  it("is not yet a schema the server accepts or a receipt names (step 2)", () => {
    expect(isEvidenceSegmentSchema(V4)).toBe(false);
    expect(isEvidenceSegmentSchema(V3)).toBe(true);
    expect(isEvidenceSegmentV2(base())).toBe(false);
  });
});

type Row = [klass: string, name: string, value: Json, accepted: boolean];
const ROWS: Row[] = [
  ["K1", "valid v2", segment(V2, ["editor", "paste"]), true],
  ["K2", "valid v3", segment(V3, ["editor", "citation-form"]), true],
  ["K3", "valid v4 with import", segment(V4, ["editor", IMPORT]), true],
  ["K3", "valid v4 with ai-transfer", segment(V4, [TRANSFER]), true],
  ["K3", "valid v4 with a paste origin", segment(V4, [PASTE_ORIGIN, "paste"]), true],
  ["K3", "valid v4 with a source-notebook origin", segment(V4, [{ source: "paste", pasteOrigin: { ...ORIGIN, kind: "source-notebook" } }]), true],
  ["K3", "valid v4 with every feature and v3 sources", segment(V4, ["citation-form", IMPORT, TRANSFER, PASTE_ORIGIN]), true],
  ["K4", "v2 with import", segment(V2, ["editor", IMPORT]), false],
  ["K4", "v3 with import", segment(V3, ["citation-form", IMPORT]), false],
  ["K4", "v2 with ai-transfer", segment(V2, [TRANSFER]), false],
  ["K4", "v3 with ai-transfer", segment(V3, [TRANSFER]), false],
  ["K4", "v2 with a paste origin", segment(V2, [PASTE_ORIGIN]), false],
  ["K4", "v3 with a paste origin", segment(V3, ["citation-form", PASTE_ORIGIN]), false],
  ["K4", "v3 with an importId on paste", segment(V3, [{ source: "paste", importId: UUID("a1") }]), false],
  ["K4", "v4 without any v4 feature", segment(V4, ["editor", "paste", "citation-form"]), false],
  ["K5", "unknown key on the segment", mutated((v) => (v.importId = UUID("a1"))), false],
  ["K5", "unknown key on an event", mutated((v) => (event(v, 1).importNote = "x")), false],
  ["K5", "unknown key in captureContext", mutated((v) => ((v.captureContext as Json).importer = "x")), false],
  ["K5", "unknown key in pasteOrigin", mutated((v) => (origin(v).text = "x")), false],
  ["K5", "pasteOrigin key with a capital", mutated((v) => (origin(v).RefId = UUID("a3"))), false],
  ["K6", "import without importId", mutated((v) => delete event(v, 1).importId), false],
  ["K6", "import without importManifestSha256", mutated((v) => delete event(v, 1).importManifestSha256), false],
  ["K6", "ai-transfer without aiTransferId", mutated((v) => delete event(v, 2).aiTransferId), false],
  ["K6", "ai-transfer without aiTransferSha256", mutated((v) => delete event(v, 2).aiTransferSha256), false],
  ["K6", "pasteOrigin without kind", mutated((v) => delete origin(v).kind), false],
  ["K6", "pasteOrigin without refId", mutated((v) => delete origin(v).refId), false],
  ["K6", "pasteOrigin without textSha256", mutated((v) => delete origin(v).textSha256), false],
  ["K7", "importId as a number", mutated((v) => (event(v, 1).importId = 1)), false],
  ["K7", "importId null", mutated((v) => (event(v, 1).importId = null)), false],
  ["K7", "aiTransferSha256 as an array", mutated((v) => (event(v, 2).aiTransferSha256 = [H("2")])), false],
  ["K7", "pasteOrigin null", mutated((v) => (event(v, 3).pasteOrigin = null)), false],
  ["K7", "pasteOrigin as an array", mutated((v) => (event(v, 3).pasteOrigin = [ORIGIN])), false],
  ["K7", "pasteOrigin as a string", mutated((v) => (event(v, 3).pasteOrigin = "ai-response")), false],
  ["K7", "pasteOrigin undefined", mutated((v) => (event(v, 3).pasteOrigin = undefined)), false],
  ["K7", "refId as a number", mutated((v) => (origin(v).refId = 0)), false],
  ["K7", "kind not in the set", mutated((v) => (origin(v).kind = "ai")), false],
  ["K7", "kind with a capital", mutated((v) => (origin(v).kind = "AI-response")), false],
  ["K8", "applied-suggestion in v4", segment(V4, [IMPORT, "applied-suggestion"]), false],
  ["K8", "own-variant in v4", segment(V4, [IMPORT, "own-variant"]), false],
  ["K8", "suggestionId on a v4 event", mutated((v) => (event(v, 3).suggestionId = UUID("a5"))), false],
  ["K8", "variantId on an import event", mutated((v) => (event(v, 1).variantId = UUID("a5"))), false],
  ["K8", "a variant record schema", mutated((v) => (v.evidenceSchema = "ductus-evidence-variant-v1")), false],
  ["K9", "an empty importId", mutated((v) => (event(v, 1).importId = "")), false],
  ["K9", "an importId of 35 characters", mutated((v) => (event(v, 1).importId = UUID("a1").slice(1))), false],
  ["K9", "an importId of 37 characters", mutated((v) => (event(v, 1).importId = `${UUID("a1")}0`)), false],
  ["K9", "an empty event list", segment(V4, []), false],
  ["K9", "documentId of 256 characters", mutated((v) => (v.documentId = "d".repeat(256))), true],
  ["K9", "documentId of 257 characters", mutated((v) => (v.documentId = "d".repeat(257))), false],
  ["K10", "a time with seconds", mutated((v) => (v.observedEndedAt = "2026-11-10T09:01:07.000Z")), false],
  ["K10", "a time with another zone", mutated((v) => (v.observedEndedAt = "2026-11-10T10:01:00.000+01:00")), false],
  ["K10", "a time on an import event", mutated((v) => (event(v, 1).observedAt = "2026-11-10T09:00:00.000Z")), false],
  ["K11", "pasteOrigin on drop", segment(V4, [IMPORT, { source: "drop", pasteOrigin: ORIGIN }]), false],
  ["K11", "pasteOrigin on editor", segment(V4, [IMPORT, { source: "editor", pasteOrigin: ORIGIN }]), false],
  ["K11", "pasteOrigin on cut", segment(V4, [IMPORT, { source: "cut", pasteOrigin: ORIGIN }]), false],
  ["K11", "pasteOrigin on import", mutated((v) => (event(v, 1).pasteOrigin = ORIGIN)), false],
  ["K11", "pasteOrigin on ai-transfer", mutated((v) => (event(v, 2).pasteOrigin = ORIGIN)), false],
  ["K11", "importId on ai-transfer", mutated((v) => (event(v, 2).importId = UUID("a1"))), false],
  ["K11", "aiTransferSha256 on import", mutated((v) => (event(v, 1).aiTransferSha256 = H("2"))), false],
  ["K11", "importManifestSha256 on paste", mutated((v) => (event(v, 4).importManifestSha256 = H("1"))), false],
  ["K12", "a manifest hash in capitals", mutated((v) => (event(v, 1).importManifestSha256 = H("A"))), false],
  ["K12", "a manifest hash of 63 characters", mutated((v) => (event(v, 1).importManifestSha256 = H("1").slice(1))), false],
  ["K12", "a transfer hash of 65 characters", mutated((v) => (event(v, 2).aiTransferSha256 = `${H("2")}2`)), false],
  ["K12", "a transfer hash that is not hex", mutated((v) => (event(v, 2).aiTransferSha256 = H("g"))), false],
  ["K12", "a text hash in capitals", mutated((v) => (origin(v).textSha256 = H("F"))), false],
  ["K14", "a nil importId", mutated((v) => (event(v, 1).importId = "00000000-0000-0000-0000-000000000000")), false],
  ["K14", "an importId of version 1", mutated((v) => (event(v, 1).importId = "00000000-0000-1000-8000-0000000000a1")), false],
  ["K14", "an importId with the wrong variant", mutated((v) => (event(v, 1).importId = "00000000-0000-4000-c000-0000000000a1")), false],
  ["K14", "an importId in capitals", mutated((v) => (event(v, 1).importId = UUID("A1"))), false],
  ["K14", "an importId in braces", mutated((v) => (event(v, 1).importId = `{${UUID("a1")}}`)), false],
  ["K14", "an importId with Unicode hyphens", mutated((v) => (event(v, 1).importId = UUID("a1").replaceAll("-", "‐"))), false],
  ["K14", "an importId with a NUL", mutated((v) => (event(v, 1).importId = `${UUID("a1").slice(0, 35)}\u0000`)), false],
  ["K14", "a refId with full-width digits", mutated((v) => (origin(v).refId = UUID("a3").replace("4000", "４000"))), false],
  ["K16", "another transactionFormat", mutated((v) => ((v.captureContext as Json).transactionFormat = "edit-steps-v9")), false],
  ["K16", "another editorModel", mutated((v) => ((v.captureContext as Json).editorModel = "tiptap")), false],
];

describe("evidence segment v4: the parser, one row per input class (#1659 F1 to F15)", () => {
  it("starts from a valid segment", () => {
    expect(isEvidenceSegment(base())).toBe(true);
  });

  it.each(ROWS)("%s %s", (_klass, _name, value, accepted) => {
    expect(isEvidenceSegment(value)).toBe(accepted);
  });

  it("K9: takes 5000 events and refuses 5001", () => {
    const at = (count: number) => segment(V4, [IMPORT, ...Array.from({ length: count - 1 }, () => "editor")]);
    expect(isEvidenceSegment(at(5000))).toBe(true);
    expect(isEvidenceSegment(at(5001))).toBe(false);
  });

  it("K14: treats NFD, lone surrogates and control characters in ids as v3 does", () => {
    for (const id of ["Dokument-č", "Dokument-č", "dokument-\uD800", "dokument-\uDC00x", "dokument-\u0000", "dokument-\u0007"]) {
      const v3 = { ...segment(V3, ["editor"]), documentId: id };
      const v4 = { ...segment(V4, [IMPORT]), documentId: id };
      expect(isEvidenceSegment(v4), JSON.stringify(id)).toBe(isEvidenceSegment(v3));
    }
  });
});

describe("evidence segment v4: closed set (fast-check)", () => {
  const ALLOWED: Record<string, ReadonlySet<string>> = {
    segment: new Set(Object.keys(base())),
    event: new Set(["sequence", "source", "steps", "touchedNodeIds", "beforeDocumentHash", "afterDocumentHash"]),
    captureContext: new Set(["editorModel", "transactionFormat"]),
    pasteOrigin: new Set(["kind", "refId", "textSha256"]),
  };
  const levels: Record<string, (value: Json) => Json> = {
    segment: (value) => value,
    event: (value) => event(value, 0),
    captureContext: (value) => value.captureContext as Json,
    pasteOrigin: origin,
  };

  it("refuses any key outside the closed set at every level", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(levels)),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.jsonValue(),
        (level, key, json) => {
          fc.pre(!ALLOWED[level]!.has(key) && key !== "__proto__");
          const value = base();
          levels[level]!(value)[key] = json;
          return !isEvidenceSegment(value);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("refuses an import id that is not a canonical lower-case UUID v4", () => {
    fc.assert(
      fc.property(fc.uuid({ version: [1, 2, 3, 5, 6, 7, 8] }), (id) => {
        return !isEvidenceSegment(mutated((v) => (event(v, 1).importId = id)));
      }),
    );
    fc.assert(
      fc.property(fc.uuid({ version: 4 }), (id) => {
        expect(isEvidenceSegment(mutated((v) => (event(v, 1).importId = id)))).toBe(true);
        expect(isEvidenceSegment(mutated((v) => (event(v, 1).importId = id.toUpperCase())))).toBe(/^[0-9-]+$/.test(id));
      }),
    );
  });

  it("keeps JCS bytes and hash through parse and serialize", async () => {
    for (const vector of VECTORS.accepted) {
      const parsed = JSON.parse(vector.canonical) as unknown;
      expect(isEvidenceSegment(parsed), vector.name).toBe(true);
      const digest = await digestEvidenceSegment(parsed as EvidenceSegment);
      expect(digest.canonical).toBe(vector.canonical);
      expect(digest.sha256).toBe(vector.segmentHash);
    }
  });
});

describe("evidence segment v4: written only when an event needs it (A6)", () => {
  it("chooses v4 for every source combination with a v4 feature, else v3 or v2", () => {
    const sources = EVIDENCE_SOURCES_V4;
    for (const a of sources) {
      for (const b of sources) {
        const v4 = a === "import" || a === "ai-transfer" || b === "import" || b === "ai-transfer";
        const expected = v4 ? V4 : a === "citation-form" || b === "citation-form" ? V3 : V2;
        expect(evidenceSchemaForEvents([{ source: a }, { source: b }]), `${a},${b}`).toBe(expected);
        expect(evidenceSchemaForEvents([{ source: a }, { source: "paste", pasteOrigin: ORIGIN }]), a).toBe(V4);
      }
    }
    expect(evidenceSchemaForEvents([])).toBe(V2);
    expect(evidenceSchemaForEvents([{ source: "paste" }])).toBe(V2);
  });
});

describe("evidence segment v4: golden vectors (evidence-v4.json)", () => {
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

  it.each(VECTORS.rejected.map((vector) => [vector.name, vector] as const))("refuses %s", async (_name, vector) => {
    expect(isEvidenceSegment(vector.segment)).toBe(false);
    expect(await verifyCanonicalEvidencePayloadV2(new TextEncoder().encode(vector.canonical))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("evidence segment v4: only canonical bytes (K13)", () => {
  const canonical = VECTORS.accepted.find((vector) => vector.name === "v4-every-feature")!.canonical;
  const bytes = (text: string) => new TextEncoder().encode(text);

  it.each([
    ["whitespace", canonical.replace('"canonicalization":', '"canonicalization": ')],
    ["key order", canonical.replace('"canonicalization":"RFC8785-JCS","captureContext":', '"captureContext":').replace('"documentId":', '"canonicalization":"RFC8785-JCS","documentId":')],
    ["a \\u escape", canonical.replace('"import"', '"\\u0069mport"')],
    ["a duplicate key", canonical.replace('"importId":', '"importId":"x","importId":')],
    ["a duplicate pasteOrigin key", canonical.replace('"kind":', '"kind":"x","kind":')],
  ])("refuses %s", async (_name, text) => {
    expect(text).not.toBe(canonical);
    expect(await verifyCanonicalEvidencePayloadV2(bytes(text))).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses invalid UTF-8", async () => {
    const broken = bytes(canonical);
    broken[broken.indexOf(0x69)] = 0xff;
    expect(await verifyCanonicalEvidencePayloadV2(broken)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("evidence segment v4: a package chain (A7, K15)", () => {
  const SPECS: Record<string, Spec[]> = { [V2]: ["editor"], [V3]: ["editor", "citation-form"], [V4]: [IMPORT, PASTE_ORIGIN] };

  async function chain(schemas: string[]) {
    const payloads: string[] = [];
    let predecessor: string | null = null;
    let from = 1;
    for (const schema of schemas) {
      const value = segment(schema, SPECS[schema]!, from, predecessor);
      const digest = await digestEvidenceSegment(value as EvidenceSegment);
      payloads.push(digest.canonical);
      predecessor = digest.sha256;
      from += SPECS[schema]!.length;
    }
    return { payloads, head: { segmentHash: predecessor!, segmentCount: payloads.length } };
  }

  it("holds v2, v3 and v4 segments in any order", async () => {
    for (const order of [
      [V2, V3, V4],
      [V4, V3, V2],
      [V3, V4, V2, V4],
      [V4, V4],
    ]) {
      const { payloads, head } = await chain(order);
      expect(await verifyEvidenceChainV2(payloads, head), order.join(",")).toMatchObject({ ok: true });
    }
  });

  it("breaks when a v4 segment is changed inside the chain", async () => {
    const { payloads, head } = await chain([V2, V4, V3]);
    const changed = payloads[1]!.replace(H("1"), H("5"));
    expect(changed).not.toBe(payloads[1]);
    expect(await verifyEvidenceChainV2([payloads[0], changed, payloads[2]], head)).toMatchObject({ ok: false });
  });
});
