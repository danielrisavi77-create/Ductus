import { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PmNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createTextAnchor, resolveTextAnchor, type TextAnchor } from "../domain/collaboration";
import { newNodeId, type CanonicalDocument, type NodeId } from "../domain/document";

import { startFreshHistory } from "./history";
import { mintMissingIds, replaceWithStoredDocument } from "./identity";
import { canonicalToTiptap, tiptapToCanonical } from "./interop";
import { createEditorExtensions, NodeIdentity, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * Every class of input that can move a block's id, one row each, against one
 * invariant. Synthetic texts and ids only.
 *
 * Invariant, after every row:
 *   1. every block has a valid id and the document has a canonical form;
 *   2. no id is held twice, in any letter case;
 *   3. an id stays with the block whose first surviving text holds it (on a
 *      join the earlier text wins);
 *   4. an id never goes to a block that is not the same block: a new block, a
 *      copy and anything from the clipboard get an id the editor minted, never
 *      one seen in the row before;
 *   5. a comment anchor resolves on at most one block, the one holding its id,
 *      and still resolves there while the block keeps its quoted text.
 */

const LETTERS = ["a", "b", "c", "d", "e"] as const;
type Letter = (typeof LETTERS)[number];
const ID = Object.fromEntries(LETTERS.map((l) => [l, `${l.repeat(8)}-0000-4000-8000-${l.repeat(12)}`])) as Record<Letter, NodeId>;
/** An id from another document; never one this editor holds. */
const OUTSIDE = "ffffffff-0000-4000-8000-ffffffffffff";

type Expected = Letter | "new";

/** `"H:..."` is a heading, anything else a paragraph; block i holds `ID[LETTERS[i]]`. */
function blockJSON(spec: string, id: unknown) {
  const heading = spec.startsWith("H:");
  const text = heading ? spec.slice(2) : spec;
  return {
    type: heading ? "heading" : "paragraph",
    attrs: heading ? { level: 2, [NODE_ID_ATTRIBUTE]: id } : { [NODE_ID_ATTRIBUTE]: id },
    ...(text === "" ? {} : { content: [{ type: "text", text }] }),
  };
}

class Harness {
  readonly minted = new Set<string>();
  readonly editor: Editor;

  constructor(specs: readonly string[], idsOf: (i: number) => unknown = (i) => ID[LETTERS[i]]) {
    const mint = () => {
      const id = newNodeId();
      this.minted.add(id);
      return id;
    };
    const extensions = createEditorExtensions().map((extension) =>
      extension.name === "nodeIdentity" ? NodeIdentity.configure({ mint }) : extension,
    );
    this.editor = new Editor({
      element: null,
      extensions,
      content: { type: "doc", content: specs.map((spec, i) => blockJSON(spec, idsOf(i))) },
    });
    this.editor.view.updateState(this.editor.state.reconfigure({ plugins: this.editor.extensionManager.plugins }));
    // What the mounted editor runs once (`onCreate`): repeated and missing ids.
    const fix = mintMissingIds(this.editor.state, mint);
    if (fix) this.editor.view.dispatch(fix);
  }

  get view() {
    return this.editor.view;
  }

  get doc() {
    return this.editor.state.doc;
  }

  /** Position in front of block `i`. */
  posOf(i: number): number {
    let pos = 0;
    for (let k = 0; k < i; k += 1) pos += this.doc.child(k).nodeSize;
    return pos;
  }

  /** Position of `offset` characters into the text of block `i`. */
  textPos(i: number, offset: number): number {
    return this.posOf(i) + 1 + offset;
  }

  /** What the editor does to a pasted or dropped slice (`transformPasted`). */
  asPasted(slice: Slice): Slice {
    let result = slice;
    for (const plugin of this.editor.state.plugins) {
      const transform = plugin.props.transformPasted;
      if (transform) result = transform.call(plugin, result, this.view as never, false);
    }
    return result;
  }

  /** A block as it would arrive from another document, with the id it had there. */
  foreign(text: string, id: unknown): PmNode {
    const { schema } = this.editor;
    return schema.nodes.paragraph.create({ [NODE_ID_ATTRIBUTE]: id }, schema.text(text));
  }

  canonical(): CanonicalDocument {
    const result = tiptapToCanonical(this.editor.getJSON());
    if (!result.ok) throw new Error(`no canonical form: ${JSON.stringify(result.errors)}`);
    return result.doc;
  }

  blocks(): { id: string; text: string }[] {
    return this.canonical().nodes.map((node) => ({ id: node.id, text: node.children.map((c) => c.text).join("") }));
  }
}

function anchorsOf(h: Harness): TextAnchor[] {
  return h.blocks()
    .filter((block) => block.text.length >= 4)
    .map((block) => createTextAnchor({ nodeId: block.id as NodeId, nodeText: block.text, start: 0, end: 4 }));
}

/** Invariant 1–5 for the editor as it is now; `seen` are all ids the row met before. */
function expectInvariant(h: Harness, texts: readonly string[], expected: readonly Expected[], seen: ReadonlySet<string>, anchors: readonly TextAnchor[]): void {
  const blocks = h.blocks();
  expect(blocks.map((b) => b.text)).toEqual(texts);
  expect(new Set(blocks.map((b) => b.id.toLowerCase())).size).toBe(blocks.length);
  blocks.forEach((block, i) => {
    const want = expected[i];
    if (want === "new") {
      expect(h.minted.has(block.id), `block ${i} has an id the editor did not mint`).toBe(true);
      expect(seen.has(block.id.toLowerCase()), `block ${i} got an id seen before`).toBe(false);
    } else {
      expect(block.id, `block ${i}`).toBe(ID[want]);
    }
  });
  // Two conversions in a row agree: the id is settled in the editor.
  expect(h.blocks().map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  for (const anchor of anchors) {
    const holders = blocks.filter((block) => resolveTextAnchor(anchor, block.id as NodeId, block.text).status !== "missing");
    expect(holders.length).toBeLessThanOrEqual(1);
    const owner = blocks.find((block) => block.id === anchor.nodeId);
    if (owner?.text.includes(anchor.quote)) expect(holders).toEqual([owner]);
    else expect(holders).toEqual([]);
  }
}

type Row = {
  name: string;
  start: readonly string[];
  act: (h: Harness, seen: Set<string>) => void;
  texts: readonly string[];
  ids: readonly Expected[];
};

const ABC = ["Alfa prvi.", "Beta drugi.", "Gama treći."];

const ROWS: Record<string, Row[]> = {
  split: [
    { name: "Enter in the middle", start: ABC, act: (h) => { h.editor.commands.setTextSelection(h.textPos(0, 5)); h.editor.commands.splitBlock(); }, texts: ["Alfa ", "prvi.", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
    { name: "Enter at the start: the text keeps its id", start: ABC, act: (h) => { h.editor.commands.setTextSelection(h.textPos(1, 0)); h.editor.commands.splitBlock(); }, texts: [ABC[0], "", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
    { name: "Enter at the end", start: ABC, act: (h) => { h.editor.commands.setTextSelection(h.textPos(0, ABC[0].length)); h.editor.commands.splitBlock(); }, texts: [ABC[0], "", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
    { name: "Enter on an empty block", start: ["Alfa prvi.", "", "Gama treći."], act: (h) => { h.editor.commands.setTextSelection(h.textPos(1, 0)); h.editor.commands.splitBlock(); }, texts: ["Alfa prvi.", "", "", "Gama treći."], ids: ["a", "b", "new", "c"] },
    { name: "a split that copies every attribute", start: ABC, act: (h) => h.view.dispatch(h.editor.state.tr.split(h.textPos(1, 5))), texts: [ABC[0], "Beta ", "drugi.", ABC[2]], ids: ["a", "b", "new", "c"] },
    { name: "Enter in a heading", start: ["H:Uvod u rad", "Alfa prvi."], act: (h) => { h.editor.commands.setTextSelection(h.textPos(0, 5)); h.editor.commands.splitBlock(); }, texts: ["Uvod ", "u rad", "Alfa prvi."], ids: ["a", "new", "b"] },
  ],
  join: [
    { name: "Backspace at the start of a block", start: ABC, act: (h) => { h.editor.commands.setTextSelection(h.textPos(1, 0)); h.editor.commands.joinBackward(); }, texts: [ABC[0] + ABC[1], ABC[2]], ids: ["a", "c"] },
    { name: "Delete at the end of a block", start: ABC, act: (h) => { h.editor.commands.setTextSelection(h.textPos(0, ABC[0].length)); h.editor.commands.joinForward(); }, texts: [ABC[0] + ABC[1], ABC[2]], ids: ["a", "c"] },
    { name: "Backspace into an empty block: the text keeps its id", start: ["Alfa prvi.", "", "Gama treći."], act: (h) => { h.editor.commands.setTextSelection(h.textPos(2, 0)); h.editor.commands.joinBackward(); }, texts: ["Alfa prvi.", "Gama treći."], ids: ["a", "c"] },
    { name: "a join undone gives the joined block its id back", start: ABC, act: (h) => { h.view.dispatch(h.editor.state.tr.join(h.posOf(1))); h.editor.commands.undo(); }, texts: ABC, ids: ["a", "b", "c"] },
  ],
  "paste inside": [
    { name: "a copy of a whole block is a new block", start: ABC, act: (h) => { const copy = h.asPasted(h.doc.slice(h.posOf(1), h.posOf(2))); h.view.dispatch(h.editor.state.tr.replace(h.doc.content.size, h.doc.content.size, copy)); }, texts: [...ABC, ABC[1]], ids: ["a", "b", "c", "new"] },
    { name: "a block cut and pasted back is a new block", start: ABC, act: (h) => { const cut = h.doc.slice(h.posOf(1), h.posOf(2)); h.view.dispatch(h.editor.state.tr.delete(h.posOf(1), h.posOf(2))); h.view.dispatch(h.editor.state.tr.replace(h.doc.content.size, h.doc.content.size, h.asPasted(cut))); }, texts: [ABC[0], ABC[2], ABC[1]], ids: ["a", "c", "new"] },
    { name: "two blocks pasted into the text of a block", start: ABC, act: (h) => { const two = h.asPasted(new Slice(h.doc.slice(h.posOf(1), h.posOf(3)).content, 1, 1)); h.view.dispatch(h.editor.state.tr.replace(h.textPos(0, 4), h.textPos(0, 4), two)); }, texts: ["Alfa" + ABC[1], ABC[2] + " prvi.", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
    { name: "text from one block pasted into another", start: ABC, act: (h) => { const part = h.asPasted(h.doc.slice(h.textPos(1, 0), h.textPos(1, 5))); h.view.dispatch(h.editor.state.tr.replace(h.textPos(2, 0), h.textPos(2, 0), part)); }, texts: [ABC[0], ABC[1], "Beta " + ABC[2]], ids: ["a", "b", "c"] },
  ],
  "paste from outside": [
    ...([
      ["an id from another document", () => OUTSIDE],
      ["an id in use here", () => ID.a],
      ["an id in use here, in upper case", () => ID.a.toUpperCase()],
      ["a malformed id", () => "not-a-uuid"],
    ] as const).flatMap(([what, carried]): Row[] => [
      { name: `through the clipboard, carrying ${what}`, start: ABC, act: (h, seen) => { seen.add(OUTSIDE); const slice = h.asPasted(new Slice(Fragment.from(h.foreign("Delta vani.", carried())), 0, 0)); h.view.dispatch(h.editor.state.tr.replace(h.posOf(1), h.posOf(1), slice)); }, texts: [ABC[0], "Delta vani.", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
      { name: `by a script, past the clipboard, carrying ${what}`, start: ABC, act: (h, seen) => { seen.add(OUTSIDE); h.view.dispatch(h.editor.state.tr.insert(h.posOf(1), h.foreign("Delta vani.", carried()))); }, texts: [ABC[0], "Delta vani.", ABC[1], ABC[2]], ids: ["a", "new", "b", "c"] },
    ]),
    { name: "through the clipboard, the id and text of a block removed earlier", start: ABC, act: (h) => { h.view.dispatch(h.editor.state.tr.delete(h.posOf(1), h.posOf(2))); const slice = h.asPasted(new Slice(Fragment.from(h.foreign(ABC[1], ID.b)), 0, 0)); h.view.dispatch(h.editor.state.tr.replace(h.posOf(1), h.posOf(1), slice)); }, texts: ABC, ids: ["a", "new", "c"] },
    { name: "an earlier draft restored by the author, which carries the ids of now", start: ABC, act: (h) => { const draft = h.editor.schema.nodeFromJSON(canonicalToTiptap(h.canonical())); h.view.dispatch(h.editor.state.tr.replace(h.doc.content.size, h.doc.content.size, h.asPasted(new Slice(draft.content, 0, 0)))); }, texts: [...ABC, ...ABC], ids: ["a", "b", "c", "new", "new", "new"] },
  ],
  reorder: [
    { name: "one block dragged to the end", start: ABC, act: (h) => { const node = h.doc.child(1); const tr = h.editor.state.tr.delete(h.posOf(1), h.posOf(2)); h.view.dispatch(tr.insert(tr.doc.content.size, node)); }, texts: [ABC[0], ABC[2], ABC[1]], ids: ["a", "c", "b"] },
    { name: "two blocks swapped in one step", start: ABC, act: (h) => h.view.dispatch(h.editor.state.tr.replaceWith(0, h.posOf(2), [h.doc.child(1), h.doc.child(0)])), texts: [ABC[1], ABC[0], ABC[2]], ids: ["b", "a", "c"] },
    { name: "a chapter (heading and its text) moved to the front", start: ["H:Uvod", "Alfa prvi.", "H:Metode", "Beta drugi."], act: (h) => { const section = h.doc.slice(h.posOf(2), h.doc.content.size); const tr = h.editor.state.tr.delete(h.posOf(2), h.doc.content.size); h.view.dispatch(tr.replace(0, 0, section)); }, texts: ["Metode", "Beta drugi.", "Uvod", "Alfa prvi."], ids: ["c", "d", "a", "b"] },
    { name: "a section with empty blocks moved to the end", start: ["H:Uvod", "", "Alfa prvi.", ""], act: (h) => { const section = h.doc.slice(0, h.posOf(3)); const tr = h.editor.state.tr.delete(0, h.posOf(3)); h.view.dispatch(tr.insert(tr.doc.content.size, section.content)); }, texts: ["", "Uvod", "", "Alfa prvi."], ids: ["d", "a", "b", "c"] },
    { name: "identical blocks moved together are new blocks, never another's", start: ["Isto.", "Isto.", "Gama treći."], act: (h) => { const both = [h.doc.child(0), h.doc.child(1)]; const tr = h.editor.state.tr.delete(0, h.posOf(2)); h.view.dispatch(tr.insert(tr.doc.content.size, both)); }, texts: ["Gama treći.", "Isto.", "Isto."], ids: ["c", "new", "new"] },
  ],
  reload: [
    { name: "a stored document loaded into a fresh history", start: ["Stari sadržaj."], act: (h) => { startFreshHistory(h.view, "keep"); expect(replaceWithStoredDocument(h.view, stored(ABC))).toEqual({ ok: true }); }, texts: ABC, ids: ["a", "b", "c"] },
    { name: "the same document loaded twice", start: ABC, act: (h) => { const doc = h.canonical(); startFreshHistory(h.view, "keep"); replaceWithStoredDocument(h.view, doc); replaceWithStoredDocument(h.view, doc); }, texts: ABC, ids: ["a", "b", "c"] },
    { name: "undo does not reach past a load", start: ABC, act: (h) => { h.view.dispatch(h.editor.state.tr.insertText("x", h.textPos(0, 0))); startFreshHistory(h.view, "keep"); replaceWithStoredDocument(h.view, stored(ABC)); h.editor.commands.undo(); }, texts: ABC, ids: ["a", "b", "c"] },
    { name: "a block removed before the load does not come back with its id", start: ABC, act: (h) => { const removed = h.doc.child(1); h.view.dispatch(h.editor.state.tr.delete(h.posOf(1), h.posOf(2))); startFreshHistory(h.view, "keep"); replaceWithStoredDocument(h.view, stored([ABC[0], ABC[2]], ["a", "c"])); h.view.dispatch(h.editor.state.tr.insert(h.posOf(1), removed)); }, texts: ABC, ids: ["a", "new", "c"] },
  ],
  "old work": [
    { name: "initial content without ids gets new ones once", start: ["Alfa prvi.", "Beta drugi."], act: () => undefined, texts: ["Alfa prvi.", "Beta drugi."], ids: ["new", "new"] },
    { name: "initial content with an id twice: the earlier block keeps it", start: ABC, act: () => undefined, texts: ABC, ids: ["a", "new", "c"] },
    { name: "initial content with an id twice in another case", start: ABC, act: () => undefined, texts: ABC, ids: ["a", "new", "c"] },
  ],
};

/** A stored document of paragraphs; block i holds `ID[letters[i]]`. */
function stored(texts: readonly string[], letters: readonly Letter[] = LETTERS): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: texts.map((text, i) => ({ type: "paragraph", id: ID[letters[i]], children: text ? [{ type: "text", text, marks: [] }] : [] })),
  } as CanonicalDocument;
}

/** The ids the old-work rows start with; every other row starts with a, b, c, … */
const START_IDS: Record<string, (i: number) => unknown> = {
  "initial content without ids gets new ones once": () => null,
  "initial content with an id twice: the earlier block keeps it": (i) => (i === 1 ? ID.a : ID[LETTERS[i]]),
  "initial content with an id twice in another case": (i) => (i === 1 ? ID.a.toUpperCase() : ID[LETTERS[i]]),
};

describe.each(Object.entries(ROWS))("block identity: %s", (_cls, rows) => {
  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const h = new Harness(row.start, START_IDS[row.name]);
    const seen = new Set<string>([...LETTERS.map((l) => ID[l]), OUTSIDE]);
    const anchors = anchorsOf(h);
    row.act(h, seen);
    expectInvariant(h, row.texts, row.ids, seen, anchors);
  });
});

describe("block identity: old work refused as a stored document", () => {
  const twice = (second: string) => ({ ...stored(ABC), nodes: stored(ABC).nodes.map((n, i) => (i === 1 ? { ...n, id: second } : n)) });
  it.each([
    ["without an id", { ...stored(ABC), nodes: stored(ABC).nodes.map((n, i) => (i === 1 ? { type: n.type, children: n.children } : n)) }, "NODE_ID_INVALID"],
    ["with a malformed id", twice("not-a-uuid"), "NODE_ID_INVALID"],
    ["with an id twice", twice(ID.a), "NODE_ID_DUPLICATE"],
    ["with an id twice in another case", twice(ID.a.toUpperCase()), "NODE_ID_DUPLICATE"],
  ])("%s: refused, and the editor stays as it was", (_name, old, code) => {
    const h = new Harness(["Dokument prije.", "Drugi blok prije."]);
    const before = h.editor.getJSON();
    const outcome = replaceWithStoredDocument(h.view, old as unknown as CanonicalDocument);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? [] : outcome.errors.map((e) => e.code)).toContain(code);
    expect(h.editor.getJSON()).toEqual(before);
  });

  it("an old editor form with an id twice or none never converts to a repeated id", () => {
    const json = { type: "doc", content: [blockJSON("Alfa.", ID.a), blockJSON("Beta.", ID.a.toUpperCase()), blockJSON("Gama.", null)] };
    const result = tiptapToCanonical(json);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const found = result.doc.nodes.map((n) => n.id.toLowerCase());
    expect(found[0]).toBe(ID.a);
    expect(new Set(found).size).toBe(3);
  });
});

/**
 * Istodobnost: two tabs over one document, or a sync and a restore between two
 * reads. Only one tab writes (a Web Lock); the other re-reads stored
 * documents. A load replaces, it never merges: the ids after it are exactly
 * those of the document loaded, and nothing from before it comes back.
 */
describe("block identity: two tabs, or a sync and a restore between two reads", () => {
  const split = (h: Harness, block: number, offset: number) => {
    h.editor.commands.setTextSelection(h.textPos(block, offset));
    h.editor.commands.splitBlock();
  };
  const idsAndTexts = (doc: CanonicalDocument) => doc.nodes.map((n) => ({ id: n.id, text: n.children.map((c) => c.text).join("") }));
  const load = (h: Harness, doc: CanonicalDocument, fresh: boolean) => {
    if (fresh) startFreshHistory(h.view, "keep");
    expect(replaceWithStoredDocument(h.view, doc)).toEqual({ ok: true });
  };

  it.each([true, false])("the reading tab holds exactly the newer ids after an older and a newer read (fresh history: %s)", (fresh) => {
    const writer = new Harness(ABC);
    const older = writer.canonical();
    split(writer, 1, 5);
    const newer = writer.canonical();
    const [anchor] = anchorsOf(writer).filter((a) => a.nodeId === newer.nodes[2].id);

    const reader = new Harness(["Kartica prije."]);
    load(reader, older, fresh);
    load(reader, newer, fresh);

    expect(reader.blocks()).toEqual(idsAndTexts(newer));
    reader.editor.commands.undo();
    reader.editor.commands.redo();
    expect(reader.blocks()).toEqual(idsAndTexts(newer));
    const holders = reader.blocks().filter((b) => resolveTextAnchor(anchor, b.id as NodeId, b.text).status !== "missing");
    expect(holders.map((b) => b.id)).toEqual([newer.nodes[2].id]);
  });

  it.each([true, false])("an older read arriving after a newer one replaces it, and no id of the newer is left (fresh history: %s)", (fresh) => {
    const writer = new Harness(ABC);
    const older = writer.canonical();
    split(writer, 0, 5);
    const newer = writer.canonical();
    const mintedByWriter = newer.nodes[1].id;

    const reader = new Harness(["Kartica prije."]);
    load(reader, newer, fresh);
    load(reader, older, fresh);

    expect(reader.blocks()).toEqual(idsAndTexts(older));
    expect(reader.blocks().map((b) => b.id)).not.toContain(mintedByWriter);
  });

  it.each([true, false])("a block removed in a tab before a read does not come back with its id (fresh history: %s)", (fresh) => {
    const tab = new Harness(ABC);
    const [b, c] = [tab.doc.child(1), tab.doc.child(2)];
    tab.view.dispatch(tab.editor.state.tr.delete(tab.posOf(1), tab.doc.content.size));

    // Stored in between by the other tab: b is there again, c is not.
    load(tab, stored([ABC[0], ABC[1]], ["a", "b"]), fresh);
    tab.view.dispatch(tab.editor.state.tr.insert(tab.doc.content.size, [b, c]));

    const [first, second, third, fourth] = tab.blocks().map((x) => x.id);
    expect([first, second]).toEqual([ID.a, ID.b]);
    for (const id of [third, fourth]) {
      expect(tab.minted.has(id)).toBe(true);
    }
  });

  describe("negative: a document put together from two tabs is refused, and the tab stays as it was", () => {
    function twoTabs() {
      const one = new Harness(ABC);
      const two = new Harness(ABC);
      split(one, 0, 5);
      split(two, 2, 5);
      return { one, two };
    }

    it.each([
      ["both tabs' blocks, so every old id twice", (one: CanonicalDocument, two: CanonicalDocument) => [...one.nodes, ...two.nodes]],
      ["an old id twice in another case", (one: CanonicalDocument, two: CanonicalDocument) => [...one.nodes, { ...two.nodes[3], id: two.nodes[2].id.toUpperCase() }]],
      ["one id minted in both tabs for different blocks", (one: CanonicalDocument, two: CanonicalDocument) => [...one.nodes, { ...two.nodes[3], id: one.nodes[1].id }]],
    ])("%s", (_name, merge) => {
      const { one, two } = twoTabs();
      const merged = { schemaVersion: 1, nodes: merge(one.canonical(), two.canonical()) } as CanonicalDocument;
      const before = two.editor.getJSON();

      const outcome = replaceWithStoredDocument(two.view, merged);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? [] : outcome.errors.map((e) => e.code)).toContain("NODE_ID_DUPLICATE");
      expect(two.editor.getJSON()).toEqual(before);
      // Nor was its history touched: undo still takes back its own split.
      two.editor.commands.undo();
      expect(two.blocks()).toEqual(ABC.map((text, i) => ({ id: ID[LETTERS[i]], text })));
    });
  });
});
