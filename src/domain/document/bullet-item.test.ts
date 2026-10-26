import { describe, expect, it } from "vitest";

import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { parseEditStep } from "./edit-step";
import { documentsEqual } from "./equality";
import { normalizeDocument } from "./normalize";
import { REVISION_ZERO_JCS, revisionZeroDocument } from "./revision-zero";
import { bulletItemNode, paragraphNode, textNode, type CanonicalDocument, type NodeId } from "./schema";
import { validateDocument } from "./validate";

/**
 * E1 part 1 (#823, DAN-326, contract issuecomment-6412639687): the bullet item
 * is a third text block of one level. The model only grows: what was valid is
 * valid with the same bytes, and nothing unknown gets through. Invented ids
 * and filler text only.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001" as NodeId;
const B = "aaaaaaaa-0000-4000-8000-000000000002" as NodeId;

const item = (id: string, text: string) => ({ type: "bulletItem", id, children: [{ type: "text", text, marks: [] }] });

describe("bullet item in the canonical document", () => {
  it("is accepted with exactly type, id and children, and keeps its type", () => {
    const input = { schemaVersion: 1, nodes: [item(A, "Prva stavka"), { type: "paragraph", id: B, children: [] }] };
    const result = validateDocument(structuredClone(input));
    expect(result).toEqual({ ok: true, doc: input });
    expect(canonicalizeJcs(input as unknown as JcsJsonValue)).toBe(
      '{"nodes":[{"children":[{"marks":[],"text":"Prva stavka","type":"text"}],"id":"aaaaaaaa-0000-4000-8000-000000000001","type":"bulletItem"}' +
        ',{"children":[],"id":"aaaaaaaa-0000-4000-8000-000000000002","type":"paragraph"}],"schemaVersion":1}',
    );
  });

  it("refuses a level, any other field and an unknown block type", () => {
    const withLevel = { schemaVersion: 1, nodes: [{ ...item(A, "x"), level: 1 }] };
    expect(validateDocument(withLevel)).toMatchObject({ ok: false, errors: [{ path: "$.nodes[0].level", code: "UNKNOWN_FIELD" }] });
    for (const type of ["listItem", "bulletList", "orderedList", "blockquote", "BulletItem"]) {
      expect(validateDocument({ schemaVersion: 1, nodes: [{ ...item(A, "x"), type }] }))
        .toMatchObject({ ok: false, errors: [{ code: "NODE_TYPE_INVALID" }] });
    }
  });

  it("normalising never turns an item into a paragraph", () => {
    const doc: CanonicalDocument = {
      schemaVersion: 1,
      nodes: [bulletItemNode(A, [textNode("Lorem "), textNode("ipsum"), textNode("")])],
    };
    expect(normalizeDocument(doc).nodes).toEqual([bulletItemNode(A, [textNode("Lorem ipsum")])]);
  });

  it("an item and a paragraph with the same text and id are different documents", () => {
    const asItem: CanonicalDocument = { schemaVersion: 1, nodes: [bulletItemNode(A, [textNode("x")])] };
    const asParagraph: CanonicalDocument = { schemaVersion: 1, nodes: [paragraphNode(A, [textNode("x")])] };
    expect(documentsEqual(asItem, asParagraph)).toBe(false);
    expect(documentsEqual(asItem, structuredClone(asItem))).toBe(true);
  });

  it("leaves revision 0 byte for byte as it was", () => {
    const result = validateDocument(JSON.parse(REVISION_ZERO_JCS));
    expect(result).toEqual({ ok: true, doc: revisionZeroDocument() });
    if (result.ok) expect(canonicalizeJcs(normalizeDocument(result.doc) as unknown as JcsJsonValue)).toBe(REVISION_ZERO_JCS);
  });
});

describe("bullet item in the edit step format", () => {
  const around = (attrs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    stepType: "replaceAround", from: 0, to: 7, gapFrom: 1, gapTo: 6, insert: 1, structure: true,
    slice: { content: [{ type: "bulletItem", attrs, ...extra }] },
  });

  it("accepts a change of type that keeps the id, written as ProseMirror writes it", () => {
    expect(parseEditStep(around({ nodeId: A }))).toEqual({ ok: true, step: around({ nodeId: A }) });
  });

  it("accepts a split that opens a new item without an id", () => {
    const split = {
      stepType: "replace", from: 7, to: 7, structure: true,
      slice: { content: [{ type: "bulletItem", attrs: { nodeId: A } }, { type: "bulletItem", attrs: { nodeId: null } }], openStart: 1, openEnd: 1 },
    };
    expect(parseEditStep(split)).toEqual({ ok: true, step: split });
  });

  it("refuses a level on an item, a missing id attribute and content in the wrapper", () => {
    expect(parseEditStep(around({ nodeId: A, level: 1 }))).toMatchObject({ ok: false, code: "unknown_field" });
    expect(parseEditStep(around({}))).toMatchObject({ ok: false, code: "missing_field" });
    expect(parseEditStep(around({ nodeId: A }, { content: [{ type: "text", text: "x" }] })))
      .toMatchObject({ ok: false, code: "invalid_slice" });
  });

  it("refuses a new item that brings an id with it", () => {
    const pasted = {
      stepType: "replace", from: 7, to: 7,
      slice: { content: [{ type: "bulletItem", attrs: { nodeId: B }, content: [{ type: "text", text: "x" }] }] },
    };
    expect(parseEditStep(pasted)).toMatchObject({ ok: false, code: "new_block_has_id" });
  });
});
