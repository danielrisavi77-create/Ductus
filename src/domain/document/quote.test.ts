import { describe, expect, it } from "vitest";

import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { parseEditStep } from "./edit-step";
import { documentsEqual } from "./equality";
import { normalizeDocument } from "./normalize";
import { REVISION_ZERO_JCS, revisionZeroDocument } from "./revision-zero";
import { bulletItemNode, quoteNode, textNode, type CanonicalDocument, type NodeId } from "./schema";
import { validateDocument } from "./validate";

/**
 * E1 part 2 (#823, DAN-326, contract issuecomment-6412639687): the quote
 * paragraph is a fourth text block of one level. The model only grows: what
 * was valid is valid with the same bytes, and nothing unknown gets through.
 * Invented ids and filler text only.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001" as NodeId;
const B = "aaaaaaaa-0000-4000-8000-000000000002" as NodeId;

const quote = (id: string, text: string) => ({ type: "quote", id, children: [{ type: "text", text, marks: [] }] });

describe("quote paragraph in the canonical document", () => {
  it("is accepted with exactly type, id and children, and keeps its type", () => {
    const input = { schemaVersion: 1, nodes: [quote(A, "Navod"), quote(B, "Nastavak")] };
    expect(validateDocument(structuredClone(input))).toEqual({ ok: true, doc: input });
    expect(canonicalizeJcs(input as unknown as JcsJsonValue)).toBe(
      '{"nodes":[{"children":[{"marks":[],"text":"Navod","type":"text"}],"id":"aaaaaaaa-0000-4000-8000-000000000001","type":"quote"}' +
        ',{"children":[{"marks":[],"text":"Nastavak","type":"text"}],"id":"aaaaaaaa-0000-4000-8000-000000000002","type":"quote"}],"schemaVersion":1}',
    );
  });

  it("refuses a level, a source field and the wrapper names", () => {
    expect(validateDocument({ schemaVersion: 1, nodes: [{ ...quote(A, "x"), level: 1 }] }))
      .toMatchObject({ ok: false, errors: [{ path: "$.nodes[0].level", code: "UNKNOWN_FIELD" }] });
    expect(validateDocument({ schemaVersion: 1, nodes: [{ ...quote(A, "x"), source: "A" }] }))
      .toMatchObject({ ok: false, errors: [{ code: "UNKNOWN_FIELD" }] });
    for (const type of ["blockquote", "Quote", "citation"]) {
      expect(validateDocument({ schemaVersion: 1, nodes: [{ ...quote(A, "x"), type }] }))
        .toMatchObject({ ok: false, errors: [{ code: "NODE_TYPE_INVALID" }] });
    }
  });

  it("normalising keeps the type; a quote, an item and a paragraph are different documents", () => {
    const doc: CanonicalDocument = { schemaVersion: 1, nodes: [quoteNode(A, [textNode("Lorem "), textNode("ipsum")])] };
    expect(normalizeDocument(doc).nodes).toEqual([quoteNode(A, [textNode("Lorem ipsum")])]);
    const asItem: CanonicalDocument = { schemaVersion: 1, nodes: [bulletItemNode(A, [textNode("Lorem ipsum")])] };
    expect(documentsEqual(normalizeDocument(doc), asItem)).toBe(false);
  });

  it("leaves revision 0 byte for byte as it was", () => {
    const result = validateDocument(JSON.parse(REVISION_ZERO_JCS));
    expect(result).toEqual({ ok: true, doc: revisionZeroDocument() });
  });
});

describe("quote paragraph in the edit step format", () => {
  const around = (attrs: Record<string, unknown>) => ({
    stepType: "replaceAround", from: 0, to: 7, gapFrom: 1, gapTo: 6, insert: 1, structure: true,
    slice: { content: [{ type: "quote", attrs }] },
  });

  it("accepts a change of type that keeps the id, and refuses a level or a missing id", () => {
    expect(parseEditStep(around({ nodeId: A }))).toEqual({ ok: true, step: around({ nodeId: A }) });
    expect(parseEditStep(around({ nodeId: A, level: 1 }))).toMatchObject({ ok: false, code: "unknown_field" });
    expect(parseEditStep(around({}))).toMatchObject({ ok: false, code: "missing_field" });
  });

  it("refuses a pasted quote that brings an id with it", () => {
    const pasted = {
      stepType: "replace", from: 7, to: 7,
      slice: { content: [{ type: "quote", attrs: { nodeId: B }, content: [{ type: "text", text: "x" }] }] },
    };
    expect(parseEditStep(pasted)).toMatchObject({ ok: false, code: "new_block_has_id" });
  });
});
