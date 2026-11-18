// @vitest-environment node
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection, type Transaction } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import type { Editor } from "@tiptap/core";

import { CaptureError, changeOf } from "./capture";
import { changeOfV2, changeStepsV2 } from "./capture-v2";
import { CITATION_UNMARK_META, unmarkCitations } from "./citation";
import { replayChanges, SRC_1, SRC_2, START, v2Harness, type V2Harness } from "./capture-v2.fixture";

/**
 * DAN-620 b, the classes of the contract (#1836 issuecomment-6863212601):
 * text steps, a mark over a citation, deleting a citation, pasting one,
 * undo and redo, and the guard's own transaction. Each records the real v2
 * editor (`capture-v2.fixture.ts`) and replays what capture writes: after
 * every change the replayer's document is the editor's. Invented ids and
 * filler text only.
 */

let harness: V2Harness | null = null;
afterEach(() => {
  harness?.editor.destroy();
  harness = null;
});

function setUp(): V2Harness {
  harness = v2Harness();
  return harness;
}

/** Replays every recorded change and checks the replayer's document after each one; returns the written steps. */
async function replaysExactly(h: V2Harness) {
  const { written, after } = await replayChanges(h.changes);
  for (const [i, pair] of after.entries()) expect(pair.replayed, `after change ${i}`).toEqual(pair.editor);
  return written;
}

const citation = (e: Editor, sourceId: string, marks: string[] = [], locator: string | null = null) =>
  e.schema.nodes.citation!.create({ sourceId, locator }, null, marks.map((name) => e.schema.marks[name]!.create()));

const paste = (e: Editor, from: number, to: number, slice: Slice) =>
  e.view.dispatch(e.state.tr.replaceRange(from, to, slice).setMeta("uiEvent", "paste"));

describe("K1 text steps", () => {
  it("typing, deleting text, splitting at a citation and joining back replay to the editor's document", async () => {
    const h = setUp();
    const e = h.editor;
    e.view.dispatch(e.state.tr.insertText("xy", 10));
    e.chain().setTextSelection({ from: 15, to: 16 }).deleteSelection().run();
    e.chain().setTextSelection(13).splitBlock().run();
    e.chain().setTextSelection(15).joinBackward().run();
    expect(h.changes.length).toBeGreaterThanOrEqual(4);
    await replaysExactly(h);
  });
});

describe("K2 a mark over a citation", () => {
  it("bold over text and a citation writes the editor's mark step and replays with the citation bare", async () => {
    const h = setUp();
    h.editor.chain().setTextSelection({ from: 9, to: 14 }).toggleBold().run();
    const written = await replaysExactly(h);
    expect(written.flat()).toContainEqual({ stepType: "addMark", from: 9, to: 14, mark: { type: "bold" } });
  });

  it("a mark over the citation alone is refused by the guard, so nothing is recorded", async () => {
    const h = setUp();
    h.editor.chain().setTextSelection({ from: 11, to: 12 }).toggleItalic().run();
    expect(h.changes).toHaveLength(0);
  });
});

describe("K3 deleting a citation", () => {
  it("the removal of a lone citation carries removedSha256, never structure", async () => {
    const h = setUp();
    const e = h.editor;
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 11)));
    e.commands.deleteSelection();
    const written = await replaysExactly(h);
    expect(written.flat()).toHaveLength(1);
    expect(written.flat()[0]).toMatchObject({ stepType: "replace", from: 11, to: 12 });
    expect(written.flat()[0]).toHaveProperty("removedSha256");
    expect(written.flat()[0]).not.toHaveProperty("structure");
  });

  it("deleting across two blocks and a citation with a locator replays", async () => {
    const h = setUp();
    h.editor.chain().setTextSelection({ from: 10, to: 18 }).deleteSelection().run();
    await replaysExactly(h);
  });
});

describe("K4 pasting a citation", () => {
  it("a pasted citation is written in its document form, its marks and null locator left out", async () => {
    const h = setUp();
    const e = h.editor;
    paste(e, 13, 13, new Slice(Fragment.from(citation(e, SRC_2, ["bold", "italic"])), 0, 0));
    paste(e, 3, 3, new Slice(Fragment.from([e.schema.text("x"), citation(e, SRC_1, [], "str. 9")]), 0, 0));
    const written = await replaysExactly(h);
    expect(written[0]).toEqual([
      { stepType: "replace", from: 13, to: 13, slice: { content: [{ type: "citation", sourceId: SRC_2 }] } },
    ]);
    expect(JSON.stringify(written[1])).toContain(`{"locator":"str. 9","sourceId":"${SRC_1}","type":"citation"}`);
  });

  it("a citation inserted by a command with a mark replays bare", async () => {
    const h = setUp();
    h.editor.chain().setTextSelection(9).insertContent({ type: "citation", attrs: { sourceId: SRC_1 }, marks: [{ type: "bold" }] }).run();
    const written = await replaysExactly(h);
    expect(JSON.stringify(written)).not.toContain("marks");
  });

  it("pasting blocks that hold a citation over a selection across blocks replays", async () => {
    const h = setUp();
    const e = h.editor;
    const block = e.schema.nodes.paragraph!.create(null, [e.schema.text("Gh"), citation(e, SRC_1, ["italic"])]);
    paste(e, 10, 18, new Slice(Fragment.from([block, block.copy(block.content)]), 1, 1));
    await replaysExactly(h);
  });
});

