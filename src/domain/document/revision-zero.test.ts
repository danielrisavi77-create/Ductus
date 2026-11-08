import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalizeJcs, jcsUtf8Bytes } from "../forensics/jcs";
import {
  REVISION_ZERO_JCS,
  REVISION_ZERO_NODE_ID,
  REVISION_ZERO_SHA256,
  REVISION_ZERO_V2_JCS,
  REVISION_ZERO_V2_SHA256,
  revisionZeroDocument,
  revisionZeroDocumentV2,
} from "./revision-zero";
import { validateDocument, validateVersionedDocument } from "./validate";

// Known answer for revision 0 (docs/BACKEND.md 4.10 t. 3). The literals are
// written out here on purpose: a change to the document model that changes
// these bytes must fail this test, not move the expected value with it.
describe("revision 0", () => {
  it("is the editor's empty document: one empty paragraph with the fixed id", () => {
    expect(revisionZeroDocument()).toEqual({
      schemaVersion: 1,
      nodes: [{ type: "paragraph", id: "00000000-0000-4000-8000-000000000000", children: [] }],
    });
    expect(REVISION_ZERO_NODE_ID).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("is a valid canonical document that validation returns unchanged", () => {
    const outcome = validateDocument(revisionZeroDocument());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(canonicalizeJcs(outcome.doc)).toBe(REVISION_ZERO_JCS);
  });

  it("has these exact JCS bytes and this SHA-256", () => {
    const text =
      '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":1}';
    expect(canonicalizeJcs(revisionZeroDocument())).toBe(text);
    expect(REVISION_ZERO_JCS).toBe(text);
    const bytes = jcsUtf8Bytes(revisionZeroDocument());
    expect(bytes.byteLength).toBe(108);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b",
    );
    expect(REVISION_ZERO_SHA256).toBe(
      "a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b",
    );
  });

  it("returns a fresh object each time, so a caller cannot change it for others", () => {
    const first = revisionZeroDocument();
    first.nodes.push(first.nodes[0]);
    expect(canonicalizeJcs(revisionZeroDocument())).toBe(REVISION_ZERO_JCS);
  });
});

// v2 revision 0 (docs/contracts/document-schema-v2.md §6). The hex was
// computed outside this code (Python json + hashlib) and is compared as
// written, never recomputed into the expected value.
describe("revision 0 of document v2", () => {
  const text =
    '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-000000000000","type":"paragraph"}],"schemaVersion":2,"sources":[]}';
  const sha256 = "8f8aa5047daa07e8d68f4952aa70ab3c671eccdf6191bfaf6dcba591735f2618";

  it("is the v1 empty paragraph with schemaVersion 2 and no sources", () => {
    expect(revisionZeroDocumentV2()).toEqual({
      schemaVersion: 2,
      nodes: [{ type: "paragraph", id: "00000000-0000-4000-8000-000000000000", children: [] }],
      sources: [],
    });
  });

  it("has these exact JCS bytes and this SHA-256, and v1 keeps its own", () => {
    expect(canonicalizeJcs(revisionZeroDocumentV2())).toBe(text);
    expect(REVISION_ZERO_V2_JCS).toBe(text);
    const bytes = jcsUtf8Bytes(revisionZeroDocumentV2());
    expect(bytes.byteLength).toBe(121);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    expect(REVISION_ZERO_V2_SHA256).toBe(sha256);
    expect(REVISION_ZERO_V2_SHA256).not.toBe(REVISION_ZERO_SHA256);
    expect(REVISION_ZERO_SHA256).toBe("a102ced8a59b446a86c135c8d87d3ddf9f889e4ac93bcbc1857cd7c2c73ad14b");
  });

  it("is valid as v2 only: the versioned validator returns it unchanged, the v1 view refuses it", () => {
    const outcome = validateVersionedDocument(JSON.parse(REVISION_ZERO_V2_JCS));
    expect(outcome).toEqual({ ok: true, doc: revisionZeroDocumentV2() });
    if (outcome.ok) expect(canonicalizeJcs(outcome.doc)).toBe(REVISION_ZERO_V2_JCS);
    expect(validateDocument(JSON.parse(REVISION_ZERO_V2_JCS))).toEqual({
      ok: false,
      errors: [
        { path: "$.sources", code: "UNKNOWN_FIELD" },
        { path: "$.schemaVersion", code: "SCHEMA_VERSION_INVALID" },
      ],
    });
  });
});
