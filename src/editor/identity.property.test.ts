import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { newNodeId, type NodeId } from "../domain/document";

import { startFreshHistory } from "./history";
import { replaceWithStoredDocument } from "./identity";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions, NodeIdentity, NODE_ID_ATTRIBUTE } from "./schema";

/**
 * Model-based property: an arbitrary sequence of inserts (with every kind of
 * carried id), blocks put into the text of a block, removals, moves, splits,
 * joins, typed text, rewritten id attributes, undo, redo, pastes from outside
 * (through the clipboard boundary, with every kind of carried id) and reloads
 * of the stored form (fresh history, then `replaceWithStoredDocument`) is run
 * against the editor and against a plain
 * list model that knows which block should hold which id. After every step
 * the editor must agree with the model, every id must have been minted by the
 * editor or stored at the start, and the document must have a canonical form.
 */

const STORED = ["a", "b", "c"].map((letter) => `${letter.repeat(8)}-0000-4000-8000-${letter.repeat(12)}` as NodeId);
const OUTSIDE = "dddddddd-0000-4000-8000-dddddddddddd";
const NEW = Symbol("new id");

type Entry = { id: string | typeof NEW; text: string };
type Carried = "none" | "in use" | "in use, upper case" | "outside" | "malformed" | "removed earlier";

type Op =
  | { kind: "insert"; at: number; carried: Carried; pick: number }
  | { kind: "rewrite"; at: number; carried: Carried; pick: number }
  | { kind: "remove"; at: number }
  | { kind: "move"; from: number; to: number; stripped: boolean }
  | { kind: "split"; at: number; offset: number; copyAttrs: boolean }
  | { kind: "pasteInto"; at: number; offset: number; carried: Carried; pick: number }
  | { kind: "join"; at: number }
  | { kind: "type"; at: number }
  | { kind: "pasteOutside"; at: number; carried: Carried; pick: number; blocks: 1 | 2; sameText: boolean }
  | { kind: "reload" }
  | { kind: "undo" }
  | { kind: "redo" };

const carried = fc.constantFrom<Carried>("none", "in use", "in use, upper case", "outside", "malformed", "removed earlier");
const index = fc.nat({ max: 40 });

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("insert" as const), at: index, carried, pick: index }),
  fc.record({ kind: fc.constant("rewrite" as const), at: index, carried, pick: index }),
  fc.record({ kind: fc.constant("remove" as const), at: index }),
  fc.record({ kind: fc.constant("move" as const), from: index, to: index, stripped: fc.boolean() }),
  fc.record({ kind: fc.constant("split" as const), at: index, offset: index, copyAttrs: fc.boolean() }),
  fc.record({ kind: fc.constant("pasteInto" as const), at: index, offset: index, carried, pick: index }),
  fc.record({ kind: fc.constant("join" as const), at: index }),
  fc.record({ kind: fc.constant("type" as const), at: index }),
  fc.record({ kind: fc.constant("pasteOutside" as const), at: index, carried, pick: index, blocks: fc.constantFrom<1 | 2>(1, 2), sameText: fc.boolean() }),
  fc.constant({ kind: "reload" as const }),
  fc.constant({ kind: "undo" as const }),
  fc.constant({ kind: "redo" as const }),
);

