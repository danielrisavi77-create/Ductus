/**
 * Structural validation of an untrusted canonical document.
 *
 * Input may come from the network, from IndexedDB or from an older client, so
 * nothing is trusted: unknown fields are rejected rather than ignored, and the
 * returned document is a fresh copy built only from known fields, so a caller
 * cannot later mutate the validated value through the untrusted reference.
 *
 * Validation never repairs. Anything repairable (mark order, adjacent text
 * runs with identical marks) is reported so the caller can decide to run
 * `normalizeDocument` explicitly — a silent rewrite of an author's document
 * is exactly what this kernel must not do.
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  isHeadingLevel,
  isMark,
  isNodeId,
  marksAreCanonical,
  type CanonicalDocument,
  type DocumentNode,
  type InlineNode,
  type HeadingLevel,
  type Mark,
  type NodeId,
} from "./schema";
import { isPlainObject } from "../json";

/** Stable error codes. Never renamed without a schema version bump. */
export const VALIDATION_ERROR_CODES = [
  "DOCUMENT_NOT_OBJECT",
  "SCHEMA_VERSION_INVALID",
  "UNKNOWN_FIELD",
  "NODES_NOT_ARRAY",
  "NODES_EMPTY",
  "NODE_NOT_OBJECT",
  "NODE_TYPE_INVALID",
  "NODE_ID_INVALID",
  "NODE_ID_DUPLICATE",
  "HEADING_LEVEL_INVALID",
  "CHILDREN_NOT_ARRAY",
  "INLINE_NOT_OBJECT",
  "INLINE_TYPE_INVALID",
  "TEXT_NOT_STRING",
  "TEXT_EMPTY",
  "MARKS_NOT_ARRAY",
  "MARK_INVALID",
  "MARKS_DUPLICATE",
  "MARKS_UNSORTED",
  "ADJACENT_TEXT_SAME_MARKS",
] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** `path` is a JSON-pointer-ish locator such as `$.nodes[0].children[1].text`. */
export type ValidationError = { path: string; code: ValidationErrorCode };

export type ValidationOutcome =
  | { ok: true; doc: CanonicalDocument }
  | { ok: false; errors: ValidationError[] };

const DOCUMENT_FIELDS = new Set(["schemaVersion", "nodes"]);
const PARAGRAPH_FIELDS = new Set(["type", "id", "children"]);
const HEADING_FIELDS = new Set(["type", "id", "level", "children"]);
const INLINE_FIELDS = new Set(["type", "text", "marks"]);

function checkUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  errors: ValidationError[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push({ path: `${path}.${key}`, code: "UNKNOWN_FIELD" });
    }
  }
}

/**
 * Validates `doc`. Errors are collected (not fail-fast) so a caller can report
 * everything wrong with a payload in one pass.
 */
export function validateDocument(doc: unknown): ValidationOutcome {
  const errors: ValidationError[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: [{ path: "$", code: "DOCUMENT_NOT_OBJECT" }] };
  }

  checkUnknownFields(doc, DOCUMENT_FIELDS, "$", errors);

  if (doc.schemaVersion !== DOCUMENT_SCHEMA_VERSION) {
    errors.push({ path: "$.schemaVersion", code: "SCHEMA_VERSION_INVALID" });
  }

  if (!Array.isArray(doc.nodes)) {
    errors.push({ path: "$.nodes", code: "NODES_NOT_ARRAY" });
    return { ok: false, errors };
  }

  if (doc.nodes.length === 0) {
    errors.push({ path: "$.nodes", code: "NODES_EMPTY" });
  }

  const seenIds = new Set<string>();
  const nodes: DocumentNode[] = [];

  doc.nodes.forEach((rawNode, index) => {
    const node = validateNode(rawNode, `$.nodes[${index}]`, seenIds, errors);
    if (node) {
      nodes.push(node);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, doc: { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes } };
}

function validateNode(
  raw: unknown,
  path: string,
  seenIds: Set<string>,
  errors: ValidationError[],
): DocumentNode | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "NODE_NOT_OBJECT" });
    return null;
  }

  const type = raw.type;
  if (type !== "paragraph" && type !== "heading") {
    errors.push({ path: `${path}.type`, code: "NODE_TYPE_INVALID" });
    return null;
  }

  checkUnknownFields(
    raw,
    type === "heading" ? HEADING_FIELDS : PARAGRAPH_FIELDS,
    path,
    errors,
  );

  let nodeOk = true;
  let id: NodeId | null = null;
  if (!isNodeId(raw.id)) {
    errors.push({ path: `${path}.id`, code: "NODE_ID_INVALID" });
    nodeOk = false;
  } else if (seenIds.has(raw.id)) {
    errors.push({ path: `${path}.id`, code: "NODE_ID_DUPLICATE" });
    nodeOk = false;
  } else {
    seenIds.add(raw.id);
    id = raw.id;
  }

  let level: HeadingLevel = 1;
  if (type === "heading") {
    if (!isHeadingLevel(raw.level)) {
      errors.push({ path: `${path}.level`, code: "HEADING_LEVEL_INVALID" });
      nodeOk = false;
    } else {
      level = raw.level;
    }
  }

  if (!Array.isArray(raw.children)) {
    errors.push({ path: `${path}.children`, code: "CHILDREN_NOT_ARRAY" });
    return null;
  }

  const children: InlineNode[] = [];
  raw.children.forEach((rawChild, index) => {
    const child = validateInline(rawChild, `${path}.children[${index}]`, errors);
    if (child) {
      const previous = children[children.length - 1];
      if (previous && sameMarks(previous.marks, child.marks)) {
        errors.push({
          path: `${path}.children[${index}]`,
          code: "ADJACENT_TEXT_SAME_MARKS",
        });
      }
      children.push(child);
    }
  });

  if (!nodeOk || id === null) {
    return null;
  }

  return type === "heading"
    ? { type: "heading", id, level, children }
    : { type: "paragraph", id, children };
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i]);
}

function validateInline(
  raw: unknown,
  path: string,
  errors: ValidationError[],
): InlineNode | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "INLINE_NOT_OBJECT" });
    return null;
  }

  if (raw.type !== "text") {
    errors.push({ path: `${path}.type`, code: "INLINE_TYPE_INVALID" });
    return null;
  }

  checkUnknownFields(raw, INLINE_FIELDS, path, errors);

  let ok = true;

  if (typeof raw.text !== "string") {
    errors.push({ path: `${path}.text`, code: "TEXT_NOT_STRING" });
    ok = false;
  } else if (raw.text.length === 0) {
    errors.push({ path: `${path}.text`, code: "TEXT_EMPTY" });
    ok = false;
  }

  if (!Array.isArray(raw.marks)) {
    errors.push({ path: `${path}.marks`, code: "MARKS_NOT_ARRAY" });
    return null;
  }

  const marks: Mark[] = [];
  raw.marks.forEach((rawMark, index) => {
    if (!isMark(rawMark)) {
      errors.push({ path: `${path}.marks[${index}]`, code: "MARK_INVALID" });
      ok = false;
      return;
    }
    if (marks.includes(rawMark)) {
      errors.push({ path: `${path}.marks[${index}]`, code: "MARKS_DUPLICATE" });
      ok = false;
      return;
    }
    marks.push(rawMark);
  });

  if (ok && !marksAreCanonical(marks)) {
    errors.push({ path: `${path}.marks`, code: "MARKS_UNSORTED" });
    ok = false;
  }

  if (!ok) {
    return null;
  }

  return { type: "text", text: raw.text as string, marks };
}
