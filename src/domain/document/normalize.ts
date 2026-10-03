/**
 * Canonical normalisation. Pure, total and idempotent:
 * `normalizeDocument(normalizeDocument(d))` is structurally equal to
 * `normalizeDocument(d)` for every document.
 *
 * Normalisation is an explicit step, never something validation does behind
 * the author's back. It only ever changes the *encoding* of the text, never
 * the text itself or a node's identity:
 *   - marks deduplicated and sorted into canonical order,
 *   - adjacent text nodes with identical marks merged,
 *   - empty text nodes dropped,
 *   - the "at least one block node" invariant preserved.
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  canonicalMarks,
  newNodeId,
  paragraphNode,
  type CanonicalDocument,
  type DocumentNode,
  type InlineNode,
  type Mark,
} from "./schema";

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

function normalizeChildren(children: readonly InlineNode[]): InlineNode[] {
  const result: InlineNode[] = [];

  for (const child of children) {
    if (child.text.length === 0) {
      continue;
    }
    const marks = canonicalMarks(child.marks);
    const previous = result[result.length - 1];
    if (previous && sameMarks(previous.marks, marks)) {
      result[result.length - 1] = {
        type: "text",
        text: previous.text + child.text,
        marks: previous.marks,
      };
      continue;
    }
    result.push({ type: "text", text: child.text, marks });
  }

  return result;
}

function normalizeNode(node: DocumentNode): DocumentNode {
  const children = normalizeChildren(node.children);
  return node.type === "heading"
    ? { type: "heading", id: node.id, level: node.level, children }
    : { type: "paragraph", id: node.id, children };
}

/**
 * Returns a new document; `doc` is never mutated.
 *
 * `uuidFn` is only consulted in the degenerate case of a document that
 * arrived with no block nodes at all (a type-level impossibility, but a
 * runtime possibility for data coming back from storage): the invariant is
 * restored with one empty paragraph.
 */
export function normalizeDocument(
  doc: CanonicalDocument,
  uuidFn?: () => string,
): CanonicalDocument {
  const nodes = doc.nodes.map(normalizeNode);

  if (nodes.length === 0) {
    return {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      nodes: [paragraphNode(newNodeId(uuidFn))],
    };
  }

  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}
