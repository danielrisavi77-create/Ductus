/**
 * Validation of the `sources` of a document v2
 * (docs/contracts/document-schema-v2.md §1 and §2).
 *
 * Same rules as the node validator: nothing is trusted, unknown fields are
 * refused, nothing is trimmed or repaired, every error is collected, and the
 * result is a fresh copy built only from known fields. The order of `sources`
 * is part of the hash, so it is kept and never sorted.
 *
 * Only a type import from `./validate`, so there is no import cycle at run
 * time: `checkUnknownFields` lives here and the node validator imports it.
 */

import { isAllowedTrimmedText } from "./forbidden";
import {
  MAX_DOCUMENT_SOURCES,
  MAX_SOURCE_AUTHORS,
  MAX_SOURCE_EDITORS,
  MAX_SOURCE_URL_LENGTH,
  SOURCE_TEXT_FIELD_MAX,
  SOURCE_TYPES,
  isSourceId,
  type DocumentSource,
  type SourceAuthor,
  type SourceId,
  type SourcePerson,
  type SourceType,
} from "./schema";
import type { ValidationError } from "./validate";
import { isPlainObject } from "../json";

export function checkUnknownFields(
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

type TextField = keyof typeof SOURCE_TEXT_FIELD_MAX;

const COMMON_REQUIRED = ["id", "type", "authors", "year", "title"] as const;

/** Required and optional fields of each type, beyond the common ones (§2.1). */
const TYPE_FIELDS: Readonly<Record<SourceType, { required: readonly string[]; optional: readonly string[] }>> = {
  book: { required: ["place", "publisher"], optional: [] },
  article: { required: ["journal"], optional: ["volume", "issue", "pages"] },
  chapter: { required: ["editors", "bookTitle", "place", "publisher"], optional: ["pages"] },
  web: { required: ["url", "accessed"], optional: [] },
};

const SOURCE_FIELDS: ReadonlyMap<SourceType, ReadonlySet<string>> = new Map(
  SOURCE_TYPES.map((type) => [
    type,
    new Set([...COMMON_REQUIRED, ...TYPE_FIELDS[type].required, ...TYPE_FIELDS[type].optional]),
  ]),
);

const COMMON_FIELDS: ReadonlySet<string> = new Set(COMMON_REQUIRED);
const SOURCE_RECORD_TEXT_FIELDS: readonly TextField[] = [
  "title",
  "journal",
  "volume",
  "issue",
  "pages",
  "bookTitle",
  "place",
  "publisher",
];

const PERSON_FIELDS = new Set(["kind", "family", "given"]);
const ORGANIZATION_FIELDS = new Set(["kind", "name", "acronym"]);

/** 1 to 2048 printable ASCII characters, `http://` or `https://` first (§2.1). */
const URL_PATTERN = /^https?:\/\/[\x21-\x7e]*$/;
const ACCESSED_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isSourceType(value: unknown): value is SourceType {
  return typeof value === "string" && (SOURCE_TYPES as readonly string[]).includes(value);
}

function isSourceYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999;
}

function isSourceUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SOURCE_URL_LENGTH && URL_PATTERN.test(value);
}

/**
 * A calendar date, checked exactly as `formatAccessed` in
 * `src/domain/citation/format.ts` checks it, without its `trim`: a value the
 * validator accepts never makes the formatter throw.
 */
function isAccessedDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ACCESSED_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.getUTCMonth() === +match[2] - 1 && date.getUTCDate() === +match[3];
}

/**
 * Validates `value`, the `sources` of a document v2 (`undefined` when the key
 * is absent). Errors go to `errors`; the copy is meaningful only when none
 * were added.
 */
export function validateSources(value: unknown, errors: ValidationError[]): DocumentSource[] {
  if (!Array.isArray(value)) {
    errors.push({ path: "$.sources", code: "SOURCES_NOT_ARRAY" });
    return [];
  }
  if (value.length > MAX_DOCUMENT_SOURCES) {
    errors.push({ path: "$.sources", code: "SOURCES_TOO_MANY" });
  }

  const seenIds = new Set<string>();
  const sources: DocumentSource[] = [];
  // Array.from turns holes into `undefined`, so a sparse array is refused.
  Array.from(value).forEach((raw, index) => {
    const source = validateSource(raw, `$.sources[${index}]`, seenIds, errors);
    if (source) sources.push(source);
  });
  return sources;
}

