// @vitest-environment node
import { fc } from "@fast-check/vitest";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import type { Editor } from "@tiptap/core";

import { replayChanges, SRC_1, SRC_2, v2Harness } from "./capture-v2.fixture";

/**
 * DAN-620 b (#1836 issuecomment-6863212601): random action sequences on the
 * real v2 editor over a document with citations (typing, deleting, Enter,
 * selections, a citation selected, bold and italic, headings, pasting text
 * and citations, a citation inserted by a command, Undo and Redo, an edit
 * outside the history, new undo groups). Capture writes every change and the
 * replayer of `ductus-edit-steps-v2` applies it: after every change its
 * document is exactly the editor's, and capture never refuses a change.
 * Invented ids and filler text only.
 */

const WORDS = ["x", "Ab", " ", "Izmisljeno"];

const action = fc.oneof(
  fc.record({ kind: fc.constantFrom("Backspace", "Delete", "Enter", "bold", "italic", "Undo", "Redo", "deleteSelection", "paragraph", "closeHistory") }),
  fc.record({ kind: fc.constant("type"), word: fc.constantFrom(...WORDS) }),
  fc.record({ kind: fc.constantFrom("caret", "selectCitation", "remoteDelete"), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant("select"), at: fc.double({ min: 0, max: 1, noNaN: true }), to: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant("heading"), level: fc.constantFrom(1, 2, 3) }),
  fc.record({
    kind: fc.constantFrom("pasteCitation", "insertCitation"),
    source: fc.constantFrom(SRC_1, SRC_2),
    marks: fc.subarray(["bold", "italic"]),
    locator: fc.constantFrom(null, "str. 9"),
    withText: fc.boolean(),
  }),
);
type Action = typeof action extends fc.Arbitrary<infer T> ? T : never;

function key(name: string, ctrl = false, shift = false) {
  const code = name.length === 1 ? name.toUpperCase().charCodeAt(0) : { Enter: 13, Backspace: 8, Delete: 46 }[name]!;
  return { key: name, keyCode: code, which: code, ctrlKey: ctrl, shiftKey: shift, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

function act(e: Editor, a: Action): void {
  const press = (name: string, ctrl = false, shift = false) =>
    e.state.plugins.some((plugin) => plugin.props.handleKeyDown?.call(plugin, e.view, key(name, ctrl, shift)));
  const doc = e.state.doc;
  const position = (x: number) => TextSelection.near(doc.resolve(Math.min(doc.content.size, Math.floor(x * doc.content.size)))).from;
  switch (a.kind) {
    case "Backspace": case "Delete": case "Enter": press(a.kind); return;
    case "bold": press("b", true); return;
    case "italic": press("i", true); return;
    case "Undo": press("z", true); return;
    case "Redo": press("z", true, true); return;
    case "deleteSelection": e.commands.deleteSelection(); return;
    case "paragraph": e.commands.setParagraph(); return;
    case "heading": e.commands.setHeading({ level: a.level as 1 | 2 | 3 }); return;
    case "closeHistory": e.view.dispatch(closeHistory(e.state.tr)); return;
    case "type": e.view.dispatch(e.state.tr.insertText(a.word)); return;
    case "caret": e.view.dispatch(e.state.tr.setSelection(TextSelection.near(doc.resolve(position(a.at))))); return;
    case "select": {
      const [from, to] = [position(a.at), position(a.to)].sort((x, y) => x - y);
      e.view.dispatch(e.state.tr.setSelection(TextSelection.between(doc.resolve(from!), doc.resolve(to!))));
      return;
    }
    case "selectCitation": {
      const citations: number[] = [];
      doc.descendants((node, pos) => {
        if (node.type.name === "citation") citations.push(pos);
      });
      if (citations.length > 0) {
        const pos = citations[Math.min(citations.length - 1, Math.floor(a.at * citations.length))]!;
        e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(doc, pos)));
      }
      return;
    }
    case "remoteDelete": {
      // An edit outside the undo history: undo maps through it.
      const from = position(a.at);
      const to = Math.min(doc.resolve(from).end(), from + 2);
      if (to > from) e.view.dispatch(e.state.tr.delete(from, to).setMeta("addToHistory", false));
      return;
    }
    case "pasteCitation": case "insertCitation": {
      const marks = a.marks.map((name) => e.schema.marks[name]!.create());
      if (a.kind === "insertCitation") {
        e.commands.insertContent({ type: "citation", attrs: { sourceId: a.source, locator: a.locator }, marks: a.marks.map((type) => ({ type })) });
        return;
      }
      const cite = e.schema.nodes.citation!.create({ sourceId: a.source, locator: a.locator }, null, marks);
      const content = a.withText ? [e.schema.text("Gh", marks), cite] : [cite];
      e.view.dispatch(e.state.tr.replaceSelection(new Slice(Fragment.from(content), 0, 0)).setMeta("uiEvent", "paste"));
    }
  }
}

describe("DAN-620 b: random edits over citations replay to the editor's document", () => {
  it("every change, written and replayed, ends in the editor's document", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 30 }), async (actions) => {
        const h = v2Harness();
        try {
          for (const a of actions) act(h.editor, a);
          // The changes follow one another: none starts anywhere but where the last one ended.
          for (let i = 1; i < h.changes.length; i += 1) expect(h.changes[i]!.docs[0]!.eq(h.changes[i - 1]!.after)).toBe(true);
          const { after } = await replayChanges(h.changes);
          for (const [i, pair] of after.entries()) expect(pair.replayed, `after change ${i}`).toEqual(pair.editor);
        } finally {
          h.editor.destroy();
        }
      }),
      { numRuns: Math.min(Number(process.env.FC_NUM_RUNS ?? 100), 60) },
    );
  }, 600_000);
});
