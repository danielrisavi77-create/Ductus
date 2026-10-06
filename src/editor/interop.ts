/**
 * Projection between the canonical document model and Tiptap's JSON.
 *
 * Pure and framework-free on purpose: no React, no Tiptap import at runtime,
 * so every branch is unit-testable in a plain Node environment. The canonical
 * model stays the source of truth — this module only translates.
 *
 * Two laws hold:
 *   1. Round trip: for every *valid* CanonicalDocument `d`,
 *      `tiptapToCanonical(canonicalToTiptap(d))` yields `d` again (up to
 *      normalisation).
 *   2. No silent loss: anything Tiptap hands back that the canonical model
 *      cannot express (an unknown node type, an unknown mark) is reported as
 *      an error. It is never dropped, and never quietly rewritten.
 */

import {
  canonicalMarks,
  isHeadingLevel,
  isMark,
  isNodeId,
  newNodeId,
  normalizeDocument,
  validateDocument,
  DOCUMENT_SCHEMA_VERSION,
  type CanonicalDocument,
  type DocumentNode,
  type HeadingLevel,
  type InlineNode,
  type Mark,
  type NodeId,
  type ValidationErrorCode,
} from "../domain/document";
import { isPlainObject } from "../domain/json";

/**
 * Tiptap attribute that carries the canonical `NodeId` through editing. It is
 * declared here, not in `schema.ts`, so this module stays importable without
 * pulling in Tiptap (and therefore a DOM) at all.
 */
export const NODE_ID_ATTRIBUTE = "nodeId";

/* ------------------------------------------------------------------ types */

export type TiptapMarkJSON = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TiptapNodeJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNodeJSON[];
  marks?: TiptapMarkJSON[];
  text?: string;
};

/** The shape Tiptap's `editor.getJSON()` returns for a whole document. */
export type TiptapDocumentJSON = {
  type: "doc";
  content: TiptapNodeJSON[];
};

/**
 * Interop-level failures: problems visible while reading Tiptap's JSON, before
 * a canonical candidate even exists. Domain-level failures keep their own
 * `ValidationErrorCode`; both travel in the same error list.
 */
export const INTEROP_ERROR_CODES = [
  "TIPTAP_NOT_OBJECT",
  "TIPTAP_ROOT_TYPE_INVALID",
  "TIPTAP_CONTENT_NOT_ARRAY",
  "TIPTAP_NODE_NOT_OBJECT",
  "TIPTAP_UNKNOWN_NODE_TYPE",
  "TIPTAP_ATTRS_NOT_OBJECT",
  "TIPTAP_NODE_ID_INVALID",
  "TIPTAP_HEADING_LEVEL_INVALID",
  "TIPTAP_INLINE_TEXT_NOT_STRING",
  "TIPTAP_MARKS_NOT_ARRAY",
  "TIPTAP_MARK_NOT_OBJECT",
  "TIPTAP_UNKNOWN_MARK",
] as const;

export type InteropErrorCode = (typeof INTEROP_ERROR_CODES)[number];

export type InteropError = {
  path: string;
  code: InteropErrorCode | ValidationErrorCode;
};

/**
 * The result of projecting editor state back onto the canonical model. It is a
 * *candidate*: F1-3a decides whether to journal it, F1-4a whether to commit
 * it. Nothing here writes anywhere.
 */
export type CanonicalCandidate =
  | { ok: true; doc: CanonicalDocument }
  | { ok: false; errors: InteropError[] };

/**
 * Supplies an id for a block that arrived without a usable one. `index` is the
 * block's position in the document, so callers (tests, replay tooling) can be
 * deterministic.
 */
export type IdFactory = (index: number) => NodeId;

const defaultIdFactory: IdFactory = () => newNodeId();

/* ------------------------------------------------------- canonical → tiptap */

function marksToTiptap(marks: readonly Mark[]): TiptapMarkJSON[] | undefined {
  if (marks.length === 0) {
    return undefined;
  }
  return canonicalMarks(marks).map((mark) => ({ type: mark }));
}

function inlineToTiptap(child: InlineNode): TiptapNodeJSON {
  const marks = marksToTiptap(child.marks);
  return marks ? { type: "text", text: child.text, marks } : { type: "text", text: child.text };
}

