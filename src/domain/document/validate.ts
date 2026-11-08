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
  DOCUMENT_BLOCK_TYPES_BY_VERSION,
  DOCUMENT_SCHEMA_VERSION,
  DOCUMENT_SCHEMA_VERSION_V2,
  MAX_CITATION_LOCATOR_CODE_POINTS,
  isAcceptedDocumentSchemaVersion,
  isHeadingLevel,
  isMark,
  isPlainBlockType,
  isNodeId,
  isSourceId,
  marksAreCanonical,
  type CanonicalDocument,
  type CitationNode,
  type DocumentNode,
  type DocumentNodeV2,
  type DocumentSchemaVersion,
  type InlineNode,
  type InlineNodeV2,
  type HeadingLevel,
  type Mark,
  type NodeId,
  type VersionedDocument,
} from "./schema";
import { isAllowedText } from "./forbidden";
import { checkUnknownFields, validateSources } from "./validate-sources";
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
  // Document v2 (docs/contracts/document-schema-v2.md). Appended, never
  // inserted: the codes above keep their meaning and their position.
  "SOURCES_NOT_ARRAY",
  "SOURCES_TOO_MANY",
  "SOURCE_NOT_OBJECT",
  "SOURCE_TYPE_INVALID",
  "SOURCE_FIELD_MISSING",
  "SOURCE_FIELD_INVALID",
  "SOURCE_ID_INVALID",
  "SOURCE_ID_DUPLICATE",
  "SOURCE_YEAR_INVALID",
  "SOURCE_ACCESSED_INVALID",
  "SOURCE_URL_INVALID",
  "AUTHORS_INVALID",
  "EDITORS_INVALID",
  "AUTHOR_INVALID",
  "CITATION_SOURCE_ID_INVALID",
  "CITATION_LOCATOR_INVALID",
  "CITATION_NOT_ALLOWED",
] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

/** `path` is a JSON-pointer-ish locator such as `$.nodes[0].children[1].text`. */
export type ValidationError = { path: string; code: ValidationErrorCode };

export type ValidationOutcome =
  | { ok: true; doc: CanonicalDocument }
  | { ok: false; errors: ValidationError[] };

export type VersionedValidationOutcome =
  | { ok: true; doc: VersionedDocument }
  | { ok: false; errors: ValidationError[] };

/** The top-level keys of each accepted version (contract §1). */
const DOCUMENT_FIELDS: ReadonlyMap<DocumentSchemaVersion, ReadonlySet<string>> = new Map([
  [DOCUMENT_SCHEMA_VERSION, new Set(["schemaVersion", "nodes"])],
  [DOCUMENT_SCHEMA_VERSION_V2, new Set(["schemaVersion", "nodes", "sources"])],
]);
/** Paragraph and every other plain block type (`PLAIN_BLOCK_TYPES`). */
const PARAGRAPH_FIELDS = new Set(["type", "id", "children"]);
const HEADING_FIELDS = new Set(["type", "id", "level", "children"]);
const INLINE_FIELDS = new Set(["type", "text", "marks"]);
const CITATION_FIELDS = new Set(["type", "sourceId", "locator"]);

/**
 * Validates `doc` as a v1 document, the only version the callers of this
 * function read. Any other version, v2 included, is `SCHEMA_VERSION_INVALID`.
 * Errors are collected (not fail-fast) so a caller can report everything
 * wrong with a payload in one pass.
 */
export function validateDocument(doc: unknown): ValidationOutcome {
  return validate(doc, (version) => version === DOCUMENT_SCHEMA_VERSION) as ValidationOutcome;
}

/**
 * Validates `doc` as a document of any accepted version
 * (`DOCUMENT_BLOCK_TYPES_BY_VERSION`): v1 by the rules of v1, v2 with its
 * sources and citations. The version is returned as found, never changed.
 */
export function validateVersionedDocument(doc: unknown): VersionedValidationOutcome {
  return validate(doc, () => true);
}

