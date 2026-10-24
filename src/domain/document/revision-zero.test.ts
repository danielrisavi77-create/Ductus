import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalizeJcs, jcsUtf8Bytes } from "../forensics/jcs";
import {
  REVISION_ZERO_JCS,
  REVISION_ZERO_NODE_ID,
  REVISION_ZERO_SHA256,
  revisionZeroDocument,
} from "./revision-zero";
import { validateDocument } from "./validate";

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
