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
 */

import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform";

import { storableText } from "./storable-text";

const storableInputKey = new PluginKey("storableInput");

// A run of code units `storableText` would change. With the `u` flag a valid
// pair is one code point outside the class, so it never joins a run, and the
// run's own repair equals the repair of the whole text at that place.
const UNSTORABLE_RUN = /[\uD800-\uDFFF\u0000]+/gu;

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
      const fixes = new Map<number, { to: number; text: string; node: PmNode }>();
      for (const [from, to] of changedRanges(transactions, newState.doc)) {
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return true;
          for (const run of node.text!.matchAll(UNSTORABLE_RUN)) {
            const start = pos + run.index;
            fixes.set(start, { to: start + run[0].length, text: storableText(run[0]), node });
          }
          return false;
        });
      }
      if (fixes.size === 0) return null;
      const tr = newState.tr;
      // From the end, so earlier positions stay valid.
      for (const from of [...fixes.keys()].sort((a, b) => b - a)) {
        const { to, text, node } = fixes.get(from)!;
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
