import { describe, expect, it } from "vitest";

import { VALIDATION_ERROR_CODES, validateDocument } from "./validate";
import type { ValidationErrorCode } from "./validate";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function codes(doc: unknown): ValidationErrorCode[] {
  const result = validateDocument(doc);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

const validDoc = {
  schemaVersion: 1,
  nodes: [
    { type: "heading", id: ID_A, level: 2, children: [] },
    {
      type: "paragraph",
      id: ID_B,
      children: [
        { type: "text", text: "Uvod ", marks: [] },
        { type: "text", text: "rada", marks: ["bold", "italic"] },
      ],
    },
  ],
};

describe("validateDocument — accepting", () => {
  it("accepts a well formed document and returns it typed", () => {
    const result = validateDocument(structuredClone(validDoc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toEqual(validDoc);
    expect(result.doc.nodes).toHaveLength(2);
  });

  it("returns a fresh copy, not the untrusted input", () => {
    const input = structuredClone(validDoc);
    const result = validateDocument(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).not.toBe(input);
    expect(result.doc.nodes[0]).not.toBe(input.nodes[0]);
  });

  it("accepts the minimal document: one empty paragraph", () => {
    expect(
      validateDocument({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: ID_A, children: [] }],
      }).ok,
    ).toBe(true);
  });

  it("allows adjacent text nodes with different marks", () => {
    expect(
      validateDocument({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [
              { type: "text", text: "a", marks: [] },
              { type: "text", text: "b", marks: ["bold"] },
            ],
          },
        ],
      }).ok,
    ).toBe(true);
  });
});

describe("validateDocument — error codes", () => {
  it("DOCUMENT_NOT_OBJECT", () => {
    expect(codes(null)).toEqual(["DOCUMENT_NOT_OBJECT"]);
    expect(codes([])).toEqual(["DOCUMENT_NOT_OBJECT"]);
    expect(codes("doc")).toEqual(["DOCUMENT_NOT_OBJECT"]);
  });

  it("SCHEMA_VERSION_INVALID", () => {
    expect(codes({ schemaVersion: 2, nodes: validDoc.nodes })).toContain(
      "SCHEMA_VERSION_INVALID",
    );
  });

  it("UNKNOWN_FIELD at document, node and inline level", () => {
    expect(codes({ ...validDoc, extra: 1 })).toContain("UNKNOWN_FIELD");
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: ID_A, children: [], attrs: {} }],
      }),
    ).toContain("UNKNOWN_FIELD");
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: "a", marks: [], color: "red" }],
          },
        ],
      }),
    ).toContain("UNKNOWN_FIELD");
  });

  it("rejects a paragraph carrying a heading level", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: ID_A, level: 1, children: [] }],
      }),
    ).toContain("UNKNOWN_FIELD");
  });

  it("NODES_NOT_ARRAY", () => {
    expect(codes({ schemaVersion: 1, nodes: {} })).toContain("NODES_NOT_ARRAY");
  });

  it("NODES_EMPTY", () => {
    expect(codes({ schemaVersion: 1, nodes: [] })).toContain("NODES_EMPTY");
  });

  it("NODE_NOT_OBJECT", () => {
    expect(codes({ schemaVersion: 1, nodes: ["paragraph"] })).toContain(
      "NODE_NOT_OBJECT",
    );
  });

  it("NODE_TYPE_INVALID", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "blockquote", id: ID_A, children: [] }],
      }),
    ).toContain("NODE_TYPE_INVALID");
  });

  it("NODE_ID_INVALID", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: "p1", children: [] }],
      }),
    ).toContain("NODE_ID_INVALID");
  });

  it("NODE_ID_DUPLICATE", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          { type: "paragraph", id: ID_A, children: [] },
          { type: "paragraph", id: ID_A, children: [] },
        ],
      }),
    ).toContain("NODE_ID_DUPLICATE");
  });

  it("HEADING_LEVEL_INVALID", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "heading", id: ID_A, level: 4, children: [] }],
      }),
    ).toContain("HEADING_LEVEL_INVALID");
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "heading", id: ID_A, level: 0, children: [] }],
      }),
    ).toContain("HEADING_LEVEL_INVALID");
  });

  it("CHILDREN_NOT_ARRAY", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: ID_A, children: "text" }],
      }),
    ).toContain("CHILDREN_NOT_ARRAY");
  });

  it("INLINE_NOT_OBJECT", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [{ type: "paragraph", id: ID_A, children: ["text"] }],
      }),
    ).toContain("INLINE_NOT_OBJECT");
  });

  it("INLINE_TYPE_INVALID", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          { type: "paragraph", id: ID_A, children: [{ type: "image" }] },
        ],
      }),
    ).toContain("INLINE_TYPE_INVALID");
  });

  it("TEXT_NOT_STRING", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: 7, marks: [] }],
          },
        ],
      }),
    ).toContain("TEXT_NOT_STRING");
  });

  it("TEXT_EMPTY", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: "", marks: [] }],
          },
        ],
      }),
    ).toContain("TEXT_EMPTY");
  });

  it("MARKS_NOT_ARRAY", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: "a", marks: "bold" }],
          },
        ],
      }),
    ).toContain("MARKS_NOT_ARRAY");
  });

  it("MARK_INVALID", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: "a", marks: ["underline"] }],
          },
        ],
      }),
    ).toContain("MARK_INVALID");
  });

  it("MARKS_DUPLICATE", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [{ type: "text", text: "a", marks: ["bold", "bold"] }],
          },
        ],
      }),
    ).toContain("MARKS_DUPLICATE");
  });

  it("MARKS_UNSORTED", () => {
    expect(
      codes({
        schemaVersion: 1,
        nodes: [
          {
            type: "paragraph",
            id: ID_A,
            children: [
              { type: "text", text: "a", marks: ["italic", "bold"] },
            ],
          },
        ],
      }),
    ).toContain("MARKS_UNSORTED");
  });

  it("ADJACENT_TEXT_SAME_MARKS is flagged, not auto-merged", () => {
    const result = validateDocument({
      schemaVersion: 1,
      nodes: [
        {
          type: "paragraph",
          id: ID_A,
          children: [
            { type: "text", text: "a", marks: ["bold"] },
            { type: "text", text: "b", marks: ["bold"] },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      path: "$.nodes[0].children[1]",
      code: "ADJACENT_TEXT_SAME_MARKS",
    });
  });
});

describe("validateDocument — reporting", () => {
  it("reports stable paths", () => {
    const result = validateDocument({
      schemaVersion: 1,
      nodes: [
        {
          type: "paragraph",
          id: ID_A,
          children: [{ type: "text", text: "", marks: ["underline"] }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      path: "$.nodes[0].children[0].text",
      code: "TEXT_EMPTY",
    });
    expect(result.errors).toContainEqual({
      path: "$.nodes[0].children[0].marks[0]",
      code: "MARK_INVALID",
    });
  });

  it("collects every error instead of failing fast", () => {
    const reported = codes({
      schemaVersion: 9,
      nodes: [{ type: "paragraph", id: "nope", children: [] }],
    });
    expect(reported).toContain("SCHEMA_VERSION_INVALID");
    expect(reported).toContain("NODE_ID_INVALID");
  });

  it("exposes a unique, frozen-in list of codes", () => {
    expect(new Set(VALIDATION_ERROR_CODES).size).toBe(
      VALIDATION_ERROR_CODES.length,
    );
  });
});
