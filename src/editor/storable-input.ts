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
 * Only the ranges a change touched are read, so typing in a long document
 * costs nothing beyond the edited block. Node ids are left to the identity
 * plugin: replacing text inside a block keeps the block and its id.
 */

import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import { storableText } from "./storable-text";

const storableInputKey = new PluginKey("storableInput");

/** Ranges of `doc` (the state after `transactions`) that they changed. */
function changedRanges(transactions: readonly Transaction[], doc: PmNode): [number, number][] {
  let ranges: [number, number][] = [];
  for (const tr of transactions) {
    ranges = ranges.map(([from, to]) => [tr.mapping.map(from, -1), tr.mapping.map(to, 1)]);
    tr.mapping.maps.forEach((map, index) => {
      const after = tr.mapping.slice(index + 1);
      map.forEach((_oldFrom, _oldTo, from, to) => {
        ranges.push([after.map(from, -1), after.map(to, 1)]);
      });
    });
  }
  const size = doc.content.size;
  return ranges.map(([from, to]) => [Math.max(0, Math.min(from, size)), Math.max(0, Math.min(to, size))]);
}

export function createStorableInputPlugin(): Plugin {
  return new Plugin({
    key: storableInputKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const fixes = new Map<number, PmNode>();
      for (const [from, to] of changedRanges(transactions, newState.doc)) {
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (node.isText && storableText(node.text!) !== node.text) fixes.set(pos, node);
          return !node.isText;
        });
      }
      if (fixes.size === 0) return null;
      const tr = newState.tr;
      // From the end, so earlier positions stay valid.
      for (const pos of [...fixes.keys()].sort((a, b) => b - a)) {
        const node = fixes.get(pos)!;
        const text = storableText(node.text!);
        if (text === "") tr.delete(pos, pos + node.nodeSize);
        else tr.replaceWith(pos, pos + node.nodeSize, newState.schema.text(text, node.marks));
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
