/**
 * Numbered headings and the table of contents (M5.3-P02, DAN-395).
 *
 * The number of a heading is read from the one chapter projection,
 * `deriveChapters`, over the document the editor holds; nothing here numbers
 * headings a second way. The number is a node decoration, never text in the
 * document: it is not in the edit steps, the schema, the clipboard or the
 * evidence, and the student never types it. The default numbering is the
 * neutral one (D-229), no claim about the FPZG form (O5).
 *
 * A link from the table of contents names a block id and looks the block up
 * when it is followed (`blockPosition`), so it reaches the right heading after
 * a move, an undo or a redo.
 */

import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import {
  deriveChapters,
  DOCUMENT_SCHEMA_VERSION,
  type CanonicalDocument,
  type DocumentNode,
  type NodeId,
} from "../domain/document";

import { NODE_ID_ATTRIBUTE } from "./interop";

export type NumberedHeading = {
  /** The block id, or null before the identity plugin minted it. */
  readonly id: string | null;
  readonly level: number;
  /** The label from `deriveChapters`, e.g. "1.1". */
  readonly number: string;
  /** The heading's text, trimmed; "" for an empty heading. */
  readonly title: string;
  /** Document position of the heading node when this was read. */
  readonly pos: number;
};

function blockId(node: PmNode): string | null {
  const id = node.attrs[NODE_ID_ATTRIBUTE];
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Every top-level heading with its number from `deriveChapters`. The editor's
 * document is handed to the projection as it stands: only the type, id, level
 * and text the projection reads, so no full canonical conversion runs per
 * transaction. A block without an id yet gets a key local to this call.
 */
export function numberedHeadings(doc: PmNode): NumberedHeading[] {
  const nodes: DocumentNode[] = [];
  const headings: { id: string | null; pos: number; level: number }[] = [];
  doc.forEach((node, offset, index) => {
    const id = blockId(node) ?? `pending-${index}`;
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level) as 1 | 2 | 3;
      headings.push({ id: blockId(node), pos: offset, level });
      nodes.push({ type: "heading", id: id as NodeId, level, children: [{ text: node.textContent }] } as DocumentNode);
    } else {
      nodes.push({ type: "paragraph", id: id as NodeId, children: [] } as unknown as DocumentNode);
    }
  });
  const outline = deriveChapters({ schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes } as CanonicalDocument);
  // deriveChapters keeps document order, one chapter per heading.
  return outline.chapters.map((chapter, i) => ({
    id: headings[i]!.id,
    level: chapter.level,
    number: chapter.number,
    title: chapter.title,
    pos: headings[i]!.pos,
  }));
}

/** Position of the top-level block with `id` in `doc`, or null. */
export function blockPosition(doc: PmNode, id: string): number | null {
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (found === null && blockId(node) === id) found = offset;
  });
  return found;
}

const chapterNumbersKey = new PluginKey<DecorationSet>("chapterNumbers");

function decorate(doc: PmNode): DecorationSet {
  return DecorationSet.create(
    doc,
    numberedHeadings(doc).map(({ pos, number }) =>
      Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { "data-chapter-number": number }),
    ),
  );
}

/** The decorations the plugin holds for `state`; empty without the plugin. */
export function chapterNumbersOf(state: EditorState): DecorationSet {
  return chapterNumbersKey.getState(state) ?? DecorationSet.empty;
}

export const ChapterNumbers = Extension.create({
  name: "chapterNumbers",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: chapterNumbersKey,
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, previous, _old, state) => (tr.docChanged ? decorate(state.doc) : previous),
        },
        props: {
          decorations: (state) => chapterNumbersKey.getState(state),
        },
      }),
    ];
  },
});