function validateSource(
  raw: unknown,
  path: string,
  seenIds: Set<string>,
  errors: ValidationError[],
): DocumentSource | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "SOURCE_NOT_OBJECT" });
    return null;
  }

  const start = errors.length;
  const type = raw.type;
  let required: readonly string[] = COMMON_REQUIRED;
  if (!Object.hasOwn(raw, "type")) {
    errors.push({ path: `${path}.type`, code: "SOURCE_FIELD_MISSING" });
  } else if (!isSourceType(type)) {
    // The field set depends on the type, so with no known type only the
    // common fields are checked and no field is reported as unknown.
    errors.push({ path: `${path}.type`, code: "SOURCE_TYPE_INVALID" });
  } else {
    checkUnknownFields(raw, SOURCE_FIELDS.get(type)!, path, errors);
    required = [...COMMON_REQUIRED, ...TYPE_FIELDS[type].required];
  }

  for (const field of required) {
    if (field !== "type" && !Object.hasOwn(raw, field)) {
      errors.push({ path: `${path}.${field}`, code: "SOURCE_FIELD_MISSING" });
    }
  }
  const has = (field: string) => Object.hasOwn(raw, field);

  let id: SourceId | null = null;
  if (has("id")) {
    if (!isSourceId(raw.id)) {
      errors.push({ path: `${path}.id`, code: "SOURCE_ID_INVALID" });
    } else if (seenIds.has(raw.id)) {
      errors.push({ path: `${path}.id`, code: "SOURCE_ID_DUPLICATE" });
    } else {
      seenIds.add(raw.id);
      id = raw.id;
    }
  }

  if (has("year") && !isSourceYear(raw.year)) {
    errors.push({ path: `${path}.year`, code: "SOURCE_YEAR_INVALID" });
  }

  // Text fields of the source itself; those of a person or an organization
  // are checked with the author. A field of another type is UNKNOWN_FIELD only.
  const fields: ReadonlySet<string> = isSourceType(type) ? SOURCE_FIELDS.get(type)! : COMMON_FIELDS;
  for (const field of SOURCE_RECORD_TEXT_FIELDS) {
    if (fields.has(field) && has(field)) {
      checkText(raw[field], field, `${path}.${field}`, errors);
    }
  }

  const authors = has("authors") ? validateAuthors(raw.authors, `${path}.authors`, errors) : null;

  let editors: SourcePerson[] | null = null;
  if (type === "chapter" && has("editors")) {
    editors = validateEditors(raw.editors, `${path}.editors`, errors);
  }
  if (type === "web") {
    if (has("url") && !isSourceUrl(raw.url)) {
      errors.push({ path: `${path}.url`, code: "SOURCE_URL_INVALID" });
    }
    if (has("accessed") && !isAccessedDate(raw.accessed)) {
      errors.push({ path: `${path}.accessed`, code: "SOURCE_ACCESSED_INVALID" });
    }
  }

  if (errors.length > start || id === null || authors === null || !isSourceType(type)) {
    return null;
  }
  return copySource(raw, type, id, authors, editors);
}

function checkText(value: unknown, field: TextField, path: string, errors: ValidationError[]): boolean {
  if (isAllowedTrimmedText(value, SOURCE_TEXT_FIELD_MAX[field])) return true;
  errors.push({ path, code: "SOURCE_FIELD_INVALID" });
  return false;
}

