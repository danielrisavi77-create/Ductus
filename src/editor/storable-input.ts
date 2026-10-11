/**
 * The editor never holds text the journal would store differently
 * (#206 Codex r4240240763, closed in #214).
 *
 * The saver journals `storableDocument(doc)`: a lone surrogate becomes U+FFFD
 * and U+0000 is dropped (`storable-text.ts`). Text holding either, from paste,
 * drop or any other input, is made storable in the editor itself, in the same
 * update, so "Spremljeno na uređaju" always describes exactly what is shown
 * and a reload gives the same text back.
 *
 * Only the text blocks a change touched are read, whole: a delete or split
 * at the edge of a run, or a mark added over half a pair, leaves the other
 * half just outside the step's own range (#251 review 6109174031). Typing in
 * a long document still costs nothing beyond the edited block. Node ids are
 * left to the identity plugin: replacing text inside a block keeps the block
 * and its id.
 *
 * Only the offending code units are replaced, never the whole run: the caret
 * and every position outside them map through unchanged, so typing goes on
 * where it was.
 *
 * More than `MAX_REPAIR_STEPS` offending runs, as a paste can bring, are
 * repaired with one step from the first run to the last (F-067): each step
 * rebuilds the blocks above it and the transaction keeps every intermediate
 * document, so one step per run grows as runs times document size. Blocks,
 * their ids, marks and text between the runs are kept; a caret inside that
 * range moves to its end.
 */

import { Extension } from "@tiptap/core";
import { Fragment, type Node as PmNode, type Schema, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";

import { storableText } from "./storable-text";

const storableInputKey = new PluginKey("storableInput");

// A run of code units `storableText` would change. With the `u` flag a valid
// pair is one code point outside the class, so it never joins a run, and the
// run's own repair equals the repair of the whole text at that place.
const UNSTORABLE_RUN = /[\uD800-\uDFFF\u0000]+/gu;

// Up to this many runs are repaired one step each; above it they get a single
// step (F-067).
const MAX_REPAIR_STEPS = 8;

type Run = { from: number; to: number; text: string; node: PmNode };

/** The runs of one text block `storableText` would change, in order. */
function runsOf(block: PmNode, start: number): Run[] {
  const runs: Run[] = [];
  block.forEach((node, offset) => {
    if (!node.isText) return;
    for (const run of node.text!.matchAll(UNSTORABLE_RUN)) {
      const from = start + offset + run.index;
      runs.push({ from, to: from + run[0].length, text: storableText(run[0]), node });
    }
  });
  return runs;
}

/** `content` with every text node, at any depth, made storable and emptied ones dropped. */
function storableContent(content: Fragment, schema: Schema): Fragment {
  const nodes: PmNode[] = [];
  content.forEach((node) => {
    if (!node.isText) return void nodes.push(node.isLeaf ? node : node.copy(storableContent(node.content, schema)));
    const text = storableText(node.text!);
    if (text !== "") nodes.push(schema.text(text, node.marks));
  });
  return Fragment.fromArray(nodes);
}

/**
 * Ranges of `doc` (the state after `transactions`) that they changed, each
 * widened to the whole text blocks at its ends. Mark steps map no positions,
 * so their own from/to is taken.
 */
function changedRanges(transactions: readonly Transaction[], doc: PmNode): [number, number][] {
  let ranges: [number, number][] = [];
  for (const tr of transactions) {
    ranges = ranges.map(([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)]);
    tr.steps.forEach((step, index) => {
      const after = tr.mapping.slice(index + 1);
      const add = (from: number, to: number) => ranges.push([after.map(from, -1), after.map(to, 1)]);
      tr.mapping.maps[index]!.forEach((_oldFrom, _oldTo, from, to) => add(from, to));
      if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) add(step.from, step.to);
    });
  }
  const size = doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  return ranges.map(([from, to]) => {
    const $from = doc.resolve(clamp(from));
    const $to = doc.resolve(clamp(Math.max(from, to)));
    return [
      $from.parent.isTextblock ? $from.start() : $from.pos,
      $to.parent.isTextblock ? $to.end() : $to.pos,
    ];
  });
}

export function createStorableInputPlugin(): Plugin {
  return new Plugin({
    key: storableInputKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const blocks = new Map<number, Run[]>();
      for (const [from, to] of changedRanges(transactions, newState.doc)) {
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return true;
          if (!blocks.has(pos)) blocks.set(pos, runsOf(node, pos + 1));
          return false;
        });
      }
      const runs = [...blocks.values()].flat().sort((a, b) => a.from - b.from);
      if (runs.length === 0) return null;
      const tr = newState.tr;
      if (runs.length > MAX_REPAIR_STEPS) {
        const from = runs[0]!.from;
        const to = runs[runs.length - 1]!.to;
        const slice = newState.doc.slice(from, to);
        tr.replace(from, to, new Slice(storableContent(slice.content, newState.schema), slice.openStart, slice.openEnd));
        return tr;
      }
      // From the end, so earlier positions stay valid.
      for (const { from, to, text, node } of runs.reverse()) {
        if (text === "") tr.delete(from, to);
        else tr.replaceWith(from, to, newState.schema.text(text, node.marks));
      }
      return tr;
    },
  });
}

export const StorableInput = Extension.create({
  name: "storableInput",

  addProseMirrorPlugins() {
    return [createStorableInputPlugin()];
  },
});
