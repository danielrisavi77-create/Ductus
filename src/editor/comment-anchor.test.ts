import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createTextAnchor } from "@/domain/collaboration";
import type { NodeId } from "@/domain/document";

import { anchorRange, commentHighlightKey, commentHighlightPlugin, createAnchorPlacer } from "./comment-anchor";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";

const schema = getSchema(createEditorExtensions());
const A = "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId;
const B = "1f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId;

const para = (id: string, ...parts: (string | [string, "bold"])[]) => schema.node(
  "paragraph",
  { [NODE_ID_ATTRIBUTE]: id },
  parts.map((p) => (typeof p === "string" ? schema.text(p) : schema.text(p[0], [schema.marks.bold!.create()]))),
);
const docOf = (...blocks: ReturnType<typeof para>[]) => schema.node("doc", null, blocks);
const anchorIn = (nodeId: NodeId, nodeText: string, quote: string) =>
  createTextAnchor({ nodeId, nodeText, start: nodeText.indexOf(quote), end: nodeText.indexOf(quote) + quote.length });

const textAt = (doc: ReturnType<typeof docOf>, r: { from: number; to: number } | null) =>
  r ? doc.textBetween(r.from, r.to) : null;

describe("anchorRange", () => {
  it("places the quote in its own paragraph, across marks", () => {
    const text = "Gradske knjižnice su mjesto susreta.";
    const doc = docOf(para(B, "Drugi odlomak."), para(A, "Gradske ", ["knjižnice", "bold"], " su mjesto susreta."));
    expect(textAt(doc, anchorRange(doc, anchorIn(A, text, "knjižnice su")))).toBe("knjižnice su");
  });

  it("follows the quote when the student added text before it (moved)", () => {
    const anchor = anchorIn(A, "Uvod u temu.", "temu");
    const doc = docOf(para(A, "Kratki uvod u temu."));
    expect(textAt(doc, anchorRange(doc, anchor))).toBe("temu");
  });

  it("gives no place when the paragraph is gone, the quote is gone or it is ambiguous", () => {
    const anchor = anchorIn(A, "Jedna rečenica.", "rečenica");
    expect(anchorRange(docOf(para(B, "Jedna rečenica.")), anchor)).toBeNull();
    expect(anchorRange(docOf(para(A, "Sasvim drukčije.")), anchor)).toBeNull();
    const twice = { ...anchor, prefix: "", suffix: "", startHint: 40, endHint: 48 };
    expect(anchorRange(docOf(para(A, "rečenica i rečenica")), twice)).toBeNull();
  });
});

describe("createAnchorPlacer", () => {
  it("resolves again only when the document or the list changed (F-093)", () => {
    const anchor = anchorIn(A, "Uvod u temu.", "temu");
    let resolved = 0;
    const place = createAnchorPlacer((item: { anchor: typeof anchor | null }) => {
      resolved += 1;
      return item.anchor;
    });
    const items = [{ anchor }, { anchor: null }];
    const doc = docOf(para(A, "Kratki uvod u temu."));
    const first = place(doc, items);
    expect(first.map((r) => textAt(doc, r))).toEqual(["temu", null]);
    // A cursor move keeps the document object: nothing is resolved again.
    expect(place(doc, items)).toBe(first);
    expect(resolved).toBe(2);
    const edited = docOf(para(A, "Novi uvod u temu."));
    expect(place(edited, items).map((r) => textAt(edited, r))).toEqual(["temu", null]);
    expect(place(edited, [...items])).not.toBe(first);
    expect(resolved).toBe(6);
  });
});

describe("commentHighlightPlugin", () => {
  it("decorates the given ranges and leaves the document unchanged", () => {
    const doc = docOf(para(A, "Gradske knjižnice."));
    const state = EditorState.create({ doc, plugins: [commentHighlightPlugin()] });
    const next = state.apply(state.tr.setMeta(commentHighlightKey, [{ from: 9, to: 18 }]));
    expect(next.doc.eq(doc)).toBe(true);
    const found = commentHighlightKey.getState(next)!.find();
    expect(found.map((d) => [d.from, d.to])).toEqual([[9, 18]]);
  });
});
