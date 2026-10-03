/**
 * Structural comparison of canonical documents. Both functions are pure and
 * allocate nothing beyond a few locals, so they are safe on every keystroke
 * batch.
 */

import type { CanonicalDocument, DocumentNode, InlineNode } from "./schema";

function childrenEqual(
  a: readonly InlineNode[],
  b: readonly InlineNode[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((child, i) => {
    const other = b[i];
    return (
      child.type === other.type &&
      child.text === other.text &&
      child.marks.length === other.marks.length &&
      child.marks.every((mark, j) => mark === other.marks[j])
    );
  });
}

function shapeEqual(a: DocumentNode, b: DocumentNode): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === "heading" && b.type === "heading" && a.level !== b.level) {
    return false;
  }
  return childrenEqual(a.children, b.children);
}

/**
 * Full structural equality, node ids included.
 *
 * Ids are canonical identity, not a rendering detail: two documents with the
 * same text in differently identified paragraphs are *not* the same document,
 * because comments, evidence and revisions are anchored to those ids.
 */
export function documentsEqual(
  a: CanonicalDocument,
  b: CanonicalDocument,
): boolean {
  if (a.schemaVersion !== b.schemaVersion || a.nodes.length !== b.nodes.length) {
    return false;
  }
  return a.nodes.every((node, i) => {
    const other = b.nodes[i];
    return node.id === other.id && shapeEqual(node, other);
  });
}

/**
 * Equality ignoring node ids: same block types, levels and inline content in
 * the same order. Used by the conflict UX to tell "the same text was retyped
 * elsewhere" apart from "the text actually diverged"; never used to decide
 * whether a write is needed, because id churn is itself a real change.
 */
export function contentEqual(
  a: CanonicalDocument,
  b: CanonicalDocument,
): boolean {
  if (a.schemaVersion !== b.schemaVersion || a.nodes.length !== b.nodes.length) {
    return false;
  }
  return a.nodes.every((node, i) => shapeEqual(node, b.nodes[i]));
}