function nodeToTiptap(node: DocumentNode): TiptapNodeJSON {
  // ProseMirror omits `content` for an empty textblock rather than carrying an
  // empty array, and Tiptap's own `getJSON()` matches that.
  const content =
    node.children.length > 0 ? node.children.map(inlineToTiptap) : undefined;

  const attrs: Record<string, unknown> =
    node.type === "heading"
      ? { [NODE_ID_ATTRIBUTE]: node.id, level: node.level }
      : { [NODE_ID_ATTRIBUTE]: node.id };

  return content
    ? { type: node.type, attrs, content }
    : { type: node.type, attrs };
}

/** Projects the canonical document onto Tiptap JSON. Total: cannot fail. */
export function canonicalToTiptap(doc: CanonicalDocument): TiptapDocumentJSON {
  return { type: "doc", content: doc.nodes.map(nodeToTiptap) };
}

/* ------------------------------------------------------- tiptap → canonical */

type Projection = {
  nodes: DocumentNode[];
  errors: InteropError[];
};

/**
 * Reads the `nodeId` attribute of one block.
 *
 * Three outcomes: a valid, not-yet-seen id is kept; a missing id gets a fresh
 * one; a *duplicated* id also gets a fresh one. The last case is real — Tiptap
 * copies node attributes when a whole block is pasted — and minting there is
 * the only way to keep node identity unique without refusing the author's
 * paste. A malformed id is a different matter: it means someone tampered with
 * the attribute, so it is reported rather than repaired.
 */
function resolveNodeId(
  attrs: Record<string, unknown>,
  index: number,
  seen: Set<string>,
  idFor: IdFactory,
  path: string,
  errors: InteropError[],
): NodeId | null {
  const raw = attrs[NODE_ID_ATTRIBUTE];

  if (raw === undefined || raw === null) {
    return mintUnseen(index, seen, idFor);
  }

  if (!isNodeId(raw)) {
    errors.push({ path: `${path}.attrs.${NODE_ID_ATTRIBUTE}`, code: "TIPTAP_NODE_ID_INVALID" });
    return null;
  }

  if (seen.has(raw)) {
    return mintUnseen(index, seen, idFor);
  }

  seen.add(raw);
  return raw;
}

function mintUnseen(index: number, seen: Set<string>, idFor: IdFactory): NodeId {
  let id = idFor(index);
  // An injected factory may collide with an id already in the document; keep
  // minting rather than emitting a document the domain would reject.
  while (seen.has(id)) {
    id = newNodeId();
  }
  seen.add(id);
  return id;
}

function projectMarks(
  raw: unknown,
  path: string,
  errors: InteropError[],
): Mark[] | null {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push({ path: `${path}.marks`, code: "TIPTAP_MARKS_NOT_ARRAY" });
    return null;
  }

  const marks: Mark[] = [];
  let ok = true;

  raw.forEach((rawMark, index) => {
    const markPath = `${path}.marks[${index}]`;
    if (!isPlainObject(rawMark)) {
      errors.push({ path: markPath, code: "TIPTAP_MARK_NOT_OBJECT" });
      ok = false;
      return;
    }
    if (!isMark(rawMark.type)) {
      // bold/italic are the whole of F1. A strike or a link arriving here is
      // formatting the canonical model cannot hold, so it is an error: silently
      // dropping it would publish a document the author never wrote.
      errors.push({ path: `${markPath}.type`, code: "TIPTAP_UNKNOWN_MARK" });
      ok = false;
      return;
    }
    marks.push(rawMark.type);
  });

  return ok ? canonicalMarks(marks) : null;
}

function projectInline(
  raw: unknown,
  path: string,
  errors: InteropError[],
): InlineNode | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "TIPTAP_NODE_NOT_OBJECT" });
    return null;
  }

  if (raw.type !== "text") {
    errors.push({ path: `${path}.type`, code: "TIPTAP_UNKNOWN_NODE_TYPE" });
    return null;
  }

  if (typeof raw.text !== "string") {
    errors.push({ path: `${path}.text`, code: "TIPTAP_INLINE_TEXT_NOT_STRING" });
    return null;
  }

  const marks = projectMarks(raw.marks, path, errors);
  if (marks === null) {
    return null;
  }

  return { type: "text", text: raw.text, marks };
}

