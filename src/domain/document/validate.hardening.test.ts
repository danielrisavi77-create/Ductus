import { describe, expect, it } from "vitest";

import { validateDocument } from "./validate";
import type { ValidationErrorCode } from "./validate";

// Ductus additions on top of the ported validate.test.ts (Codex review, PR #19).

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_UPPER = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

function codes(doc: unknown): ValidationErrorCode[] {
  const result = validateDocument(doc);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

function paragraph(id: string, children: unknown[] = []) {
  return { type: "paragraph", id, children };
}

describe("validateDocument — sparse arrays", () => {
  it("rejects holes in nodes instead of skipping them", () => {
    const nodes = [, paragraph(ID_A)];
    expect(codes({ schemaVersion: 1, nodes })).toContain("NODE_NOT_OBJECT");
  });

  it("rejects a nodes array that is only holes", () => {
    const result = validateDocument({ schemaVersion: 1, nodes: new Array(1) });
    expect(result.ok).toBe(false);
  });

  it("rejects holes in children", () => {
    const children = [, { type: "text", text: "a", marks: [] }];
    const result = validateDocument({ schemaVersion: 1, nodes: [paragraph(ID_A, children)] });
    expect(result.ok).toBe(false);
  });

  it("rejects holes in marks", () => {
    const marks = [, "bold"];
    const children = [{ type: "text", text: "a", marks }];
    expect(codes({ schemaVersion: 1, nodes: [paragraph(ID_A, children)] })).toContain(
      "MARK_INVALID",
    );
  });
});

describe("validateDocument — node id case", () => {
  it("treats the same UUID in different case as a duplicate", () => {
    const nodes = [paragraph(ID_UPPER), paragraph(ID_UPPER.toLowerCase())];
    expect(codes({ schemaVersion: 1, nodes })).toEqual(["NODE_ID_DUPLICATE"]);
  });

  it("keeps the id exactly as given when it is unique", () => {
    const result = validateDocument({ schemaVersion: 1, nodes: [paragraph(ID_UPPER)] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.nodes[0]?.id).toBe(ID_UPPER);
  });
});
