import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createTextAnchor, type TextAnchor } from "@/domain/collaboration";
import type { CanonicalDocument, NodeId } from "@/domain/document";
import { createAnchorPlacer } from "@/editor/comment-anchor";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "@/editor/schema";

import { createVersionGate, placementVersion, submittedTextsOf } from "./comment-version";

/**
 * K7c and K7d of the contract on #1091 (DAN-215): after the submission a
 * comment is placed only on a paragraph that reads as in the submitted
 * revision. Synthetic texts and ids only.
 */

const ID = { a: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa", b: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb" } as const;
const TEXT = { a: "Alfa prvi odlomak rada.", b: "Beta drugi odlomak s citatom ovdje." } as const;
const QUOTE = { a: "prvi", b: "citatom" } as const;
type Letter = keyof typeof ID;

const stored = (texts: Record<Letter, string>): CanonicalDocument => ({
  schemaVersion: 1,
  nodes: (Object.keys(texts) as Letter[]).map((l) => ({ type: "paragraph", id: ID[l] as NodeId, children: [{ type: "text", text: texts[l], marks: [] }] })),
}) as CanonicalDocument;

function editorWith(texts: Record<Letter, string>): Editor {
  return new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: {
      type: "doc",
      content: (Object.keys(texts) as Letter[]).map((l) => ({ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID[l] }, content: [{ type: "text", text: texts[l] }] })),
    },
  });
}

const anchorOn = (l: Letter): TextAnchor => {
  const start = TEXT[l].indexOf(QUOTE[l]);
  return createTextAnchor({ nodeId: ID[l] as NodeId, nodeText: TEXT[l], start, end: start + QUOTE[l].length });
};
const ANCHORS = [anchorOn("a"), anchorOn("b")];

/** The editor after the submission, holding a local change to paragraph b that never reached the server. */
const LOCAL = { ...TEXT, b: "Lokalno dopisano. Beta drugi odlomak s citatom ovdje." };

function placeAll(editor: Editor, version: Parameters<ReturnType<typeof createVersionGate>>[1]) {
  const ranges = createAnchorPlacer((a: TextAnchor) => a)(editor.state.doc, ANCHORS);
  return { ranges, gated: createVersionGate()(editor.state.doc, version, ranges) };
}

describe("a comment on the submitted version stays with that version", () => {
  it("K7c: a paragraph that reads as submitted keeps its place", () => {
    const editor = editorWith(TEXT);
    const { ranges, gated } = placeAll(editor, submittedTextsOf(editor.schema, stored(TEXT)));
    expect(gated).toEqual(ranges);
    expect(gated.every((r) => r !== null)).toBe(true);
  });

  it("K7c negative: a paragraph changed after the submission gives no place, though the quote is still found in it", () => {
    const editor = editorWith(LOCAL);
    const { ranges, gated } = placeAll(editor, submittedTextsOf(editor.schema, stored(TEXT)));
    // Without the gate the comment of b would be drawn on text the teacher never read.
    expect(ranges[1]).not.toBeNull();
    expect(gated[1]).toBeNull();
    // The unchanged paragraph a keeps its place.
    expect(gated[0]).toEqual(ranges[0]);
  });

  it("K7c negative: a paragraph that is not in the submitted revision gives no place", () => {
    const editor = editorWith(TEXT);
    const version = submittedTextsOf(editor.schema, { schemaVersion: 1, nodes: stored(TEXT).nodes.slice(0, 1) } as CanonicalDocument);
    expect(placeAll(editor, version).gated[1]).toBeNull();
  });

  it("K7d: while the submitted revision is not known nothing is placed", () => {
    const editor = editorWith(TEXT);
    expect(placeAll(editor, null).gated).toEqual([null, null]);
  });

  it("before the submission the places are those of the editor, the same array", () => {
    const editor = editorWith(LOCAL);
    const { ranges, gated } = placeAll(editor, "draft");
    expect(gated).toBe(ranges);
  });

  it("returns the same array for the same document, version and places", () => {
    const editor = editorWith(TEXT);
    const version = submittedTextsOf(editor.schema, stored(TEXT));
    const ranges = createAnchorPlacer((a: TextAnchor) => a)(editor.state.doc, ANCHORS);
    const gate = createVersionGate();
    expect(gate(editor.state.doc, version, ranges)).toBe(gate(editor.state.doc, version, ranges));
  });
});

describe("the version in the editor (O2, DAN-289)", () => {
  it("before the submission the draft, after it none: nothing is placed and the comments stay in the list", () => {
    expect(placementVersion(false)).toBe("draft");
    expect(placementVersion(true)).toBeNull();
    const editor = editorWith(TEXT);
    expect(placeAll(editor, placementVersion(true)).gated).toEqual([null, null]);
    editor.destroy();
  });

  it("negative: neither the panel nor the version reads the live channel, so a submitted work asks nothing of it", () => {
    for (const file of ["comment-version.ts", "CommentPanel.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src/components/editor", file), "utf8");
      expect(source).not.toMatch(/live-reader|readLiveState|\/api\/live/);
    }
  });
});
