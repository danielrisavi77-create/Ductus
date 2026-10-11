import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";

import { paragraphNode, textNode, DOCUMENT_SCHEMA_VERSION, type CanonicalDocument, type NodeId } from "../domain/document";

import { mintMissingIds, replaceWithStoredDocument, withoutNodeIds, REMOVAL_MEMORY } from "./identity";
import { canonicalToTiptap, tiptapToCanonical } from "./interop";
import { createEditorExtensions, NodeIdentity, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * How ids enter the editor from storage, and what the clipboard boundary
 * removes. Synthetic documents only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;
const ID_C = "cccccccc-0000-4000-8000-00000000000c" as NodeId;
const MINTED = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function doc(...nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

const STORED = doc(
  paragraphNode(ID_A, [textNode("Prvi blok.")]),
  paragraphNode(ID_B, [textNode("Drugi blok.")]),
  paragraphNode(ID_C, [textNode("Treći blok.")]),
);

function open(content?: CanonicalDocument, extensions = createEditorExtensions()): Editor {
  // An editor opened with nothing holds one paragraph that has no id yet.
  const initial = content ? canonicalToTiptap(content) : { type: "doc", content: [{ type: "paragraph" }] };
  const editor = new Editor({ element: null, extensions, content: initial });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

function ids(editor: Editor): unknown[] {
  return editor.getJSON().content.map((node) => node.attrs?.[NODE_ID_ATTRIBUTE]);
}

function canonicalIds(editor: Editor): string[] {
  const result = tiptapToCanonical(editor.getJSON());
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.doc.nodes.map((node) => node.id);
}

describe("replaceWithStoredDocument", () => {
  it("keeps every stored id, on an empty editor and over existing content", () => {
    const editor = open();
    expect(replaceWithStoredDocument(editor.view, STORED)).toEqual({ ok: true });
    expect(ids(editor)).toEqual([ID_A, ID_B, ID_C]);

    const reordered = doc(STORED.nodes[2], STORED.nodes[0]);
    expect(replaceWithStoredDocument(editor.view, reordered)).toEqual({ ok: true });
    expect(ids(editor)).toEqual([ID_C, ID_A]);
    expect(tiptapToCanonical(editor.getJSON())).toEqual({ ok: true, doc: reordered });
  });

  it("keeps a stored id exactly as stored, upper case included", () => {
    const upper = ID_B.toUpperCase() as NodeId;
    const editor = open();
    replaceWithStoredDocument(editor.view, doc(paragraphNode(ID_A), paragraphNode(upper)));

    expect(ids(editor)).toEqual([ID_A, upper]);
  });

  it.each([
    ["the same id twice", doc(paragraphNode(ID_A, [textNode("a")]), paragraphNode(ID_A, [textNode("b")])), "NODE_ID_DUPLICATE"],
    ["the same id in two cases", doc(paragraphNode(ID_A), paragraphNode(ID_A.toUpperCase() as NodeId)), "NODE_ID_DUPLICATE"],
    ["a malformed id", doc(paragraphNode("not-a-uuid" as NodeId)), "NODE_ID_INVALID"],
  ])("refuses a stored document with %s and leaves the editor as it was", (_name, stored, code) => {
    const editor = open(STORED);
    const result = replaceWithStoredDocument(editor.view, stored);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.code)).toContain(code);
    expect(ids(editor)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("is not an edit: it raises no update and cannot be undone", () => {
    const editor = open(doc(paragraphNode(ID_C, [textNode("Prije.")])));
    let updates = 0;
    editor.on("update", () => {
      updates += 1;
    });

    replaceWithStoredDocument(editor.view, STORED);
    editor.commands.undo();

    expect(updates).toBe(0);
    expect(ids(editor)).toEqual([ID_A, ID_B, ID_C]);
  });

  it("cannot be imitated by a transaction that carries the same meta", () => {
    const editor = open();
    const content = editor.schema.nodeFromJSON(canonicalToTiptap(STORED)).content;
    editor.view.dispatch(
      editor.state.tr
        .replaceWith(0, editor.state.doc.content.size, content)
        .setMeta("addToHistory", false)
        .setMeta("preventUpdate", true)
        .setMeta("nodeIdentity$", true)
        .setMeta("paste", true)
        .setMeta("uiEvent", "paste"),
    );

    const result = canonicalIds(editor);
    expect(result).toHaveLength(3);
    for (const id of result) {
      expect(id).toMatch(MINTED);
      expect([ID_A, ID_B, ID_C]).not.toContain(id);
    }
  });

  it("forgets blocks removed before the load, so none of them can come back with its id", () => {
    const editor = open(STORED);
    const removed = editor.state.doc.child(1);
    const from = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(from, from + removed.nodeSize));

    replaceWithStoredDocument(editor.view, doc(STORED.nodes[0], STORED.nodes[2]));
    editor.view.dispatch(editor.state.tr.insert(0, removed));

    const [first, ...rest] = canonicalIds(editor);
    expect(first).toMatch(MINTED);
    expect(first).not.toBe(ID_B);
    expect(rest).toEqual([ID_A, ID_C]);
  });
});

describe("clipboard boundary", () => {
  it("removes ids from every node of a slice and keeps its content and open depths", () => {
    const editor = open(STORED);
    const slice = editor.state.doc.slice(3, editor.state.doc.content.size - 3);
    const stripped = withoutNodeIds(slice);

    expect([stripped.openStart, stripped.openEnd]).toEqual([slice.openStart, slice.openEnd]);
    expect(stripped.content.textBetween(0, stripped.content.size, "|")).toBe(slice.content.textBetween(0, slice.content.size, "|"));
    const found: unknown[] = [];
    stripped.content.forEach((node) => found.push(node.attrs[NODE_ID_ATTRIBUTE]));
    expect(found).toEqual([null, null, null]);
  });

  /** What the editor itself does to a pasted or dropped slice (the `transformPasted` prop). */
  function asPasted(editor: Editor, slice: Slice): Slice {
    let result = slice;
    for (const plugin of editor.state.plugins) {
      const transform = plugin.props.transformPasted;
      if (transform) {
        result = transform.call(plugin, result, editor.view as never, false);
      }
    }
    return result;
  }

  it("a whole block cut and pasted back is a new block; the same block restored by undo is not", () => {
    const editor = open(STORED);
    const from = editor.state.doc.child(0).nodeSize;
    const cut = new Slice(editor.state.doc.slice(from, from + editor.state.doc.child(1).nodeSize).content, 0, 0);
    editor.view.dispatch(editor.state.tr.delete(from, from + cut.size));
    const pastedSlice = asPasted(editor, cut);
    expect(pastedSlice.content.child(0).attrs[NODE_ID_ATTRIBUTE]).toBeNull();
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, pastedSlice.content));

    const pasted = canonicalIds(editor);
    expect(pasted.slice(0, 2)).toEqual([ID_A, ID_C]);
    expect(pasted[2]).toMatch(MINTED);
    expect(pasted[2]).not.toBe(ID_B);

    editor.commands.undo();
    editor.commands.undo();
    expect(canonicalIds(editor)).toEqual([ID_A, ID_B, ID_C]);
  });
});

describe("removed blocks", () => {
  it("are all remembered when one transaction removes many, so undo restores every id", () => {
    const nodes = Array.from({ length: 2 * REMOVAL_MEMORY }, (_, index) =>
      paragraphNode(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000` as NodeId, [textNode(`blok ${index}`)]),
    );
    const editor = open(doc(...nodes));
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.content.size));
    expect(canonicalIds(editor)).toHaveLength(1);

    editor.commands.undo();
    expect(canonicalIds(editor)).toEqual(nodes.map((node) => node.id));
  });

  it("come back with their id only as the same block: a heading of another level is a new block", () => {
    const heading = (level: number) => ({
      type: "heading",
      attrs: { [NODE_ID_ATTRIBUTE]: ID_B, level },
      content: [{ type: "text", text: "Naslov." }],
    });
    const editor = new Editor({
      element: null,
      extensions: createEditorExtensions(),
      content: { type: "doc", content: [canonicalToTiptap(STORED).content[0], heading(1)] },
    });
    editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
    const from = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(from, editor.state.doc.content.size));

    editor.view.dispatch(editor.state.tr.insert(from, editor.schema.nodeFromJSON(heading(2))));
    const [, other] = canonicalIds(editor);
    expect(other).toMatch(MINTED);
    expect(other).not.toBe(ID_B);

    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodeFromJSON(heading(1))));
    expect(canonicalIds(editor)).toEqual([ID_A, other, ID_B]);
  });

  it(`are remembered for ${REMOVAL_MEMORY} removing transactions; an older one comes back as a new block`, () => {
    const count = REMOVAL_MEMORY + 1;
    const nodes = Array.from({ length: count + 1 }, (_, index) =>
      paragraphNode(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000` as NodeId, [textNode(`blok ${index}`)]),
    );
    const editor = open(doc(...nodes));
    const first = editor.state.doc.child(0);
    const last = editor.state.doc.child(count - 1);
    for (let index = 0; index < count; index += 1) {
      editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize));
    }

    editor.view.dispatch(editor.state.tr.insert(0, [first, last]));

    const [oldest, newest, kept] = canonicalIds(editor);
    expect(oldest).toMatch(MINTED);
    expect(oldest).not.toBe(nodes[0].id);
    expect(newest).toBe(nodes[count - 1].id);
    expect(kept).toBe(nodes[count].id);
  });
});

