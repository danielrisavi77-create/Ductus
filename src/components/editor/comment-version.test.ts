import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";

import { createTextAnchor, type TextAnchor } from "@/domain/collaboration";
import type { CanonicalDocument, NodeId } from "@/domain/document";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { createAnchorPlacer } from "@/editor/comment-anchor";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "@/editor/schema";

import { createVersionGate, readSubmittedTexts, submittedTextsOf } from "./comment-version";

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

const sha256 = async (text: string) => [...new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function reply(submitted: boolean): Promise<Response> {
  const body = canonicalizeJcs(stored(TEXT));
  return new Response(body, {
    status: 200,
    headers: { etag: `"${await sha256(body)}"`, ...(submitted ? { "ductus-live-state": "submitted" } : {}) },
  });
}

describe("readSubmittedTexts", () => {
  const schema = editorWith(TEXT).schema;

  it("reads the texts of the revision the route marks as submitted", async () => {
    const texts = await readSubmittedTexts("izmisljeni-rad", schema, () => true, vi.fn<typeof fetch>(async () => reply(true)));
    expect(texts?.get(ID.b)).toBe(TEXT.b);
  });

  it("negative: a state that is not the submitted revision is not a version", async () => {
    expect(await readSubmittedTexts("izmisljeni-rad", schema, () => true, vi.fn<typeof fetch>(async () => reply(false)))).toBeNull();
    expect(await readSubmittedTexts("izmisljeni-rad", schema, () => true, vi.fn<typeof fetch>(async () => new Response(null, { status: 503 })))).toBeNull();
  });

  it("Istodobnost negative: an answer that lands after the session ended is dropped", async () => {
    let live = true;
    const fetcher = vi.fn<typeof fetch>(async () => { live = false; return reply(true); });
    expect(await readSubmittedTexts("izmisljeni-rad", schema, () => live, fetcher)).toBeNull();
  });

  it("asks nothing once the session has ended", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => reply(true));
    expect(await readSubmittedTexts("izmisljeni-rad", schema, () => false, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
