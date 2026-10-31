/**
 * One paragraph of a block quote (E1 part 2, #823, contract
 * issuecomment-6412639687).
 *
 * A flat text block of the same level as a paragraph, never a wrapper, like
 * the bullet item (`bullet-item.ts`): consecutive quote paragraphs are one
 * block quote on screen. Tiptap's `Blockquote` wraps paragraphs, which the
 * canonical model, the edit steps and the replayer do not allow (schema.ts).
 *
 * Keys: Mod-Shift-b turns the block into a quote and back; "> " at the start
 * of a block makes it a quote. Enter and Backspace work as in a bullet item
 * (`text-block.ts`). A quote holds neither a list nor a heading.
 *
 * Pasted HTML: `blockquote`, or each paragraph of it, becomes a quote; an
 * item of a list inside it stays an item (the bullet item's rule comes
 * first).
 */

import { InputRule, Node, type Editor } from "@tiptap/core";
import type { NodeType } from "@tiptap/pm/model";
import { PluginKey, type Transaction } from "@tiptap/pm/state";

import { markerRemoval, markerToBlock, textBlockBackspace, textBlockEnter } from "./text-block";

export const QUOTE = "quote";

/** How the editor writes a quote paragraph into its own HTML (and reads it back). */
export const QUOTE_HTML_ATTRIBUTE = "data-block";
export const QUOTE_HTML_VALUE = "quote";

/** Children that make a pasted `blockquote` a holder of blocks, read through them. */
const BLOCK_CHILDREN = ":scope > p, :scope > div, :scope > ul, :scope > ol, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6";

const markerKey = new PluginKey<null>("quoteMarker");

export const Quote = Node.create({
  name: QUOTE,
  group: "block",
  content: "inline*",

  parseHTML() {
    return [
      { tag: `p[${QUOTE_HTML_ATTRIBUTE}="${QUOTE_HTML_VALUE}"]`, priority: 60 },
      { tag: "blockquote", getAttrs: (element) => (element.querySelector(BLOCK_CHILDREN) ? false : null) },
      { tag: "blockquote > p", priority: 60 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", { ...HTMLAttributes, [QUOTE_HTML_ATTRIBUTE]: QUOTE_HTML_VALUE }, 0];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => this.editor.commands.toggleNode(this.name, "paragraph"),
      Enter: () => quoteEnter(this.editor),
      Backspace: () => quoteBackspace(this.editor),
    };
  },

  addProseMirrorPlugins() {
    return [markerRemoval(markerKey)];
  },

  addInputRules() {
    return [
      new InputRule({
        find: QUOTE_MARKER,
        handler: ({ state, range }) => (markerToQuote(state.tr, range.from, range.to, this.type) ? undefined : null),
      }),
    ];
  },
});

/** "> " typed at the start of a block. */
export const QUOTE_MARKER = /^\s*>\s$/;

/** Enter in a quote paragraph (`textBlockEnter`). */
export function quoteEnter(editor: Editor): boolean {
  return textBlockEnter(editor, QUOTE);
}

/** Backspace at the start of a quote paragraph (`textBlockBackspace`). */
export function quoteBackspace(editor: Editor): boolean {
  return textBlockBackspace(editor, QUOTE);
}

/** The input rule's change for "> " (`markerToBlock`). */
export function markerToQuote(tr: Transaction, from: number, to: number, quote: NodeType): boolean {
  return markerToBlock(tr, from, to, quote, markerKey);
}
