import { Editor } from "@tiptap/core";
import type { Node as PmNode, Slice } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createTextAnchor, type TextAnchor } from "../domain/collaboration";
import { newNodeId, type CanonicalDocument, type NodeId } from "../domain/document";

import { anchorRange, commentHighlightKey, commentHighlightPlugin, createAnchorPlacer, type CommentRange } from "./comment-anchor";
import { startFreshHistory } from "./history";
import { replaceWithStoredDocument } from "./identity";
import { createEditorExtensions, NodeIdentity, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * Every class of input that can move or change the paragraph of a comment
 * (DAN-215, contract on #1091), one row each, through a real editor with
 * block identity. Synthetic texts and ids only.
 *
 * Invariant, after every row: the comment has no place, or its place is
 * exactly its quote inside the block holding its id. Never another place.
 */

const ID = { a: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa", b: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb", c: "cccccccc-0000-4000-8000-cccccccccccc" } as const;
type Letter = keyof typeof ID;
const TEXT: Record<Letter, string> = { a: "Alfa prvi odlomak rada.", b: "Beta drugi odlomak s citatom ovdje.", c: "Gama treći odlomak." };
const QUOTE: Record<Letter, string> = { a: "prvi", b: "citatom", c: "treći" };

function paragraph(id: string, text: string) {
  return { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: id }, content: text ? [{ type: "text", text }] : undefined };
}

function stored(texts: Partial<Record<Letter, string>>): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: (Object.keys(texts) as Letter[]).map((l) => ({ type: "paragraph", id: ID[l] as NodeId, children: [{ type: "text", text: texts[l]!, marks: [] }] })),
  } as CanonicalDocument;
}

class Harness {
  readonly editor: Editor;
  constructor() {
    const extensions = createEditorExtensions().map((e) => (e.name === "nodeIdentity" ? NodeIdentity.configure({ mint: newNodeId }) : e));
    this.editor = new Editor({
      element: null,
      extensions,
      content: { type: "doc", content: (Object.keys(ID) as Letter[]).map((l) => paragraph(ID[l], TEXT[l])) },
    });
    this.editor.view.updateState(this.editor.state.reconfigure({ plugins: this.editor.extensionManager.plugins }));
  }
  get doc(): PmNode { return this.editor.state.doc; }
  /** Position in front of block `i`. */
  posOf(i: number): number {
    let pos = 0;
    for (let k = 0; k < i; k += 1) pos += this.doc.child(k).nodeSize;
    return pos;
  }
  textPos(i: number, offset: number): number { return this.posOf(i) + 1 + offset; }
  asPasted(slice: Slice): Slice {
    let result = slice;
    for (const plugin of this.editor.state.plugins) {
      const transform = plugin.props.transformPasted;
      if (transform) result = transform.call(plugin, result, this.editor.view as never, false);
    }
    return result;
  }
  dispatch(tr: Parameters<Editor["view"]["dispatch"]>[0]) { this.editor.view.dispatch(tr); }
  replaceText(i: number, find: string, by: string) {
    const at = this.doc.child(i).textContent.indexOf(find);
    expect(at).toBeGreaterThanOrEqual(0);
    this.dispatch(this.editor.state.tr.insertText(by, this.textPos(i, at), this.textPos(i, at + find.length)));
  }
  split(i: number, offset: number) {
    this.editor.commands.setTextSelection(this.textPos(i, offset));
    this.editor.commands.splitBlock();
  }
}

function anchorOn(letter: Letter): TextAnchor {
  const start = TEXT[letter].indexOf(QUOTE[letter]);
  return createTextAnchor({ nodeId: ID[letter] as NodeId, nodeText: TEXT[letter], start, end: start + QUOTE[letter].length });
}

/** The block holding `pos`, or null. */
function blockIdAt(doc: PmNode, pos: number): unknown {
  const $pos = doc.resolve(pos);
  return $pos.parent.isTextblock ? $pos.parent.attrs[NODE_ID_ATTRIBUTE] : null;
}

