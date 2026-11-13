/**
 * Canonical document v2 ↔ Tiptap JSON (DAN-620 a). The v1 projection
 * (`interop.ts`) with two additions: a block other than a heading holds
 * citations, and the document node carries the list of sources in its
 * `sources` attribute (`DocumentV2` in `schema.ts`).
 *
 * What the v1 projection repairs, this one repairs the same way (a block id
 * missing or held twice is minted anew). A citation is never repaired: a
 * marked citation, an unknown attribute or an invalid value is reported, and
 * `validateVersionedDocument` stays the last gate. A citation whose source is
 * not in the list (an orphan) is valid (contract §3.1).
 *
 * Like `interop.ts`, this module does not import Tiptap.
 */

import {
  DOCUMENT_SCHEMA_VERSION_V2,
  normalizeDocument,
  validateVersionedDocument,
  type CanonicalDocumentV2,
  type CitationNode,
  type DocumentNodeV2,
  type InlineNodeV2,
  type SourceId,
} from "../domain/document";
import { isPlainObject } from "../domain/json";
import {
  defaultIdFactory,
  inlineToTiptap,
  NODE_ID_ATTRIBUTE,
  projectInline,
  projectTiptapBlocks,
  type IdFactory,
  type InteropError,
  type TiptapNodeJSON,
} from "./interop";

/** The shape `editor.getJSON()` returns for a v2 document. */
export type TiptapDocumentJSONV2 = {
  type: "doc";
  attrs: { sources: CanonicalDocumentV2["sources"] };
  content: TiptapNodeJSON[];
};

export type CanonicalCandidateV2 =
  | { ok: true; doc: CanonicalDocumentV2 }
  | { ok: false; errors: InteropError[] };

const CITATION_KEYS = new Set(["type", "attrs", "marks"]);
const CITATION_ATTRS = new Set(["sourceId", "locator"]);

/* ------------------------------------------------------- canonical → tiptap */

function citationToTiptap(citation: CitationNode): TiptapNodeJSON {
  return { type: "citation", attrs: { sourceId: citation.sourceId, locator: citation.locator ?? null } };
}

function nodeToTiptapV2(node: DocumentNodeV2): TiptapNodeJSON {
  const attrs: Record<string, unknown> =
    node.type === "heading" ? { [NODE_ID_ATTRIBUTE]: node.id, level: node.level } : { [NODE_ID_ATTRIBUTE]: node.id };
  const children: readonly InlineNodeV2[] = node.children;
  // As in v1: an empty textblock has no `content`, like Tiptap's `getJSON()`.
  return children.length === 0
    ? { type: node.type, attrs }
    : {
        type: node.type,
        attrs,
        content: children.map((child) => (child.type === "citation" ? citationToTiptap(child) : inlineToTiptap(child))),
      };
}

/** Projects a v2 document onto Tiptap JSON. Total: cannot fail. */
export function canonicalToTiptapV2(doc: CanonicalDocumentV2): TiptapDocumentJSONV2 {
  return { type: "doc", attrs: { sources: structuredClone(doc.sources) }, content: doc.nodes.map(nodeToTiptapV2) };
}

/* ------------------------------------------------------- tiptap → canonical */

/**
 * One citation, or null with an error. The values of `sourceId` and `locator`
 * pass through unchecked: the domain validator reports them with its own
 * codes, as it would for a stored document.
 */
function projectCitation(raw: Record<string, unknown>, path: string, errors: InteropError[]): CitationNode | null {
  if (Object.keys(raw).some((key) => !CITATION_KEYS.has(key))) {
    errors.push({ path, code: "TIPTAP_CITATION_INVALID" });
    return null;
  }
  if (raw.marks !== undefined && !(Array.isArray(raw.marks) && raw.marks.length === 0)) {
    errors.push({ path: `${path}.marks`, code: "TIPTAP_CITATION_MARKED" });
    return null;
  }
  const attrs = raw.attrs;
  if (!isPlainObject(attrs) || Object.keys(attrs).some((key) => !CITATION_ATTRS.has(key))) {
    errors.push({ path: `${path}.attrs`, code: "TIPTAP_CITATION_INVALID" });
    return null;
  }
  const sourceId = attrs.sourceId as SourceId;
  return attrs.locator === null || attrs.locator === undefined
    ? { type: "citation", sourceId }
    : { type: "citation", sourceId, locator: attrs.locator as string };
}

function projectInlineV2(raw: unknown, path: string, errors: InteropError[]): InlineNodeV2 | null {
  return isPlainObject(raw) && raw.type === "citation" ? projectCitation(raw, path, errors) : projectInline(raw, path, errors);
}

/**
 * Projects Tiptap JSON of the v2 editor back onto a v2 document: projection,
 * then `normalizeDocument`, then `validateVersionedDocument`. A document node
 * without `sources` holds none; one with anything but an array is refused.
 */
export function tiptapToCanonicalV2(
  json: unknown,
  idFor: IdFactory = defaultIdFactory,
  uuidFn?: () => string,
): CanonicalCandidateV2 {
  const projected = projectTiptapBlocks(json, idFor, projectInlineV2);
  if (Array.isArray(projected)) return { ok: false, errors: projected };

  const root = json as Record<string, unknown>;
  const errors = [...projected.errors];
  let sources: unknown = [];
  if (root.attrs !== undefined) {
    if (!isPlainObject(root.attrs)) {
      errors.push({ path: "$.attrs", code: "TIPTAP_ATTRS_NOT_OBJECT" });
    } else if (root.attrs.sources !== undefined) {
      sources = root.attrs.sources;
      if (!Array.isArray(sources)) errors.push({ path: "$.attrs.sources", code: "SOURCES_NOT_ARRAY" });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const normalized = normalizeDocument(
    {
      schemaVersion: DOCUMENT_SCHEMA_VERSION_V2,
      nodes: projected.nodes as DocumentNodeV2[],
      sources: sources as CanonicalDocumentV2["sources"],
    },
    uuidFn,
  );
  const validated = validateVersionedDocument(normalized);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  return { ok: true, doc: validated.doc as CanonicalDocumentV2 };
}