describe("removed blocks: what counts towards the memory", () => {
  const numbered = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      paragraphNode(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000` as NodeId, [textNode(`blok ${index}`)]),
    );
  const removeFirst = (editor: Editor) =>
    editor.view.dispatch(editor.state.tr.delete(0, editor.state.doc.child(0).nodeSize));

  it("edits that remove nothing do not age it", () => {
    const nodes = numbered(2);
    const editor = open(doc(...nodes));
    const removed = editor.state.doc.child(0);
    removeFirst(editor);
    for (let index = 0; index <= REMOVAL_MEMORY; index += 1) {
      editor.view.dispatch(editor.state.tr.insertText("a", 1));
    }
    // One more removal, so that the memory is pruned at all.
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()));
    editor.view.dispatch(editor.state.tr.delete(editor.state.doc.child(0).nodeSize, editor.state.doc.content.size));

    editor.view.dispatch(editor.state.tr.insert(0, removed));
    expect(canonicalIds(editor)[0]).toBe(nodes[0].id);
  });

  it("a block removed a second time is aged from its second removal, and does not keep older ones alive", () => {
    const nodes = numbered(REMOVAL_MEMORY + 3);
    const editor = open(doc(...nodes));
    const again = editor.state.doc.child(0);
    const older = editor.state.doc.child(1);
    removeFirst(editor); // removal 1: `again`
    removeFirst(editor); // removal 2: `older`
    editor.view.dispatch(editor.state.tr.insert(0, again));
    expect(canonicalIds(editor)[0]).toBe(nodes[0].id);
    removeFirst(editor); // removal 3: `again` once more
    for (let removal = 4; removal <= REMOVAL_MEMORY + 2; removal += 1) {
      removeFirst(editor);
    }

    editor.view.dispatch(editor.state.tr.insert(0, [older, again]));
    const [first, second] = canonicalIds(editor);
    expect(first).toMatch(MINTED);
    expect(first).not.toBe(nodes[1].id);
    expect(second).toBe(nodes[0].id);
  });
});

describe("the step that writes ids", () => {
  const blank = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }, { type: "paragraph" }] };

  function minting() {
    const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: blank });
    const tr = mintMissingIds(editor.state)!;
    return { before: editor.state.doc, after: tr.doc, step: tr.steps[0], steps: tr.steps.length };
  }

  it("is one step for any number of blocks, changes no positions and inverts to the document as it was", () => {
    const { before, after, step, steps } = minting();

    expect(steps).toBe(1);
    expect(step.getMap().mapResult(3, 1)).toMatchObject({ pos: 3, deleted: false });
    expect(after.content.size).toBe(before.content.size);
    expect(step.invert(before).apply(after).doc?.eq(before)).toBe(true);
  });

  it("follows its blocks through an earlier change and lets go of a block that was removed", () => {
    const { before, after, step } = minting();
    const removal = new Transform(before).delete(2, 4);
    const mapped = step.map(removal.mapping);

    const expected = [after.child(0), after.child(2)].map((node) => node.attrs[NODE_ID_ATTRIBUTE]);
    const result = mapped?.apply(removal.doc);
    expect(result?.failed).toBeNull();
    expect(result?.doc?.content.content.map((node) => node.attrs[NODE_ID_ATTRIBUTE])).toEqual(expected);
    expect(step.map(new Transform(before).delete(0, before.content.size).mapping)).toBeNull();
  });

  it("fails, and does not guess, when a position no longer holds a block", () => {
    const { before, step } = minting();
    const shorter = new Transform(before).delete(4, 6).doc;
    const withText = new Transform(before).insert(1, before.type.schema.text("abc")).doc;

    expect(step.apply(shorter).failed).toEqual(expect.any(String));
    expect(step.apply(shorter).doc).toBeNull();
    // Position 2 now lies inside the text of the first block.
    expect(step.apply(withText).failed).toEqual(expect.any(String));
  });
});

describe("blocks that never had an id", () => {
  it("get one in a transaction that is not part of the undo history", () => {
    const editor = open();
    expect(ids(editor)).toEqual([null]);

    const tr = mintMissingIds(editor.state);
    expect(tr?.getMeta("addToHistory")).toBe(false);
    editor.view.dispatch(tr!);

    const [id] = ids(editor);
    expect(id).toMatch(MINTED);
    expect(mintMissingIds(editor.state)).toBeNull();
    // The first edit does not change it.
    editor.view.dispatch(editor.state.tr.insertText("Prva rečenica.", 1));
    expect(ids(editor)).toEqual([id]);
  });

  it.each([
    ["exactly", ID_A as string],
    ["in another letter case", ID_A.toUpperCase()],
  ])("also repairs an id that the initial content holds twice, %s: the earlier block keeps it", (_name, twin) => {
    const paragraph = (id: string, text: string) => ({
      type: "paragraph",
      attrs: { [NODE_ID_ATTRIBUTE]: id },
      content: [{ type: "text", text }],
    });
    // What the editor does when it is created: no edit has happened yet.
    const editor = new Editor({
      element: null,
      extensions: createEditorExtensions(),
      content: { type: "doc", content: [paragraph(ID_A, "Prvi."), paragraph(twin, "Drugi."), paragraph(ID_C, "Treći.")] },
    });
    editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
    editor.view.dispatch(mintMissingIds(editor.state)!);

    const [first, second, third] = ids(editor) as string[];
    expect([first, third]).toEqual([ID_A, ID_C]);
    expect(second).toMatch(MINTED);
    expect(second.toLowerCase()).not.toBe(ID_A);
    // Settled in the editor: two conversions in a row agree.
    expect(canonicalIds(editor)).toEqual([first, second, third]);
    expect(canonicalIds(editor)).toEqual([first, second, third]);
    expect(mintMissingIds(editor.state)).toBeNull();
  });

  it("does not touch an id that is present, malformed or not", () => {
    const editor = open();
    editor.view.updateState(
      editor.state.reconfigure({ plugins: [] }).apply(
        editor.state.tr.setNodeAttribute(0, NODE_ID_ATTRIBUTE, "not-a-uuid"),
      ),
    );

    expect(mintMissingIds(editor.state)).toBeNull();
  });

  /** An editor whose minter hands out `first` once and real ids after that. */
  function openMinting(first: NodeId, content: CanonicalDocument): Editor {
    let used = false;
    const mint = () => {
      if (used) {
        return crypto.randomUUID() as NodeId;
      }
      used = true;
      return first;
    };
    return open(
      content,
      createEditorExtensions().map((extension) =>
        extension.name === "nodeIdentity" ? NodeIdentity.configure({ mint }) : extension,
      ),
    );
  }

  it("never accepts a minted id that a block already holds: the holder keeps it", () => {
    const editor = openMinting(ID_A, STORED);
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodes.paragraph.create()));

    const [added, ...rest] = ids(editor) as string[];
    expect(rest).toEqual([ID_A, ID_B, ID_C]);
    expect(added).toMatch(MINTED);
    expect(added).not.toBe(ID_A);
  });

  it("never accepts a minted id that a block holds in another letter case", () => {
    const upper = ID_B.toUpperCase() as NodeId;
    const editor = openMinting(ID_B, doc(paragraphNode(ID_A), paragraphNode(upper)));
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodes.paragraph.create()));

    const [added, ...rest] = ids(editor) as string[];
    expect(rest).toEqual([ID_A, upper]);
    expect(added).toMatch(MINTED);
    expect(added).not.toBe(ID_B);
    expect(canonicalIds(editor)).toEqual([added, ID_A, upper]);
  });

  it("uses the minter the extension was configured with", () => {
    const minted = "eeeeeeee-0000-4000-8000-00000000000e" as NodeId;
    const extensions = createEditorExtensions().map((extension) =>
      extension.name === "nodeIdentity" ? NodeIdentity.configure({ mint: () => minted }) : extension,
    );
    const editor = open(STORED, extensions);
    editor.commands.setTextSelection(3);
    editor.commands.splitBlock();

    expect(ids(editor)).toEqual([ID_A, minted, ID_B, ID_C]);
  });
});
