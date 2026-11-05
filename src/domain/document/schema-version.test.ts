import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "../forensics/jcs";
import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256, revisionZeroDocument } from "./revision-zero";
import {
  DOCUMENT_BLOCK_TYPES_BY_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION_V2,
  isAcceptedDocumentSchemaVersion,
} from "./schema";
import { verifyDocumentSnapshot } from "./snapshot";
import { validateDocument } from "./validate";

// DAN-453 PR 0 (contract on #1091, attack plan #1258 A5 and A6): the frame
// for document v2 exists with no new node, v1 stays the only version
// accepted, and the bytes of v1 documents do not move.

type DocumentVector = { name: string; value: unknown; utf8Hex: string; sha256: string };

function documentVectors(): DocumentVector[] {
  const bytes = readFileSync(new URL("../forensics/golden-vectors/format-reservation.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) throw new Error("vectors must be ASCII with LF");
  return (JSON.parse(bytes.toString("latin1")) as { documentsV1: DocumentVector[] }).documentsV1;
}

const VECTORS = documentVectors();
const vector = (name: string) => VECTORS.find((entry) => entry.name === name)!;
const V1 = vector("v1-every-block-type").value as { schemaVersion: number; nodes: Record<string, unknown>[] };
const codes = (doc: unknown) => {
  const outcome = validateDocument(doc);
  return outcome.ok ? [] : outcome.errors.map((error) => error.code);
};

describe("document schema versions", () => {
  it("A5: accepts version 1 only; version 2 is reserved, not accepted", () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(1);
    expect(DOCUMENT_SCHEMA_VERSION_V2).toBe(2);
    expect([...DOCUMENT_BLOCK_TYPES_BY_VERSION.keys()]).toEqual([1]);
    expect(isAcceptedDocumentSchemaVersion(1)).toBe(true);
    for (const value of [2, 3, 0, -1, 1.5, "1", "2", "2.0", null, undefined, true, [1], { v: 1 }]) {
      expect(isAcceptedDocumentSchemaVersion(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("A5: refuses a v2 document that is v1 in everything but the version, and never rewrites it", () => {
    for (const schemaVersion of [2, 3, 0, "2", "2.0", "1", null]) {
      const doc = { ...V1, schemaVersion };
      const before = JSON.stringify(doc);
      expect(codes(doc), String(schemaVersion)).toEqual(["SCHEMA_VERSION_INVALID"]);
      expect(JSON.stringify(doc)).toBe(before);
    }
    expect(codes({ nodes: V1.nodes })).toEqual(["SCHEMA_VERSION_INVALID"]);
  });

  it("A5: v2 brings no new node: an unknown type is refused under any version", () => {
    const video = { type: "video", id: "55555555-5555-4555-8555-555555555555", children: [] };
    expect(codes({ schemaVersion: 2, nodes: [...V1.nodes, video] })).toEqual([
      "SCHEMA_VERSION_INVALID",
      "NODE_TYPE_INVALID",
    ]);
    for (const type of ["table", "video", "text", "doc", "constructor", "__proto__", "toString"]) {
      expect(codes({ schemaVersion: 1, nodes: [{ ...video, type }] }), type).toEqual(["NODE_TYPE_INVALID"]);
    }
  });

  it("A5: a field of no version is refused, not dropped", () => {
    expect(codes({ ...V1, extra: true })).toEqual(["UNKNOWN_FIELD"]);
    expect(codes({ ...V1, nodes: [{ ...V1.nodes[0], variantId: "x" }, ...V1.nodes.slice(1)] })).toEqual([
      "UNKNOWN_FIELD",
    ]);
  });

  it("A5: the snapshot ingest refuses the JCS bytes of a v2 document", async () => {
    const bytes = new TextEncoder().encode(canonicalizeJcs({ ...V1, schemaVersion: 2 } as never));
    await expect(verifyDocumentSnapshot(bytes)).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it.each(VECTORS.map((entry) => [entry.name, entry] as const))(
    "A6: %s keeps its bytes and its hash through validation and the snapshot ingest",
    async (_name, entry) => {
      const bytes = Buffer.from(entry.utf8Hex, "hex");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect(bytes.toString("utf8")).toBe(canonicalizeJcs(entry.value as never));
      const outcome = validateDocument(entry.value);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(canonicalizeJcs(outcome.doc)).toBe(bytes.toString("utf8"));
      await expect(verifyDocumentSnapshot(new Uint8Array(bytes))).resolves.toMatchObject({
        ok: true,
        sha256: entry.sha256,
      });
    },
  );

  it("A6: revision 0 is the vector, byte for byte", () => {
    const zero = vector("revision-zero");
    expect(zero.value).toEqual(revisionZeroDocument());
    expect(Buffer.from(zero.utf8Hex, "hex").toString("utf8")).toBe(REVISION_ZERO_JCS);
    expect(zero.sha256).toBe(REVISION_ZERO_SHA256);
  });
});