function run(ops: Op[]): void {
  const minted = new Set<string>();
  const mint = () => {
    const id = newNodeId();
    minted.add(id);
    return id;
  };
  const extensions = createEditorExtensions().map((extension) =>
    extension.name === "nodeIdentity" ? NodeIdentity.configure({ mint }) : extension,
  );
  let model: Entry[] = STORED.map((id, i) => ({ id, text: `p${i}` }));
  const editor = new Editor({
    element: null,
    extensions,
    content: {
      type: "doc",
      content: model.map((entry) => ({
        type: "paragraph",
        attrs: { [NODE_ID_ATTRIBUTE]: entry.id },
        content: [{ type: "text", text: entry.text }],
      })),
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));

  const past: Entry[][] = [];
  let future: Entry[][] = [];
  const removedIds: string[] = [];
  /** Text of a block removed whole, by its id: a paste can bring it back identical. */
  const removedTexts = new Map<string, string>();
  let counter = 0;

  const { schema } = editor;
  const posOf = (i: number) => {
    let pos = 0;
    for (let k = 0; k < i; k += 1) pos += editor.state.doc.child(k).nodeSize;
    return pos;
  };
  const idFor = (kind: Carried, pick: number): unknown => {
    const inUse = model[pick % model.length].id as string;
    switch (kind) {
      case "none": return null;
      case "in use": return inUse;
      case "in use, upper case": return inUse.toUpperCase();
      case "outside": return OUTSIDE;
      case "malformed": return "not-a-uuid";
      case "removed earlier": return removedIds.length > 0 ? removedIds[pick % removedIds.length] : OUTSIDE;
    }
  };
  /** One step of the author: its own undo event, and the model as it must be afterwards. */
  const act = (tr: Transaction, next: Entry[]) => {
    past.push(model);
    future = [];
    model = next;
    editor.view.dispatch(closeHistory(tr));
  };

  const check = (step: string) => {
    const result = tiptapToCanonical(editor.getJSON());
    if (!result.ok) throw new Error(`${step}: no canonical form: ${JSON.stringify(result.errors)}`);
    const actual = result.doc.nodes.map((node) => ({ id: node.id as string, text: node.children.map((c) => c.text).join("") }));
    expect(actual.map((entry) => entry.text), step).toEqual(model.map((entry) => entry.text));
    expect(new Set(actual.map((entry) => entry.id.toLowerCase())).size, step).toBe(actual.length);
    model = model.map((entry, i) => {
      if (entry.id === NEW) {
        expect(minted.has(actual[i].id), `${step}: block ${i} has an id the editor did not mint`).toBe(true);
        return { ...entry, id: actual[i].id };
      }
      expect(actual[i].id, `${step}: block ${i}`).toBe(entry.id);
      return entry;
    });
  };

  ops.forEach((step, n) => {
    const { tr } = editor.state;
    const count = model.length;
    switch (step.kind) {
      case "insert": {
        const at = step.at % (count + 1);
        const text = `n${(counter += 1)}`;
        const node = schema.nodes.paragraph.create({ [NODE_ID_ATTRIBUTE]: idFor(step.carried, step.pick) }, schema.text(text));
        act(tr.insert(posOf(at), node), [...model.slice(0, at), { id: NEW, text }, ...model.slice(at)]);
        break;
      }
      case "rewrite": {
        const at = step.at % count;
        act(tr.setNodeAttribute(posOf(at), NODE_ID_ATTRIBUTE, idFor(step.carried, step.pick)), model);
        break;
      }
      case "remove": {
        if (count < 2) return;
        const at = step.at % count;
        removedIds.push(model[at].id as string);
        removedTexts.set(model[at].id as string, model[at].text);
        act(tr.delete(posOf(at), posOf(at + 1)), model.filter((_, i) => i !== at));
        break;
      }
      case "move": {
        if (count < 2) return;
        const from = step.from % count;
        const rest = model.filter((_, i) => i !== from);
        const to = step.to % (rest.length + 1);
        const node = editor.state.doc.child(from);
        const moved = step.stripped ? node.type.create({ ...node.attrs, [NODE_ID_ATTRIBUTE]: null }, node.content) : node;
        tr.delete(posOf(from), posOf(from + 1));
        let pos = 0;
        for (let k = 0; k < to; k += 1) pos += tr.doc.child(k).nodeSize;
        act(tr.insert(pos, moved), [...rest.slice(0, to), model[from], ...rest.slice(to)]);
        break;
      }
      case "split": {
        const at = step.at % count;
        const { text } = model[at];
        if (text.length < 2) return;
        const offset = 1 + (step.offset % (text.length - 1));
        // Without `typesAfter` ProseMirror copies every attribute, the id included.
        const types = step.copyAttrs ? undefined : [{ type: schema.nodes.paragraph, attrs: { [NODE_ID_ATTRIBUTE]: null } }];
        act(tr.split(posOf(at) + 1 + offset, 1, types), [
          ...model.slice(0, at),
          { id: model[at].id, text: text.slice(0, offset) },
          { id: NEW, text: text.slice(offset) },
          ...model.slice(at + 1),
        ]);
        break;
      }
      case "pasteInto": {
        // Two blocks with open ends put into the text of a block: its text is
        // cut at `offset`, and the id must stay with the first piece that is
        // left of it (the tail when nothing is left in front).
        const at = step.at % count;
        const { id, text } = model[at];
        const offset = step.offset % (text.length + 1);
        const [one, two] = [`q${(counter += 1)}`, `q${(counter += 1)}`];
        const pasted = [one, two].map((value) =>
          schema.nodes.paragraph.create({ [NODE_ID_ATTRIBUTE]: idFor(step.carried, step.pick) }, schema.text(value)),
        );
        const pos = posOf(at) + 1 + offset;
        act(tr.replace(pos, pos, new Slice(Fragment.from(pasted), 1, 1)), [
          ...model.slice(0, at),
          { id: offset === 0 ? NEW : id, text: text.slice(0, offset) + one },
          { id: offset === 0 ? id : NEW, text: two + text.slice(offset) },
          ...model.slice(at + 1),
        ]);
        break;
      }
      case "join": {
        if (count < 2) return;
        const at = 1 + (step.at % (count - 1));
        removedIds.push(model[at].id as string);
        act(tr.join(posOf(at)), [
          ...model.slice(0, at - 1),
          { id: model[at - 1].id, text: model[at - 1].text + model[at].text },
          ...model.slice(at + 1),
        ]);
        break;
      }
      case "type": {
        const at = step.at % count;
        act(tr.insertText("x", posOf(at + 1) - 1), model.map((entry, i) => (i === at ? { ...entry, text: `${entry.text}x` } : entry)));
        break;
      }
      case "pasteOutside": {
        // Whole blocks from another document or an earlier draft, through what
        // the editor does to a pasted or dropped slice. Even a block identical
        // to one removed earlier, with its id, is a new block here.
        const at = step.at % (count + 1);
        const id = idFor(step.carried, step.pick);
        const texts = Array.from({ length: step.blocks }, () => `o${(counter += 1)}`);
        const removedText = typeof id === "string" ? removedTexts.get(id) : undefined;
        if (step.sameText && removedText !== undefined) texts[0] = removedText;
        const nodes = texts.map((value) => schema.nodes.paragraph.create({ [NODE_ID_ATTRIBUTE]: id }, schema.text(value)));
        let slice = new Slice(Fragment.from(nodes), 0, 0);
        for (const plugin of editor.state.plugins) {
          const transform = plugin.props.transformPasted;
          if (transform) slice = transform.call(plugin, slice, editor.view as never, false);
        }
        act(tr.replace(posOf(at), posOf(at), slice), [
          ...model.slice(0, at),
          ...texts.map((text): Entry => ({ id: NEW, text })),
          ...model.slice(at),
        ]);
        break;
      }
      case "reload": {
        // What LocalDocument does with a stored document: the same ids come
        // back, and nothing before the load can be undone or restored.
        const result = tiptapToCanonical(editor.getJSON());
        if (!result.ok) throw new Error(`step ${n}: no canonical form`);
        startFreshHistory(editor.view, "keep");
        expect(replaceWithStoredDocument(editor.view, result.doc), `step ${n}`).toEqual({ ok: true });
        past.length = 0;
        future = [];
        break;
      }
      case "undo": {
        const previous = past.pop();
        if (!previous) return;
        future.push(model);
        model = previous;
        editor.commands.undo();
        break;
      }
      case "redo": {
        const following = future.pop();
        if (!following) return;
        past.push(model);
        model = following;
        editor.commands.redo();
        break;
      }
    }
    check(`step ${n} (${step.kind})`);
  });
}

describe("block identity under arbitrary editing", () => {
  it("every block holds the id the model expects after every step", () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 40 }), run));
  });
});