describe("K5 undo and redo across a citation", () => {
  it("bold over a citation, undo, redo, undo replay to the editor's document every time", async () => {
    const h = setUp();
    const e = h.editor;
    e.chain().setTextSelection({ from: 9, to: 14 }).toggleBold().run();
    e.commands.undo();
    e.commands.redo();
    e.commands.undo();
    expect(e.can().undo()).toBe(false);
    await replaysExactly(h);
  });

  it("a deleted citation comes back with undo and goes again with redo", async () => {
    const h = setUp();
    const e = h.editor;
    e.chain().setTextSelection({ from: 10, to: 13 }).deleteSelection().run();
    e.commands.undo();
    e.commands.redo();
    e.commands.undo();
    await replaysExactly(h);
    expect(e.state.doc.textBetween(9, 14, undefined, "￼")).toBe("Ab￼Cd");
  });

  it("regression: undo of a mark step the guard left over a citation alone writes no step the replayer refuses", async () => {
    const h = setUp();
    const e = h.editor;
    e.chain().setTextSelection({ from: 11, to: 14 }).toggleBold().run();
    // An edit outside the history removes the text after the citation.
    e.view.dispatch(e.state.tr.delete(12, 14).setMeta("addToHistory", false));
    expect(e.commands.undo()).toBe(true);
    const written = await replaysExactly(h);
    // The undo's step only takes a mark off a citation that holds none: nothing to write.
    expect(written.at(-1)).toEqual([]);
  });
});

describe("K6 the guard's own transaction", () => {
  it("is left out of the change, and written alone it gives no step either", async () => {
    const h = setUp();
    const e = h.editor;
    const seen: Transaction[][] = [];
    e.on("transaction", ({ transaction, appendedTransactions }) => seen.push([transaction, ...appendedTransactions]));
    e.chain().setTextSelection({ from: 9, to: 14 }).toggleBold().run();
    const all = seen.find((group) => group.some((tr) => tr.getMeta(CITATION_UNMARK_META) === true))!;
    expect(all).toBeDefined();
    const withGuard = await changeStepsV2(changeOf(all, "editor", 0));
    const withoutGuard = await changeStepsV2(changeOfV2(all, "editor", 0));
    expect(withGuard).toEqual(withoutGuard);
    expect(withoutGuard).toEqual([{ stepType: "addMark", from: 9, to: 14, mark: { type: "bold" } }]);
  });

  it("a change of the guard alone (marked initial content) writes no step", async () => {
    const h = setUp();
    const e = h.editor;
    const marked = e.schema.nodeFromJSON({ type: "doc", content: [{
      type: "paragraph", attrs: { nodeId: START.nodes[1]!.id },
      content: [{ type: "citation", attrs: { sourceId: SRC_1, locator: null }, marks: [{ type: "bold" }] }],
    }] });
    // A state with no plugins: the citation stays marked, as content the guard has not seen yet.
    const guard = unmarkCitations(EditorState.create({ doc: marked }))!;
    expect(guard.getMeta(CITATION_UNMARK_META)).toBe(true);
    expect(guard.steps).toHaveLength(1);
    expect(changeOfV2([guard], "editor", 0).steps).toHaveLength(0);
    expect(await changeStepsV2(changeOfV2([guard], "editor", 0))).toEqual([]);
    // Written with it, its step finds the citation already bare and writes nothing either.
    expect(await changeStepsV2(changeOf([guard], "editor", 0))).toEqual([]);
  });

  it("refuses a change that does not end in the editor's document", async () => {
    const h = setUp();
    h.editor.chain().setTextSelection({ from: 9, to: 14 }).toggleBold().run();
    const change = { ...h.changes[0]!, after: h.changes[0]!.docs[0]! };
    await expect(changeStepsV2(change)).rejects.toEqual(new CaptureError("unsupported_step"));
  });
});

describe("K8 a citation into a heading", () => {
  it("setting the paragraph with a citation to a heading is refused, so nothing is recorded", async () => {
    const h = setUp();
    const e = h.editor;
    e.commands.setTextSelection(10);
    // Without the guard both commands would apply.
    expect(e.can().setNode("heading", { level: 2 })).toBe(true);
    e.commands.setNode("heading", { level: 2 });
    e.commands.setTextSelection(9);
    expect(e.can().joinBackward()).toBe(true);
    e.commands.joinBackward();
    expect(h.changes).toHaveLength(0);
  });
});