function projectBlock(
  raw: unknown,
  index: number,
  seen: Set<string>,
  idFor: IdFactory,
  errors: InteropError[],
): DocumentNode | null {
  const path = `$.content[${index}]`;

  if (!isPlainObject(raw)) {
    errors.push({ path, code: "TIPTAP_NODE_NOT_OBJECT" });
    return null;
  }

  if (raw.type !== "paragraph" && raw.type !== "heading") {
    errors.push({ path: `${path}.type`, code: "TIPTAP_UNKNOWN_NODE_TYPE" });
    return null;
  }

  let attrs: Record<string, unknown> = {};
  if (raw.attrs !== undefined) {
    if (!isPlainObject(raw.attrs)) {
      errors.push({ path: `${path}.attrs`, code: "TIPTAP_ATTRS_NOT_OBJECT" });
      return null;
    }
    attrs = raw.attrs;
  }

  const id = resolveNodeId(attrs, index, seen, idFor, path, errors);

  let level: HeadingLevel = 1;
  let levelOk = true;
  if (raw.type === "heading") {
    if (!isHeadingLevel(attrs.level)) {
      errors.push({ path: `${path}.attrs.level`, code: "TIPTAP_HEADING_LEVEL_INVALID" });
      levelOk = false;
    } else {
      level = attrs.level;
    }
  }

  const children: InlineNode[] = [];
  if (raw.content !== undefined) {
    if (!Array.isArray(raw.content)) {
      errors.push({ path: `${path}.content`, code: "TIPTAP_CONTENT_NOT_ARRAY" });
      return null;
    }
    raw.content.forEach((rawChild, childIndex) => {
      const child = projectInline(rawChild, `${path}.content[${childIndex}]`, errors);
      if (child) {
        children.push(child);
      }
    });
  }

  if (id === null || !levelOk) {
    return null;
  }

  return raw.type === "heading"
    ? { type: "heading", id, level, children }
    : { type: "paragraph", id, children };
}

function project(json: unknown, idFor: IdFactory): Projection | InteropError[] {
  if (!isPlainObject(json)) {
    return [{ path: "$", code: "TIPTAP_NOT_OBJECT" }];
  }
  if (json.type !== "doc") {
    return [{ path: "$.type", code: "TIPTAP_ROOT_TYPE_INVALID" }];
  }
  if (!Array.isArray(json.content)) {
    return [{ path: "$.content", code: "TIPTAP_CONTENT_NOT_ARRAY" }];
  }

  const errors: InteropError[] = [];
  const seen = new Set<string>();
  const nodes: DocumentNode[] = [];

  json.content.forEach((rawNode, index) => {
    const node = projectBlock(rawNode, index, seen, idFor, errors);
    if (node) {
      nodes.push(node);
    }
  });

  return { nodes, errors };
}

/**
 * Projects Tiptap JSON back onto the canonical model.
 *
 * Normalisation runs *before* validation, and only ever on already-projected
 * canonical nodes: an editing session legitimately produces adjacent text runs
 * with identical marks and empty text runs, which are encoding artefacts, not
 * author intent. `validateDocument` is still the final gate, so nothing leaves
 * this function that the domain would refuse.
 *
 * `idFor` mints ids for blocks Tiptap created without one (a split paragraph,
 * a fresh document). `uuidFn` is only reached in the degenerate "no blocks at
 * all" case that `normalizeDocument` repairs.
 */
export function tiptapToCanonical(
  json: unknown,
  idFor: IdFactory = defaultIdFactory,
  uuidFn?: () => string,
): CanonicalCandidate {
  const projected = project(json, idFor);

  if (Array.isArray(projected)) {
    return { ok: false, errors: projected };
  }
  if (projected.errors.length > 0) {
    return { ok: false, errors: projected.errors };
  }

  const normalized = normalizeDocument(
    { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes: projected.nodes },
    uuidFn,
  );

  const validated = validateDocument(normalized);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }

  return { ok: true, doc: validated.doc };
}

/* --------------------------------------------------------------- counting */

/** Number of block nodes. Never zero for a valid document. */
export function countNodes(doc: CanonicalDocument): number {
  return doc.nodes.length;
}

/**
 * Word count over the canonical text.
 *
 * Whitespace-separated runs, counted per block so a paragraph break never
 * fuses two words. This is a reading aid, never evidence about authorship.
 */
export function countWords(doc: CanonicalDocument): number {
  let total = 0;
  for (const node of doc.nodes) {
    const text = node.children.map((child) => child.text).join("");
    const words = text.split(/\s+/u).filter((word) => word.length > 0);
    total += words.length;
  }
  return total;
}