function validate(
  doc: unknown,
  accepts: (version: DocumentSchemaVersion) => boolean,
): VersionedValidationOutcome {
  const errors: ValidationError[] = [];

  if (!isPlainObject(doc)) {
    return { ok: false, errors: [{ path: "$", code: "DOCUMENT_NOT_OBJECT" }] };
  }

  const accepted =
    isAcceptedDocumentSchemaVersion(doc.schemaVersion) && accepts(doc.schemaVersion)
      ? doc.schemaVersion
      : null;
  // A document of a version the caller does not accept is still read, by the
  // rules of v1, so that every error is reported; the document is refused.
  // `validateDocument` therefore reads a v2 document as v1: its `sources` is
  // also UNKNOWN_FIELD and a citation INLINE_TYPE_INVALID.
  const rules = accepted ?? DOCUMENT_SCHEMA_VERSION;

  checkUnknownFields(doc, DOCUMENT_FIELDS.get(rules)!, "$", errors);

  if (accepted === null) {
    errors.push({ path: "$.schemaVersion", code: "SCHEMA_VERSION_INVALID" });
  }
  const blockTypes = DOCUMENT_BLOCK_TYPES_BY_VERSION.get(rules)!;

  const sources =
    rules === DOCUMENT_SCHEMA_VERSION_V2
      ? validateSources(Object.hasOwn(doc, "sources") ? doc.sources : undefined, errors)
      : [];

  if (!Array.isArray(doc.nodes)) {
    errors.push({ path: "$.nodes", code: "NODES_NOT_ARRAY" });
    return { ok: false, errors };
  }

  if (doc.nodes.length === 0) {
    errors.push({ path: "$.nodes", code: "NODES_EMPTY" });
  }

  const seenIds = new Set<string>();
  const nodes: DocumentNodeV2[] = [];

  // Array.from turns holes into `undefined`, so a sparse array fails validation
  // instead of being skipped by forEach.
  Array.from(doc.nodes).forEach((rawNode, index) => {
    const node = validateNode(rawNode, `$.nodes[${index}]`, blockTypes, rules, seenIds, errors);
    if (node) {
      nodes.push(node);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return rules === DOCUMENT_SCHEMA_VERSION_V2
    ? { ok: true, doc: { schemaVersion: DOCUMENT_SCHEMA_VERSION_V2, nodes, sources } }
    : { ok: true, doc: { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes: nodes as DocumentNode[] } };
}

function validateNode(
  raw: unknown,
  path: string,
  blockTypes: ReadonlySet<string>,
  rules: DocumentSchemaVersion,
  seenIds: Set<string>,
  errors: ValidationError[],
): DocumentNodeV2 | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "NODE_NOT_OBJECT" });
    return null;
  }

  const type = raw.type;
  if (typeof type !== "string" || !blockTypes.has(type) || (type !== "heading" && !isPlainBlockType(type))) {
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
  } else if (seenIds.has(raw.id.toLowerCase())) {
    // UUIDs are case-insensitive: the same id in two cases is a duplicate.
    errors.push({ path: `${path}.id`, code: "NODE_ID_DUPLICATE" });
    nodeOk = false;
  } else {
    seenIds.add(raw.id.toLowerCase());
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

  const children: InlineNodeV2[] = [];
  // The last valid text run. A citation, valid or not, stands between the
  // runs on either side of it, so they are not adjacent (contract §3.1).
  let previous: InlineNode | null = null;
  Array.from(raw.children).forEach((rawChild, index) => {
    const childPath = `${path}.children[${index}]`;
    if (rules === DOCUMENT_SCHEMA_VERSION_V2 && isPlainObject(rawChild) && rawChild.type === "citation") {
      previous = null;
      if (type === "heading") {
        errors.push({ path: childPath, code: "CITATION_NOT_ALLOWED" });
      }
      const citation = validateCitation(rawChild, childPath, errors);
      if (citation) children.push(citation);
      return;
    }
    const child = validateInline(rawChild, childPath, errors);
    if (child) {
      if (previous && sameMarks(previous.marks, child.marks)) {
        errors.push({ path: childPath, code: "ADJACENT_TEXT_SAME_MARKS" });
      }
      previous = child;
      children.push(child);
    }
  });

  if (!nodeOk || id === null) {
    return null;
  }

  return type === "heading"
    ? { type: "heading", id, level, children: children as InlineNode[] }
    : { type, id, children };
}

/**
 * A citation atom (contract §3.1). The copy holds `locator` only when the
 * input has it as an own key: absent means "no locator", and `""` is refused
 * so one meaning has one form.
 */
function validateCitation(
  raw: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): CitationNode | null {
  checkUnknownFields(raw, CITATION_FIELDS, path, errors);

  let ok = true;
  const sourceId = raw.sourceId;
  if (!isSourceId(sourceId)) {
    errors.push({ path: `${path}.sourceId`, code: "CITATION_SOURCE_ID_INVALID" });
    ok = false;
  }
  const hasLocator = Object.hasOwn(raw, "locator");
  const locator = raw.locator;
  if (hasLocator && !isAllowedText(locator, MAX_CITATION_LOCATOR_CODE_POINTS)) {
    errors.push({ path: `${path}.locator`, code: "CITATION_LOCATOR_INVALID" });
    ok = false;
  }

  if (!ok || !isSourceId(sourceId)) {
    return null;
  }
  return hasLocator
    ? { type: "citation", sourceId, locator: locator as string }
    : { type: "citation", sourceId };
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
  Array.from(raw.marks).forEach((rawMark, index) => {
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
