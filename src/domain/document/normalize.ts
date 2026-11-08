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
 * A v2 citation is an atom: kept as it is, never merged across, and the
 * sources are carried over unchanged (contract §9.1).
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION_V2,
  canonicalMarks,
  citationNode,
  newNodeId,
  paragraphNode,
  type CanonicalDocument,
  type CanonicalDocumentV2,
  type DocumentNodeV2,
  type InlineNodeV2,
  type Mark,
  type VersionedDocument,
} from "./schema";

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

function normalizeChildren(children: readonly InlineNodeV2[]): InlineNodeV2[] {
  const result: InlineNodeV2[] = [];

  for (const child of children) {
    if (child.type === "citation") {
      result.push(citationNode(child.sourceId, child.locator));
      continue;
    }
    if (child.text.length === 0) {
      continue;
    }
    const marks = canonicalMarks(child.marks);
    const previous = result[result.length - 1];
    if (previous?.type === "text" && sameMarks(previous.marks, marks)) {
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

function normalizeNode(node: DocumentNodeV2): DocumentNodeV2 {
  const children = normalizeChildren(node.children);
  // A heading never holds a citation (contract §3.1), so its children stay text.
  return node.type === "heading"
    ? { type: "heading", id: node.id, level: node.level, children: children as HeadingChildren }
    : { type: node.type, id: node.id, children };
}

type HeadingChildren = Extract<DocumentNodeV2, { type: "heading" }>["children"];

/**
 * Returns a new document; `doc` is never mutated.
 *
 * `uuidFn` is only consulted in the degenerate case of a document that
 * arrived with no block nodes at all (a type-level impossibility, but a
 * runtime possibility for data coming back from storage): the invariant is
 * restored with one empty paragraph.
 */
export function normalizeDocument(doc: CanonicalDocument, uuidFn?: () => string): CanonicalDocument;
export function normalizeDocument(doc: CanonicalDocumentV2, uuidFn?: () => string): CanonicalDocumentV2;
export function normalizeDocument(doc: VersionedDocument, uuidFn?: () => string): VersionedDocument;
export function normalizeDocument(doc: VersionedDocument, uuidFn?: () => string): VersionedDocument {
  const normalized = (doc.nodes as readonly DocumentNodeV2[]).map(normalizeNode);
  const nodes = normalized.length === 0 ? [paragraphNode(newNodeId(uuidFn))] : normalized;

  if (doc.schemaVersion === DOCUMENT_SCHEMA_VERSION_V2) {
    return { schemaVersion: DOCUMENT_SCHEMA_VERSION_V2, nodes, sources: structuredClone(doc.sources) };
  }
  // Without a citation in its input, a v1 node normalizes to a v1 node.
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes: nodes as CanonicalDocument["nodes"] };
}
