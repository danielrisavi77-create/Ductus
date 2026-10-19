import { describe, expect, it } from "vitest";

import type { CanonicalDocument, NodeId } from "@/domain/document";

import { anchorForSelection, blockSegments, blockText, placeAnchor } from "./comment-place";

const P1 = "0f8e2a64-1b3c-4d5e-8f60-718293a4b5c6" as NodeId;
const P2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" as NodeId;

const doc = (first: string, second = "Druga izmišljena rečenica."): CanonicalDocument => ({
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: P1, children: [{ type: "text", text: first.slice(0, 8), marks: [] }, { type: "text", text: first.slice(8), marks: ["bold"] }] },
    { type: "paragraph", id: P2, children: [{ type: "text", text: second, marks: [] }] },
  ],
});

const TEXT = "Gradske knjižnice su mjesto susreta i učenja.";

describe("anchorForSelection", () => {
  it("anchors a selection across inline marks within one block", () => {
    const start = TEXT.indexOf("knjižnice");
    const anchor = anchorForSelection(doc(TEXT), P1, start, start + "knjižnice su".length)!;
    expect(anchor).toMatchObject({ nodeId: P1, quote: "knjižnice su", prefix: "Gradske ", startHint: 8, endHint: 20 });
    expect(blockText(doc(TEXT).nodes[0]!)).toBe(TEXT);
  });

  it("takes a backwards selection and leaves surrounding white space out", () => {
    const start = TEXT.indexOf(" mjesto");
    const end = start + " mjesto ".length;
    expect(anchorForSelection(doc(TEXT), P1, end, start)).toMatchObject({ quote: "mjesto", startHint: start + 1 });
  });

  it.each([
    ["an unknown block", P1.replace("0f", "ff"), 0, 4],
    ["an empty selection", P1, 3, 3],
    ["a blank selection", P1, 7, 8],
    ["a range past the text", P1, 0, TEXT.length + 1],
    ["a negative start", P1, -1, 4],
  ])("gives no anchor for %s", (_name, nodeId, start, end) => {
    expect(anchorForSelection(doc(TEXT), nodeId, start, end)).toBeNull();
  });

  it("gives no anchor for a quote longer than 500 code points", () => {
    const long = "a".repeat(501);
    expect(anchorForSelection(doc(long), P1, 0, 501)).toBeNull();
    expect(anchorForSelection(doc(long), P1, 0, 500)?.quote).toHaveLength(500);
  });
});

describe("placeAnchor", () => {
  const start = TEXT.indexOf("mjesto susreta");
  const anchor = anchorForSelection(doc(TEXT), P1, start, start + "mjesto susreta".length)!;

  it("places an anchor where its text still stands, and after it moved", () => {
    expect(placeAnchor(doc(TEXT), anchor)).toEqual({ nodeId: P1, start, end: start + 14 });
    const moved = `Uvodno. ${TEXT}`;
    expect(placeAnchor(doc(moved), anchor)).toEqual({ nodeId: P1, start: start + 8, end: start + 22 });
  });

  it("gives no place when the text is gone, repeated, or the block is gone", () => {
    expect(placeAnchor(doc("Gradske knjižnice su prostor."), anchor)).toBeNull();
    expect(placeAnchor(doc("mjesto susreta, mjesto susreta"), { ...anchor, prefix: "", suffix: "" })).toBeNull();
    const other: CanonicalDocument = { schemaVersion: 1, nodes: [doc(TEXT).nodes[1]!] };
    expect(placeAnchor(other, anchor)).toBeNull();
    expect(placeAnchor(null, anchor)).toBeNull();
    expect(placeAnchor(doc(TEXT), null)).toBeNull();
  });
});

describe("blockSegments", () => {
  const node = doc(TEXT).nodes[0]!;
  const join = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

  it("cuts the inline texts at the edges of the ranges and keeps every character", () => {
    const segments = blockSegments(node, [{ start: 4, end: 12 }]);
    expect(join(segments)).toBe(TEXT);
    expect(segments.map((s) => [s.text, s.marked, s.marks])).toEqual([
      ["Grad", false, []],
      ["ske ", true, []],
      ["knji", true, ["bold"]],
      [TEXT.slice(12), false, ["bold"]],
    ]);
  });

  it("keeps touching ranges apart and marks nothing without ranges", () => {
    const segments = blockSegments(node, [{ start: 0, end: 3 }, { start: 3, end: 5 }]);
    expect(segments.slice(0, 2).map((s) => [s.text, s.marked])).toEqual([["Gra", true], ["ds", true]]);
    expect(blockSegments(node, []).every((s) => !s.marked)).toBe(true);
    expect(join(blockSegments(node, []))).toBe(TEXT);
  });
});
