/**
 * Text the canonical boundary cannot store, removed before it is journalled
 * (#131, plan #197 attack 10).
 *
 * `validateDocument` accepts a lone UTF-16 surrogate and U+0000, but JCS
 * (B-8) rejects the first and PostgreSQL `jsonb` the second. A row holding
 * either would sit in the queue as LOCAL_DURABLE and be refused by the server
 * for ever. Both can only arrive by paste or from a broken source, never as
 * readable text, so they are made explicit before saving: a lone surrogate
 * becomes U+FFFD (the visible replacement character), U+0000 is dropped.
 */

import {
  normalizeDocument,
  type CanonicalDocument,
  type DocumentNode,
} from "../domain/document";

// With the `u` flag a valid pair is one code point outside this range, so the
// class matches only surrogates that stand alone.
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;
const UNSTORABLE = /[\uD800-\uDFFF\u0000]/u;

/** The same text with lone surrogates replaced and NUL removed. */
export function storableText(text: string): string {
  if (!UNSTORABLE.test(text)) return text;
  return text.replace(LONE_SURROGATE, "\uFFFD").replaceAll("\u0000", "");
}

/**
 * The document with every text run made storable. Returns `doc` itself when
 * nothing changed; otherwise a normalised copy (a run that held only NUL is
 * dropped, so the empty-text invariant still holds). Node ids are kept.
 */
export function storableDocument(doc: CanonicalDocument): CanonicalDocument {
  let changed = false;
  const nodes = doc.nodes.map((node): DocumentNode => {
    const children = node.children.map((child) => {
      const text = storableText(child.text);
      if (text === child.text) return child;
      changed = true;
      return { ...child, text };
    });
    return { ...node, children };
  });
  return changed ? normalizeDocument({ ...doc, nodes }) : doc;
}