/** The invariant: no place, or exactly the quote inside the block of the anchor's id. */
function expectNeverElsewhere(doc: PmNode, anchor: TextAnchor, range: CommentRange | null): void {
  if (range === null) return;
  expect(doc.textBetween(range.from, range.to)).toBe(anchor.quote);
  expect(blockIdAt(doc, range.from)).toBe(anchor.nodeId);
  expect(blockIdAt(doc, range.to)).toBe(anchor.nodeId);
}

type Row = { cls: string; name: string; on: Letter; act: (h: Harness) => void; placed: boolean };

const ROWS: Row[] = [
  { cls: "K1 unchanged", name: "nothing changed", on: "b", act: () => undefined, placed: true },
  { cls: "K1 unchanged", name: "another paragraph edited", on: "b", act: (h) => h.replaceText(0, "prvi", "uvodni"), placed: true },
  { cls: "K2 changed", name: "K2a only the context before the quote", on: "b", act: (h) => h.replaceText(1, "Beta drugi", "Nova rečenica. Beta drugi"), placed: true },
  { cls: "K2 changed", name: "K2a only the context after the quote", on: "b", act: (h) => h.replaceText(1, " ovdje.", " ovdje, i još malo."), placed: true },
  { cls: "K2 changed", name: "K2b the quote itself", on: "b", act: (h) => h.replaceText(1, "citatom", "navodom"), placed: false },
  { cls: "K2 changed", name: "K2c the quote twice, with no context left to tell them apart", on: "b", act: (h) => h.replaceText(1, TEXT.b, "citatom i citatom"), placed: false },
  { cls: "K2 changed", name: "K2d a second occurrence added; the first keeps its context", on: "b", act: (h) => h.replaceText(1, " ovdje.", " ovdje. Opet citatom."), placed: true },
  { cls: "K3 moved", name: "K3a dragged to the end (the id stays)", on: "b", act: (h) => { const node = h.doc.child(1); const tr = h.editor.state.tr.delete(h.posOf(1), h.posOf(2)); h.dispatch(tr.insert(tr.doc.content.size, node)); }, placed: true },
  { cls: "K3 moved", name: "K3b cut and pasted (a new id)", on: "b", act: (h) => { const cut = h.doc.slice(h.posOf(1), h.posOf(2)); h.dispatch(h.editor.state.tr.delete(h.posOf(1), h.posOf(2))); h.dispatch(h.editor.state.tr.replace(h.doc.content.size, h.doc.content.size, h.asPasted(cut))); }, placed: false },
  { cls: "K4 deleted", name: "the paragraph removed", on: "b", act: (h) => h.dispatch(h.editor.state.tr.delete(h.posOf(1), h.posOf(2))), placed: false },
  { cls: "K4 deleted", name: "all its text removed, the empty paragraph kept", on: "b", act: (h) => h.dispatch(h.editor.state.tr.delete(h.textPos(1, 0), h.textPos(1, TEXT.b.length))), placed: false },
  { cls: "K5 split", name: "K5a the quote in the first part (it keeps the id)", on: "b", act: (h) => h.split(1, TEXT.b.indexOf(" ovdje")), placed: true },
  { cls: "K5 split", name: "K5b the quote in the second part (a new id)", on: "b", act: (h) => h.split(1, 5), placed: false },
  { cls: "K5 split", name: "K5c split inside the quote", on: "b", act: (h) => h.split(1, TEXT.b.indexOf("citatom") + 3), placed: false },
  { cls: "K6 merged", name: "K6a the anchor on the paragraph that stays", on: "a", act: (h) => { h.editor.commands.setTextSelection(h.textPos(1, 0)); h.editor.commands.joinBackward(); }, placed: true },
  { cls: "K6 merged", name: "K6b the anchor on the paragraph taken in", on: "b", act: (h) => { h.editor.commands.setTextSelection(h.textPos(1, 0)); h.editor.commands.joinBackward(); }, placed: false },
  { cls: "K7 new version", name: "K7a the stored version loaded again, same id and text", on: "b", act: (h) => { startFreshHistory(h.editor.view, "keep"); expect(replaceWithStoredDocument(h.editor.view, stored(TEXT))).toEqual({ ok: true }); }, placed: true },
  { cls: "K7 new version", name: "K7b a stored version with the same id and the quote changed", on: "b", act: (h) => { startFreshHistory(h.editor.view, "keep"); expect(replaceWithStoredDocument(h.editor.view, stored({ ...TEXT, b: "Beta drugi odlomak bez navoda." }))).toEqual({ ok: true }); }, placed: false },
  { cls: "K7 new version", name: "K7b a stored version without the paragraph", on: "b", act: (h) => { startFreshHistory(h.editor.view, "keep"); expect(replaceWithStoredDocument(h.editor.view, stored({ a: TEXT.a, c: TEXT.c }))).toEqual({ ok: true }); }, placed: false },
];