/** Called only when the source has no error, so every field is valid. */
function copySource(
  raw: Record<string, unknown>,
  type: SourceType,
  id: SourceId,
  authors: SourceAuthor[],
  editors: SourcePerson[] | null,
): DocumentSource {
  const base = { id, authors, year: raw.year as number, title: raw.title as string };
  const text = (field: string) => raw[field] as string;
  const optional = (field: string) => (Object.hasOwn(raw, field) ? { [field]: text(field) } : {});
  switch (type) {
    case "book":
      return { ...base, type, place: text("place"), publisher: text("publisher") };
    case "article":
      return {
        ...base,
        type,
        journal: text("journal"),
        ...optional("volume"),
        ...optional("issue"),
        ...optional("pages"),
      };
    case "chapter":
      return {
        ...base,
        type,
        editors: editors!,
        bookTitle: text("bookTitle"),
        place: text("place"),
        publisher: text("publisher"),
        ...optional("pages"),
      };
    case "web":
      return { ...base, type, url: text("url"), accessed: text("accessed") };
  }
}

/** `authors` (§2.2): 1 to 50 persons or organizations. */
function validateAuthors(value: unknown, path: string, errors: ValidationError[]): SourceAuthor[] | null {
  if (!Array.isArray(value)) {
    errors.push({ path, code: "AUTHORS_INVALID" });
    return null;
  }
  let ok = true;
  if (value.length < 1 || value.length > MAX_SOURCE_AUTHORS) {
    errors.push({ path, code: "AUTHORS_INVALID" });
    ok = false;
  }
  const authors: SourceAuthor[] = [];
  Array.from(value).forEach((raw, index) => {
    const author = validateAuthor(raw, `${path}[${index}]`, errors);
    if (author) authors.push(author);
    else ok = false;
  });
  return ok ? authors : null;
}

/** `editors` of a chapter (§2.2): 1 to 20 persons, never an organization. */
function validateEditors(value: unknown, path: string, errors: ValidationError[]): SourcePerson[] | null {
  if (!Array.isArray(value)) {
    errors.push({ path, code: "EDITORS_INVALID" });
    return null;
  }
  let ok = true;
  if (value.length < 1 || value.length > MAX_SOURCE_EDITORS) {
    errors.push({ path, code: "EDITORS_INVALID" });
    ok = false;
  }
  const editors: SourcePerson[] = [];
  Array.from(value).forEach((raw, index) => {
    const itemPath = `${path}[${index}]`;
    if (isPlainObject(raw) && raw.kind === "organization") {
      errors.push({ path: itemPath, code: "EDITORS_INVALID" });
      ok = false;
      return;
    }
    const editor = validateAuthor(raw, itemPath, errors);
    if (editor && editor.kind === "person") editors.push(editor);
    else ok = false;
  });
  return ok ? editors : null;
}

/**
 * One person or organization. The shape (an object, a known `kind`, the
 * closed field set, every required field) gives `AUTHOR_INVALID` at the exact
 * path; a text field of the right shape but a bad value `SOURCE_FIELD_INVALID`.
 */
function validateAuthor(raw: unknown, path: string, errors: ValidationError[]): SourceAuthor | null {
  if (!isPlainObject(raw)) {
    errors.push({ path, code: "AUTHOR_INVALID" });
    return null;
  }
  const isPerson = raw.kind === "person";
  if (!isPerson && raw.kind !== "organization") {
    errors.push({ path: `${path}.kind`, code: "AUTHOR_INVALID" });
    return null;
  }
  const allowed = isPerson ? PERSON_FIELDS : ORGANIZATION_FIELDS;
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({ path: `${path}.${key}`, code: "AUTHOR_INVALID" });
      ok = false;
    }
  }
  const required: readonly TextField[] = isPerson ? ["family", "given"] : ["name"];
  for (const field of required) {
    if (!Object.hasOwn(raw, field)) {
      errors.push({ path: `${path}.${field}`, code: "AUTHOR_INVALID" });
      ok = false;
    } else if (!checkText(raw[field], field, `${path}.${field}`, errors)) {
      ok = false;
    }
  }
  const hasAcronym = !isPerson && Object.hasOwn(raw, "acronym");
  if (hasAcronym && !checkText(raw.acronym, "acronym", `${path}.acronym`, errors)) {
    ok = false;
  }
  if (!ok) return null;
  if (isPerson) {
    return { kind: "person", family: raw.family as string, given: raw.given as string };
  }
  return hasAcronym
    ? { kind: "organization", name: raw.name as string, acronym: raw.acronym as string }
    : { kind: "organization", name: raw.name as string };
}