describe("comment anchor after an edit, by class of input", () => {
  it.each(ROWS.map((row) => [`${row.cls}: ${row.name}`, row] as const))("%s", (_name, row) => {
    const h = new Harness();
    const anchor = anchorOn(row.on);
    expect(anchorRange(h.doc, anchor)).not.toBeNull();
    row.act(h);
    const range = anchorRange(h.doc, anchor);
    expectNeverElsewhere(h.doc, anchor, range);
    expect(range !== null, "placed").toBe(row.placed);
    // Every other comment keeps the same invariant in the same document.
    for (const other of (Object.keys(ID) as Letter[]).map(anchorOn)) expectNeverElsewhere(h.doc, other, anchorRange(h.doc, other));
  });
});

/**
 * Istodobnost: the list of comments arrives while the student edits the same
 * paragraph. The place is computed for the document as it is when asked, so a
 * list read before an edit never leaves a mark at the positions of before.
 */
describe("comment anchor: a list arriving while the paragraph is edited", () => {
  const marks = (h: Harness) => commentHighlightKey.getState(h.editor.state)?.find() ?? [];

  function withHighlight() {
    const h = new Harness();
    h.editor.registerPlugin(commentHighlightPlugin());
    return h;
  }

  it("negative: the quote removed between the read and the next place gives no place and no mark", () => {
    const h = withHighlight();
    const items = [anchorOn("b")];
    const place = createAnchorPlacer((a: TextAnchor) => a);
    const before = place(h.doc, items);
    expect(before[0]).not.toBeNull();

    // The student deletes the quote; the list (read before) lands after it.
    h.replaceText(1, "citatom", "");
    const after = place(h.doc, items);
    expect(after[0]).toBeNull();
    h.dispatch(h.editor.state.tr.setMeta(commentHighlightKey, after.filter((r): r is CommentRange => r !== null)));
    expect(marks(h)).toEqual([]);
  });

  it("negative: the places of the document before are never returned for the document after", () => {
    const h = withHighlight();
    const items = [anchorOn("b")];
    const place = createAnchorPlacer((a: TextAnchor) => a);
    const before = place(h.doc, items);
    h.replaceText(1, "Beta drugi", "Sasvim nov početak, Beta drugi");
    const after = place(h.doc, items);
    expect(after).not.toBe(before);
    expect(after[0]).not.toEqual(before[0]);
    expectNeverElsewhere(h.doc, items[0], after[0]);
  });

  it("a mark already drawn follows the text typed before it, and is not left on other text", () => {
    const h = withHighlight();
    const range = anchorRange(h.doc, anchorOn("b"))!;
    h.dispatch(h.editor.state.tr.setMeta(commentHighlightKey, [range]));
    h.dispatch(h.editor.state.tr.insertText("Umetnuto. ", h.textPos(1, 0)));
    const [mark] = marks(h);
    expect(h.doc.textBetween(mark.from, mark.to)).toBe("citatom");
  });
});
